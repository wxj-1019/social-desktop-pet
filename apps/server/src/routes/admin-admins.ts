/**
 * 管理 API —— 管理员生命周期（列表/停用/启用/自助改密）。
 * 设计 §7 收口：停用管理员必须立即撤销其全部 refresh session（refresh 路由另做状态复核兜底）。
 * 自锁保护：不能停用自己；不能停用最后一个 active 管理员（否则后台永久失去入口）。
 * 全部写操作走"动作 + 会话撤销 + 审计"单事务。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { AdminSessionManager } from '../auth/admin-session.js';
import type { JwtService } from '../auth/jwt.js';
import { hashPasswordArgon2, verifyPassword } from '../auth/password.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { writeAdminAuditOn } from '../lib/admin-audit.js';
import { AuthRateLimiter, clientIpOf } from '../lib/auth-rate-limit.js';
import { isValidUuid } from '../lib/validate.js';

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

/** 停用/启用/改密限流（与其他高风险写同策略：按 IP 滑窗） */
const adminActionLimiter = new AuthRateLimiter();

export interface AdminAdminsDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
  adminSessions: AdminSessionManager;
}

export function createAdminAdminsRouter(
  deps: AdminAdminsDeps,
): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  app.get('/admins', auth, async (c) => {
    const items = await deps.adminUsers.list();
    return c.json({ items });
  });

  app.post('/admins/:id/disable', auth, async (c) => {
    const limit = adminActionLimiter.check(`admin-action-ip:${clientIpOf(c)}`);
    if (!limit.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: limit.retryAfterSec }, 429);
    }
    const adminId = c.get('adminId');
    const targetId = c.req.param('id');
    if (!isValidUuid(targetId)) return c.json({ error: 'invalid_input' }, 422);
    if (targetId === adminId) return c.json({ error: 'cannot_disable_self' }, 422);

    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      // 先锁住全部 active 管理员行再判定：两个并发"停用最后两个可用管理员"的事务
      // 会被行锁串行化，后到者重新评估时 active 数已减一 → 拒绝，杜绝 0 可用管理员
      const lockedActive = await client.query(
        `select id from admin_users where status = 'active' order by id for update`,
      );
      const target = await client.query(
        `select id, status from admin_users where id = $1 for update`,
        [targetId],
      );
      if (target.rowCount === 0) {
        await client.query('rollback');
        return c.json({ error: 'not_found' }, 404);
      }
      if (target.rows[0]!.status !== 'active') {
        await client.query('rollback');
        return c.json({ error: 'already_disabled' }, 409);
      }
      if ((lockedActive.rowCount ?? 0) <= 1) {
        await client.query('rollback');
        return c.json({ error: 'last_active_admin' }, 409);
      }
      await client.query(
        `update admin_users set status = 'disabled', updated_at = now() where id = $1`,
        [targetId],
      );
      // 停用即全撤：refresh 会话即刻失效（设计 §7）
      await client.query(
        `update admin_sessions set revoked_at = now() where admin_id = $1 and revoked_at is null`,
        [targetId],
      );
      await writeAdminAuditOn(client, {
        adminId,
        action: 'admin.disable',
        resourceType: 'admin',
        resourceId: targetId,
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

  app.post('/admins/:id/enable', auth, async (c) => {
    const limit = adminActionLimiter.check(`admin-action-ip:${clientIpOf(c)}`);
    if (!limit.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: limit.retryAfterSec }, 429);
    }
    const adminId = c.get('adminId');
    const targetId = c.req.param('id');
    if (!isValidUuid(targetId)) return c.json({ error: 'invalid_input' }, 422);

    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query(
        `update admin_users set status = 'active', updated_at = now()
         where id = $1 and status = 'disabled' returning id`,
        [targetId],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query('rollback');
        return c.json({ error: 'not_disabled' }, 409);
      }
      await writeAdminAuditOn(client, {
        adminId,
        action: 'admin.enable',
        resourceType: 'admin',
        resourceId: targetId,
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

  // 自助改密：验当前密码（argon2）→ 新密码 ≥12 位 → 更新哈希 → 撤销本人全部 refresh 会话
  app.post('/auth/change-password', auth, async (c) => {
    const limit = adminActionLimiter.check(`admin-action-ip:${clientIpOf(c)}`);
    if (!limit.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: limit.retryAfterSec }, 429);
    }
    const adminId = c.get('adminId');
    const body = (await c.req.json().catch(() => ({}))) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const next = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (current.length === 0 || current.length > 128) {
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    if (next.length < 12 || next.length > 128) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    const withHash = await deps.adminUsers.getWithHash(adminId);
    if (!withHash) return c.json({ error: 'admin_unauthorized' }, 401);
    const ok = (await verifyPassword(current, withHash.passwordHash)).ok;
    if (!ok) return c.json({ error: 'invalid_credentials' }, 401);

    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update admin_users set password_hash = $2, updated_at = now() where id = $1`,
        [adminId, await hashPasswordArgon2(next)],
      );
      // 改密后撤销本人全部 refresh 会话（旧凭证链即刻失效；当前 access token ≤15min 自然过期）
      await client.query(
        `update admin_sessions set revoked_at = now() where admin_id = $1 and revoked_at is null`,
        [adminId],
      );
      await writeAdminAuditOn(client, {
        adminId,
        action: 'admin.password_change',
        resourceType: 'admin',
        resourceId: adminId,
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

  return app;
}
