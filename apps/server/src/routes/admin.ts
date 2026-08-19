/**
 * 管理 API —— 认证（独立管理员域）+ 总览 + 审计查询。
 * 与桌宠用户 API 完全隔离：requireAdminAuth 只认 role=admin 的 access token。
 * basePath('/admin')：本路由自带 /admin 前缀（测试与生产挂载均按此契约），
 * 挂载时直接 app.route('/', adminRouter) 即可。
 */
import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type pg from 'pg';

import type { AdminSessionManager, AdminSessionStore } from '../auth/admin-session.js';
import { SessionRotationError } from '../auth/admin-session.js';
import type { JwtService } from '../auth/jwt.js';
import { hashPasswordArgon2, verifyPassword } from '../auth/password.js';
import { hashRefreshToken } from '../auth/session.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { queryAdminAudit, writeAdminAudit } from '../lib/admin-audit.js';
import { AuthRateLimiter, clientIpOf } from '../lib/auth-rate-limit.js';
import { isValidDate, isValidUuid } from '../lib/validate.js';

import { createAdminAdminsRouter } from './admin-admins.js';
import { createAdminSensitiveRouter } from './admin-sensitive.js';
import { createAdminUsageRouter } from './admin-usage.js';
import { createAdminUsersRouter } from './admin-users.js';
import { createAdminWaitlistRouter } from './admin-waitlist.js';

export interface AdminVariables {
  adminId: string;
}

/** 管理鉴权中间件：Bearer access token 必须携带 role=admin（用户 token 一律 401）；
 *  每请求复核 admin_users 状态（与用户侧 requireAuth 查 active_display_device_id 同策略）：
 *  被删除 → 401，被禁用（status≠active）→ 403，禁用即时生效而无需等 access token 过期。 */
export function requireAdminAuth(
  jwt: JwtService,
  adminUsers: PgAdminUserStore,
): MiddlewareHandler<{ Variables: AdminVariables }> {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'admin_unauthorized' }, 401);
    try {
      const payload = await jwt.verifyAdmin(token);
      const admin = await adminUsers.getById(payload.sub);
      if (!admin) return c.json({ error: 'admin_unauthorized' }, 401);
      if (admin.status !== 'active') return c.json({ error: 'admin_disabled' }, 403);
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
/** 管理员 refresh 限流（防高频轮换刷 token；设计 §7：刷新按 IP 限流） */
const adminRefreshLimiter = new AuthRateLimiter();

/** 测试辅助：重置限流状态（模块级状态跨测试共享） */
export function resetAdminRateLimiterForTest(): void {
  adminLimiter.reset();
}

/** 登录时序等化用的固定 argon2 哈希（惰性生成一次）：邮箱不存在时也跑一次同代价校验，
 *  消除"存在的邮箱走 argon2、不存在的直接返回"的账号枚举时序差 */
let dummyArgon2Hash: string | null = null;
async function timingEqualizerHash(): Promise<string> {
  dummyArgon2Hash ??= await hashPasswordArgon2(randomUUID());
  return dummyArgon2Hash;
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
  /** waitlist 运营端点（注入 WaitlistService；邀请审计钩子由子路由消费） */
  waitlist: {
    invite(
      emails: string[],
      hooks?: {
        auditOnInvite?: (
          exec: { query(text: string, params?: unknown[]): Promise<unknown> },
          email: string,
        ) => Promise<void>;
      },
    ): Promise<{ invited: Array<{ email: string; code: string }>; skipped: string[] }>;
  };
}

export function createAdminRouter(deps: AdminRouterDeps): Hono<{ Variables: AdminVariables }> {
  // fail-closed：生产环境长周期 refresh cookie 必须带 Secure（HTTPS 部署前提），
  // 漏配直接拒绝启动——否则一次 HTTP 请求即可泄漏 30 天会话凭证
  if (process.env['NODE_ENV'] === 'production' && process.env['ADMIN_COOKIE_SECURE'] !== 'true') {
    throw new Error('生产环境必须设置 ADMIN_COOKIE_SECURE=true（管理后台 HTTPS 部署强制项）');
  }
  const app = new Hono<{ Variables: AdminVariables }>().basePath('/admin');
  const { jwt } = deps;

  app.post('/auth/login', async (c) => {
    const ip = clientIpOf(c);
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
    // 畸形 JSON/字段类型（如 {"email":123}）→ 401 invalid_credentials，而非 500
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    if (!email || email.length > 254) return c.json({ error: 'invalid_credentials' }, 401);
    const password = typeof body.password === 'string' ? body.password : '';
    // 长度上限：超长输入不进入 argon2（CPU DoS 防护；用户侧同限 128）
    if (password.length === 0 || password.length > 128) {
      return c.json({ error: 'invalid_credentials' }, 401);
    }

    const lock = adminLimiter.lockStatus(`admin-login:${email}`);
    if (lock.locked) return c.json({ error: 'rate_limit', retryAfterSec: lock.retryAfterSec }, 429);
    const ipCheck = adminLimiter.check(`admin-login-ip:${ip}`);
    if (!ipCheck.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipCheck.retryAfterSec }, 429);
    }

    const user = await deps.adminUsers.findByEmail(email);
    // 时序等化：邮箱不存在也执行一次 argon2 校验（固定 dummy 哈希），消除账号枚举时序差
    const ok = (await verifyPassword(password, user?.passwordHash ?? (await timingEqualizerHash())))
      .ok;
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
    if (user.status !== 'active') {
      // 停用账号的登录尝试也要留痕（安全事件：可能是离职管理员或被盗凭证）
      await writeAdminAudit(deps.pool, {
        adminId: user.id,
        action: 'admin.login_rejected',
        resourceType: 'admin',
        reason: 'disabled',
        ip,
      });
      return c.json({ error: 'admin_disabled' }, 403);
    }
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
    // 响应携带 access token，禁止任何中间层缓存
    c.header('Cache-Control', 'no-store');
    return c.json({ accessToken, admin: { id: user.id, email: user.email } });
  });

  app.post('/auth/refresh', async (c) => {
    const token = readCookie(c, ADMIN_REFRESH_COOKIE);
    if (!token) return c.json({ error: 'admin_unauthorized' }, 401);
    const ipCheck = adminRefreshLimiter.check(`admin-refresh-ip:${clientIpOf(c)}`);
    if (!ipCheck.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipCheck.retryAfterSec }, 429);
    }
    // 轮换前复核管理员状态（否则被停用账号可在 access token 过期后无限续期新 JWT）；
    // 设计 §7：管理员停用即撤销全部 refresh session
    const session = await deps.adminSessionStore.load(hashRefreshToken(token));
    if (!session) return c.json({ error: 'admin_unauthorized' }, 401);
    const admin = await deps.adminUsers.getById(session.adminId);
    if (!admin || admin.status !== 'active') {
      await deps.adminSessions.revokeAllForAdmin(session.adminId);
      return c.json({ error: 'admin_disabled' }, 403);
    }
    try {
      const { refreshToken, adminId } = await deps.adminSessions.rotate(token);
      const accessToken = await jwt.signAdmin(adminId);
      await writeAdminAudit(deps.pool, {
        adminId,
        action: 'admin.refresh',
        resourceType: 'admin',
        ip: clientIpOf(c),
      });
      c.header('set-cookie', adminCookie(refreshToken));
      c.header('Cache-Control', 'no-store');
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
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true });
  });

  app.get('/auth/me', requireAdminAuth(jwt, deps.adminUsers), async (c) => {
    const admin = await deps.adminUsers.getById(c.get('adminId'));
    if (!admin) return c.json({ error: 'admin_unauthorized' }, 401);
    return c.json({ admin: { id: admin.id, email: admin.email } });
  });

  app.get('/overview', requireAdminAuth(jwt, deps.adminUsers), async (c) => {
    const { rows } = await deps.pool.query(
      `select
         (select count(*) from auth.users)::int as total_users,
         (select count(*) from devices
           where revoked_at is null and last_seen_at > now() - interval '5 minutes')::int as online_devices,
         (select count(*) from devices where revoked_at is null)::int as total_devices,
         (select coalesce(sum(request_count), 0) from chat_usage
           where usage_date = current_date)::int as chat_requests_today,
         (select coalesce(sum(request_count), 0) from chat_usage
           where usage_date >= current_date - 6)::int as chat_requests_7d,
         (select count(*) from auth.users
           where created_at >= now() - interval '7 days')::int as signups_7d,
         (select count(*) from auth.users where account_status = 'suspended')::int as suspended_users,
         (select count(*) from waitlist where status = 'pending')::int as pending_invites`,
    );
    const r = rows[0] as {
      total_users: number;
      online_devices: number;
      total_devices: number;
      chat_requests_today: number;
      chat_requests_7d: number;
      signups_7d: number;
      suspended_users: number;
      pending_invites: number;
    };
    return c.json({
      totalUsers: r.total_users,
      onlineDevices: r.online_devices,
      totalDevices: r.total_devices,
      chatRequestsToday: r.chat_requests_today,
      chatRequests7d: r.chat_requests_7d,
      signups7d: r.signups_7d,
      suspendedUsers: r.suspended_users,
      pendingInvites: r.pending_invites,
    });
  });

  // 总览 24h 趋势：按小时聚合聊天消息（generate_series 补零，运营看波动节奏）
  app.get('/overview/trend', requireAdminAuth(jwt, deps.adminUsers), async (c) => {
    const { rows } = await deps.pool.query(
      `select gs as hour, coalesce(count(m.message_id), 0)::int as messages
       from generate_series(
              date_trunc('hour', now()) - interval '23 hours',
              date_trunc('hour', now()),
              interval '1 hour'
            ) gs
       left join chat_messages m on date_trunc('hour', m.created_at) = gs
       group by gs
       order by gs`,
    );
    return c.json({
      items: rows.map((r) => ({
        hour: new Date(r.hour as Date).toISOString(),
        messages: Number(r.messages),
      })),
    });
  });

  app.get('/audit-log', requireAdminAuth(jwt, deps.adminUsers), async (c) => {
    const q = c.req.query();
    // from/to 必须是日历级合法日期，否则 Postgres 日期 cast 会 500（2026-02-30 等）；非法 → 422
    for (const key of ['from', 'to'] as const) {
      if (q[key] !== undefined && !isValidDate(q[key])) {
        return c.json({ error: 'invalid_input' }, 422);
      }
    }
    // adminId 是 uuid 列绑定参数，非法值会触发 PG 22P02 → 500；非法 → 422
    if (q.adminId !== undefined && !isValidUuid(q.adminId)) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    // 查询保护（设计 §7）：审计时间跨度上限 92 天，防全表扫描压垮业务库
    if (q.from && q.to) {
      const spanDays = Math.round((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000);
      if (spanDays > 92) return c.json({ error: 'invalid_input' }, 422);
    }
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

  // 用户/设备管理（列表、详情、暂停/恢复、设备撤销；审计在各事务内写入）
  const usersRouter = createAdminUsersRouter({
    pool: deps.pool,
    jwt,
    adminUsers: deps.adminUsers,
    realtime: deps.realtime,
  });
  app.route('/', usersRouter);

  // 用量查询（chat_usage 聚合；31 天跨度上限由子路由解析层统一拦截）
  const usageRouter = createAdminUsageRouter({
    pool: deps.pool,
    jwt,
    adminUsers: deps.adminUsers,
  });
  app.route('/', usageRouter);

  // waitlist 运营管理（列表、按 id 发放邀请、强制过期；审计与动作同事务）
  const waitlistRouter = createAdminWaitlistRouter({
    pool: deps.pool,
    jwt,
    adminUsers: deps.adminUsers,
    waitlist: deps.waitlist,
  });
  app.route('/', waitlistRouter);

  // 敏感数据脱敏摘要（聊天/记忆；原文走一次性授权，消费/读取/审计同事务）
  const sensitiveRouter = createAdminSensitiveRouter({
    pool: deps.pool,
    jwt,
    adminUsers: deps.adminUsers,
  });
  app.route('/', sensitiveRouter);

  // 管理员生命周期（列表/停用/启用/自助改密；停用即撤会话，审计同事务）
  const adminsRouter = createAdminAdminsRouter({
    pool: deps.pool,
    jwt,
    adminUsers: deps.adminUsers,
    adminSessions: deps.adminSessions,
  });
  app.route('/', adminsRouter);

  return app;
}
