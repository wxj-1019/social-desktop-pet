/**
 * 管理 API —— 认证（独立管理员域）+ 总览 + 审计查询。
 * 与桌宠用户 API 完全隔离：requireAdminAuth 只认 role=admin 的 access token。
 * basePath('/admin')：本路由自带 /admin 前缀（测试与生产挂载均按此契约），
 * 挂载时直接 app.route('/', adminRouter) 即可。
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type pg from 'pg';

import type { AdminSessionManager, AdminSessionStore } from '../auth/admin-session.js';
import { SessionRotationError } from '../auth/admin-session.js';
import type { JwtService } from '../auth/jwt.js';
import { verifyPassword } from '../auth/password.js';
import { hashRefreshToken } from '../auth/session.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { queryAdminAudit, writeAdminAudit } from '../lib/admin-audit.js';
import { AuthRateLimiter, clientIpOf } from '../lib/auth-rate-limit.js';

export interface AdminVariables {
  adminId: string;
}

/** 管理鉴权中间件：Bearer access token 必须携带 role=admin（用户 token 一律 401） */
export function requireAdminAuth(
  jwt: JwtService,
): MiddlewareHandler<{ Variables: AdminVariables }> {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'admin_unauthorized' }, 401);
    try {
      const payload = await jwt.verifyAdmin(token);
      c.set('adminId', payload.sub);
      return next();
    } catch {
      return c.json({ error: 'admin_unauthorized' }, 401);
    }
  };
}

const ADMIN_REFRESH_COOKIE = 'admin_refresh';

/** 管理员登录限流（独立实例，与用户 auth 计数器隔离） */
const adminLimiter = new AuthRateLimiter();

/** 测试辅助：重置限流状态（模块级状态跨测试共享） */
export function resetAdminRateLimiterForTest(): void {
  adminLimiter.reset();
}

function adminCookie(token: string): string {
  const secure = process.env['ADMIN_COOKIE_SECURE'] === 'true';
  return `${ADMIN_REFRESH_COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function readCookie(
  c: { req: { header(name: string): string | undefined } },
  name: string,
): string | null {
  const cookie = c.req.header('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export interface AdminRouterDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminSessions: AdminSessionManager;
  adminSessionStore: AdminSessionStore;
  adminUsers: PgAdminUserStore;
  realtime: { kickUser(userId: string): void };
  /** waitlist 运营端点（Task 13 注入；此处声明契约，未用） */
  waitlist: {
    invite(
      emails: string[],
    ): Promise<{ invited: Array<{ email: string; code: string }>; skipped: string[] }>;
  };
}

export function createAdminRouter(deps: AdminRouterDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>().basePath('/admin');
  const { jwt } = deps;

  app.post('/auth/login', async (c) => {
    const ip = clientIpOf(c);
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = (body.email ?? '').toLowerCase().trim();
    if (!email) return c.json({ error: 'invalid_credentials' }, 401);

    const lock = adminLimiter.lockStatus(`admin-login:${email}`);
    if (lock.locked) return c.json({ error: 'rate_limit', retryAfterSec: lock.retryAfterSec }, 429);
    const ipCheck = adminLimiter.check(`admin-login-ip:${ip}`);
    if (!ipCheck.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipCheck.retryAfterSec }, 429);
    }

    const user = await deps.adminUsers.findByEmail(email);
    const ok = user ? (await verifyPassword(body.password ?? '', user.passwordHash)).ok : false;
    if (!user || !ok) {
      adminLimiter.recordFailure(`admin-login:${email}`);
      await writeAdminAudit(deps.pool, {
        adminId: user?.id ?? null,
        action: 'admin.login_failed',
        resourceType: 'admin',
        reason: email,
        ip,
      });
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    if (user.status !== 'active') return c.json({ error: 'admin_disabled' }, 403);
    adminLimiter.clear(`admin-login:${email}`);

    const refreshToken = await deps.adminSessions.createRefreshToken(user.id);
    const accessToken = await jwt.signAdmin(user.id);
    await deps.adminUsers.recordLogin(user.id);
    await writeAdminAudit(deps.pool, {
      adminId: user.id,
      action: 'admin.login',
      resourceType: 'admin',
      reason: email,
      ip,
    });
    c.header('set-cookie', adminCookie(refreshToken));
    return c.json({ accessToken, admin: { id: user.id, email: user.email } });
  });

  app.post('/auth/refresh', async (c) => {
    const token = readCookie(c, ADMIN_REFRESH_COOKIE);
    if (!token) return c.json({ error: 'admin_unauthorized' }, 401);
    try {
      const { refreshToken, adminId } = await deps.adminSessions.rotate(token);
      const accessToken = await jwt.signAdmin(adminId);
      await writeAdminAudit(deps.pool, {
        adminId,
        action: 'admin.refresh',
        resourceType: 'admin',
      });
      c.header('set-cookie', adminCookie(refreshToken));
      return c.json({ accessToken });
    } catch (e) {
      if (e instanceof SessionRotationError) return c.json({ error: 'admin_unauthorized' }, 401);
      throw e;
    }
  });

  app.post('/auth/revoke', async (c) => {
    const token = readCookie(c, ADMIN_REFRESH_COOKIE);
    if (token) {
      const session = await deps.adminSessionStore.load(hashRefreshToken(token));
      await deps.adminSessions.revokeToken(token);
      if (session) {
        await writeAdminAudit(deps.pool, {
          adminId: session.adminId,
          action: 'admin.revoke',
          resourceType: 'admin',
        });
      }
    }
    c.header(
      'set-cookie',
      `${ADMIN_REFRESH_COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return c.json({ ok: true });
  });

  app.get('/auth/me', requireAdminAuth(jwt), async (c) => {
    const admin = await deps.adminUsers.getById(c.get('adminId'));
    if (!admin) return c.json({ error: 'admin_unauthorized' }, 401);
    return c.json({ admin: { id: admin.id, email: admin.email } });
  });

  app.get('/overview', requireAdminAuth(jwt), async (c) => {
    const { rows } = await deps.pool.query(
      `select
         (select count(*) from auth.users)::int as total_users,
         (select count(*) from devices
           where revoked_at is null and last_seen_at > now() - interval '5 minutes')::int as online_devices,
         (select coalesce(sum(request_count), 0) from chat_usage
           where usage_date = current_date)::int as chat_requests_today,
         (select count(*) from waitlist where status = 'pending')::int as pending_invites`,
    );
    const r = rows[0] as {
      total_users: number;
      online_devices: number;
      chat_requests_today: number;
      pending_invites: number;
    };
    return c.json({
      totalUsers: r.total_users,
      onlineDevices: r.online_devices,
      chatRequestsToday: r.chat_requests_today,
      pendingInvites: r.pending_invites,
    });
  });

  app.get('/audit-log', requireAdminAuth(jwt), async (c) => {
    const q = c.req.query();
    const result = await queryAdminAudit(deps.pool, {
      adminId: q.adminId,
      action: q.action,
      resourceType: q.resourceType,
      from: q.from,
      to: q.to,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    return c.json(result);
  });

  return app;
}
