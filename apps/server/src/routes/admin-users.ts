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

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

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
  writeAudit(entry: {
    adminId: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    reason?: string | null;
    ip?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export function createAdminUsersRouter(deps: AdminUsersDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  app.get('/users', auth, async (c) => {
    const q = c.req.query();
    const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
    const pageSize = Number.isFinite(Number(q.pageSize))
      ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
      : 20;
    const keyword = (q.q ?? '').trim();
    const status = q.status ?? '';
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
       order by u.created_at desc
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
    const userId = c.req.param('userId');
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
    const adminId = c.get('adminId');
    const userId = c.req.param('userId');
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = (body.reason ?? '').trim();
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
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    deps.realtime.kickUser(userId);
    await deps.writeAudit({
      adminId,
      action: 'user.suspend',
      resourceType: 'user',
      resourceId: userId,
      reason,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true });
  });

  app.post('/users/:userId/restore', auth, async (c) => {
    const adminId = c.get('adminId');
    const userId = c.req.param('userId');
    const updated = await deps.pool.query(
      `update auth.users set account_status = 'active', suspended_at = null, suspended_reason = null
       where id = $1 and account_status = 'suspended'
       returning id`,
      [userId],
    );
    if ((updated.rowCount ?? 0) === 0) return c.json({ error: 'not_suspended' }, 409);
    await deps.writeAudit({
      adminId,
      action: 'user.restore',
      resourceType: 'user',
      resourceId: userId,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true });
  });

  app.get('/users/:userId/devices', auth, async (c) => {
    const userId = c.req.param('userId');
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
    const adminId = c.get('adminId');
    const deviceId = c.req.param('deviceId');
    // 先以 owner 豁免路径取设备归属（存在且未撤销），再以目标用户 claims 执行撤销
    const { rows } = await deps.pool.query(
      'select user_id from devices where device_id = $1 and revoked_at is null',
      [deviceId],
    );
    const r = rows[0];
    if (!r) return c.json({ error: 'not_found' }, 404);
    const userId = String(r.user_id);
    await withUserClaims(deps.pool, userId, async (client) => {
      await client.query(
        'update devices set revoked_at = now() where device_id = $1 and revoked_at is null',
        [deviceId],
      );
      await client.query(
        'update refresh_sessions set revoked_at = now() where device_id = $1 and revoked_at is null',
        [deviceId],
      );
    });
    await deps.writeAudit({
      adminId,
      action: 'device.revoke',
      resourceType: 'device',
      resourceId: deviceId,
      reason: userId,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true });
  });

  return app;
}
