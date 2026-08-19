/**
 * 管理 API —— 用户/设备（列表、详情、暂停/恢复、撤销）。
 * RLS 模型（D-13 纵深防御）：本服务以 app role 连接（表 owner，默认豁免 RLS），
 * 聚合列表/详情读取按设计走 owner 豁免路径；单用户作用域操作（设备列表、暂停、
 * 撤销）沿用"事务内 set request.jwt.claims = 目标用户"的 withUserClaims 模式
 * （与 memory-store 相同语义），保证未来收紧角色/强制 RLS 时行为一致。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { rlsClaimsJson } from '../db/pool.js';
import { writeAdminAuditOn } from '../lib/admin-audit.js';
import { AuthRateLimiter, clientIpOf } from '../lib/auth-rate-limit.js';
import { isValidUuid } from '../lib/validate.js';

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

/** 高风险用户写操作限流（suspend/restore/revoke；设计 §7 高风险写按 IP 限流） */
const userActionLimiter = new AuthRateLimiter();

/** 高风险写操作入口：IP 滑动窗口超限 → 429 */
function checkUserActionLimit(c: { req: { header(name: string): string | undefined } }): {
  allowed: boolean;
  retryAfterSec: number;
} {
  return userActionLimiter.check(`user-action-ip:${clientIpOf(c)}`);
}

/** path param 必须是合法 UUID，否则 PG uuid 绑定抛 22P02 → 500；非法 → 422 */
function requireUuidParam(c: { req: { param(key: string): string } }, key: string): string | null {
  const value = c.req.param(key);
  return isValidUuid(value) ? value : null;
}

/** 以目标用户身份运行查询（RLS 兼容：set local request.jwt.claims） */
export async function withUserClaims<T>(
  pool: pg.Pool,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      rlsClaimsJson(userId),
    ]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export interface AdminUsersDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
  realtime: { kickUser(userId: string): void };
}

export function createAdminUsersRouter(deps: AdminUsersDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  // 排序白名单（ORDER BY 片段直接拼接；只允许预定义键，杜绝注入）
  const SORTS: Record<string, string> = {
    created_desc: 'u.created_at desc',
    created_asc: 'u.created_at asc',
    last_seen_desc: 'last_seen_at desc nulls last',
    device_desc: 'device_count desc',
  };

  app.get('/users', auth, async (c) => {
    const q = c.req.query();
    const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
    const pageSize = Number.isFinite(Number(q.pageSize))
      ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
      : 20;
    const keyword = (q.q ?? '').trim();
    const status = q.status ?? '';
    const orderBy = SORTS[q.sort ?? ''] ?? SORTS.created_desc;
    const countParams = [keyword, status];
    const count = await deps.pool.query(
      `select count(*)::int as total
       from auth.users u left join profiles p on p.user_id = u.id
       where ($1 = '' or u.email ilike '%' || $1 || '%'
              or p.nickname ilike '%' || $1 || '%'
              or u.id::text = $1)
         and ($2 = '' or u.account_status = $2)`,
      countParams,
    );
    const listParams = [...countParams, pageSize, (page - 1) * pageSize];
    const { rows } = await deps.pool.query(
      `select u.id as user_id, u.email, p.nickname, u.account_status, u.created_at,
              (select count(*) from devices d where d.user_id = u.id)::int as device_count,
              (select max(d.last_seen_at) from devices d where d.user_id = u.id) as last_seen_at,
              (select count(*) from devices d
                where d.user_id = u.id and d.revoked_at is null
                  and d.last_seen_at > now() - interval '5 minutes')::int as online
       from auth.users u left join profiles p on p.user_id = u.id
       where ($1 = '' or u.email ilike '%' || $1 || '%'
              or p.nickname ilike '%' || $1 || '%'
              or u.id::text = $1)
         and ($2 = '' or u.account_status = $2)
       order by ${orderBy}
       limit $3 offset $4`,
      listParams,
    );
    return c.json({
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
      items: rows.map((r) => ({
        userId: String(r.user_id),
        email: r.email as string,
        nickname: r.nickname as string | null,
        accountStatus: r.account_status as string,
        createdAt: r.created_at as string,
        deviceCount: Number(r.device_count),
        online: Number(r.online) > 0,
        lastSeenAt: r.last_seen_at as string | null,
      })),
    });
  });

  app.get('/users/:userId', auth, async (c) => {
    const userId = requireUuidParam(c, 'userId');
    if (!userId) return c.json({ error: 'invalid_input' }, 422);
    const { rows } = await deps.pool.query(
      `select u.id as user_id, u.email, p.nickname, u.account_status, u.suspended_at,
              u.suspended_reason, u.created_at,
              (select count(*) from devices d where d.user_id = u.id)::int as device_count,
              (select max(d.last_seen_at) from devices d where d.user_id = u.id) as last_seen_at,
              (select count(*) from devices d
                where d.user_id = u.id and d.revoked_at is null
                  and d.last_seen_at > now() - interval '5 minutes')::int as online,
              (select coalesce(sum(request_count), 0) from chat_usage cu
                where cu.user_id = u.id and cu.usage_date >= current_date - 6)::int as chat_requests_7d,
              (select count(*) from pets pt where pt.owner_user_id = u.id)::int as pet_count,
              (select count(*) from friendships f
                where (f.user_low_id = u.id or f.user_high_id = u.id) and f.status = 'active')::int as friend_count,
              (select count(*) from private_memories pm where pm.owner_user_id = u.id)::int as memory_count
       from auth.users u left join profiles p on p.user_id = u.id
       where u.id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) return c.json({ error: 'not_found' }, 404);
    return c.json({
      userId: String(r.user_id),
      email: r.email as string,
      nickname: r.nickname as string | null,
      accountStatus: r.account_status as string,
      suspendedAt: r.suspended_at as string | null,
      suspendedReason: r.suspended_reason as string | null,
      createdAt: r.created_at as string,
      deviceCount: Number(r.device_count),
      online: Number(r.online) > 0,
      lastSeenAt: r.last_seen_at as string | null,
      chatRequests7d: Number(r.chat_requests_7d),
      petCount: Number(r.pet_count),
      friendCount: Number(r.friend_count),
      memoryCount: Number(r.memory_count),
    });
  });

  app.post('/users/:userId/suspend', auth, async (c) => {
    const limit = checkUserActionLimit(c);
    if (!limit.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: limit.retryAfterSec }, 429);
    }
    const adminId = c.get('adminId');
    const userId = requireUuidParam(c, 'userId');
    if (!userId) return c.json({ error: 'invalid_input' }, 422);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    // 非字符串 reason（如数字）直接 422，而非 .trim() 抛 TypeError → 500
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 1 || reason.length > 500) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      const updated = await client.query(
        `update auth.users set account_status = 'suspended', suspended_at = now(), suspended_reason = $2
         where id = $1 and account_status <> 'suspended'
         returning id`,
        [userId, reason],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query('rollback');
        return c.json({ error: 'already_suspended' }, 409);
      }
      await client.query(
        'update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId],
      );
      await client.query(
        'update devices set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId],
      );
      // 撤销双保险锚点必须同步清空：requireAuth 以 active_display_device_id 判设备
      // 是否被停用，不清则已登录会话仍被放行（暂停只挡新登录不挡存量会话）
      await client.query('update profiles set active_display_device_id = null where user_id = $1', [
        userId,
      ]);
      // 审计与动作同事务提交：审计 insert 失败 → 回滚动作（动作必有审计轨迹）
      await writeAdminAuditOn(client, {
        adminId,
        action: 'user.suspend',
        resourceType: 'user',
        resourceId: userId,
        reason,
        ip: clientIpOf(c),
      });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    deps.realtime.kickUser(userId);
    return c.json({ ok: true });
  });

  app.post('/users/:userId/restore', auth, async (c) => {
    const limit = checkUserActionLimit(c);
    if (!limit.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: limit.retryAfterSec }, 429);
    }
    const adminId = c.get('adminId');
    const userId = requireUuidParam(c, 'userId');
    if (!userId) return c.json({ error: 'invalid_input' }, 422);
    // 动作与审计同事务（与 suspend 同语义）：审计 insert 失败 → 回滚动作
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query(
        `update auth.users set account_status = 'active', suspended_at = null, suspended_reason = null
         where id = $1 and account_status = 'suspended'
         returning id`,
        [userId],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query('rollback');
        return c.json({ error: 'not_suspended' }, 409);
      }
      await writeAdminAuditOn(client, {
        adminId,
        action: 'user.restore',
        resourceType: 'user',
        resourceId: userId,
        ip: clientIpOf(c),
      });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return c.json({ ok: true });
  });

  app.get('/users/:userId/devices', auth, async (c) => {
    const userId = requireUuidParam(c, 'userId');
    if (!userId) return c.json({ error: 'invalid_input' }, 422);
    const { rows } = await withUserClaims(deps.pool, userId, (client) =>
      client.query(
        `select device_id, platform, app_version, last_seen_at, revoked_at
         from devices where user_id = $1 order by last_seen_at desc`,
        [userId],
      ),
    );
    return c.json({
      items: rows.map((r) => ({
        deviceId: String(r.device_id),
        platform: r.platform as string,
        appVersion: r.app_version as string | null,
        lastSeenAt: r.last_seen_at as string,
        revokedAt: r.revoked_at as string | null,
      })),
    });
  });

  app.post('/devices/:deviceId/revoke', auth, async (c) => {
    const limit = checkUserActionLimit(c);
    if (!limit.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: limit.retryAfterSec }, 429);
    }
    const adminId = c.get('adminId');
    const deviceId = requireUuidParam(c, 'deviceId');
    if (!deviceId) return c.json({ error: 'invalid_input' }, 422);
    // 先以 owner 豁免路径取设备归属（存在且未撤销），再以目标用户 claims 执行撤销
    const { rows } = await deps.pool.query(
      'select user_id from devices where device_id = $1 and revoked_at is null',
      [deviceId],
    );
    const r = rows[0];
    if (!r) return c.json({ error: 'not_found' }, 404);
    const userId = String(r.user_id);
    // 撤销与审计同一事务：审计失败 → 撤销回滚（动作必有审计轨迹）
    await withUserClaims(deps.pool, userId, async (client) => {
      await client.query(
        'update devices set revoked_at = now() where device_id = $1 and revoked_at is null',
        [deviceId],
      );
      await client.query(
        'update refresh_sessions set revoked_at = now() where device_id = $1 and revoked_at is null',
        [deviceId],
      );
      await writeAdminAuditOn(client, {
        adminId,
        action: 'device.revoke',
        resourceType: 'device',
        resourceId: deviceId,
        reason: userId,
        ip: clientIpOf(c),
      });
    });
    return c.json({ ok: true });
  });

  return app;
}
