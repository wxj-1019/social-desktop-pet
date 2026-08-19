/**
 * Auth 路由 —— 注册/登录/刷新/撤销/邮箱 OTP（自建 Auth，9.8 / 13.2）。
 * 密码哈希：argon2id（@node-rs/argon2，OWASP 推荐）；旧 scrypt 格式登录时
 * 校验通过自动升级写回（平滑迁移）。邮箱 OTP 登录（13.2 事务邮件）：
 * POST /auth/otp/request → 邮件 6 位验证码（sha256 落库，60s 冷却）；
 * POST /auth/otp/login → 校验通过直接登录（同 password login 会话语义）。
 */
import { Hono } from 'hono';

import { SessionLoginPayloadSchema } from '@pet/protocol';

import type { JwtService } from '../auth/jwt.js';
import type { OtpService } from '../auth/otp.js';
import { hashPasswordArgon2, verifyPassword } from '../auth/password.js';
import { SessionRotationError } from '../auth/session.js';
import type { SessionManager, SessionStore } from '../auth/session.js';
import { AuthRateLimiter, clientIpOf } from '../lib/auth-rate-limit.js';

/** 认证防爆破（3.x 阶段）：登录/注册/OTP 的 IP 窗口限流 + 账号失败锁定 */
const authLimiter = new AuthRateLimiter();

/** 测试辅助：重置限流状态（模块级状态跨测试共享） */
export function resetAuthRateLimiterForTest(): void {
  authLimiter.reset();
}

export interface AuthDeps {
  jwt: JwtService;
  sessions: SessionManager;
  store: SessionStore;
  /** 用户存储（auth.users 表操作；骨架注入，路由层不直接碰 pg） */
  users: {
    findByEmail(email: string): Promise<{
      id: string;
      passwordHash: string;
      /** 0015 账号状态：suspended 账号拒绝登录（403 account_suspended） */
      accountStatus: 'active' | 'suspended';
    } | null>;
    create(email: string, passwordHash: string): Promise<string>;
    /** 登录时旧哈希升级写回（argon2 迁移；可选注入） */
    updatePassword?(userId: string, passwordHash: string): Promise<void>;
  };
  devices: {
    /** 注册设备并激活（9.8：激活新设备撤销旧设备会话）；nickname 仅首次注册生效 */
    register(userId: string, deviceId: string, platform: string, nickname: string): Promise<void>;
  };
  /** 邮箱 OTP（13.2 事务邮件；未注入则 /otp/* 返回 501） */
  otp?: OtpService;
  /** waitlist 注册绑定（4.3 邀请状态机：invited/joined → joined + claimed_by；可选注入） */
  waitlist?: {
    bindJoinedUser(email: string, userId: string): Promise<void>;
  };
}

export function createAuthRouter(deps: AuthDeps): Hono {
  const app = new Hono();

  app.post('/register', async (c) => {
    // IP 窗口限流（防批量灌号）
    const ipRate = authLimiter.check(`register-ip:${clientIpOf(c)}`);
    if (!ipRate.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipRate.retryAfterSec }, 429);
    }
    // 畸形 JSON → 400 而非 500（与 /otp/* 一致的容错）
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // protocol 单一真相源：email/password/deviceId 全量校验（含 deviceId uuid）；
    // platform 属传输细节（strict schema 不包含），单独取出
    const { platform, nickname, ...rest } = body;
    const parsed = SessionLoginPayloadSchema.safeParse(rest);
    if (!parsed.success) {
      return c.json({ error: 'email/password/deviceId 非法' }, 400);
    }
    const { email, password, deviceId } = parsed.data;
    // email 小写归一（与 OTP/waitlist 一致：杜绝大小写双账号）
    const normalizedEmail = email.toLowerCase();
    // nickname 可选：有则 trim + ≤40，无则默认 email 前缀（兼容旧客户端/e2e）
    const nicknameRaw = typeof nickname === 'string' ? nickname.trim() : '';
    if (nicknameRaw.length > 40) {
      return c.json({ error: 'nickname 过长（≤40）' }, 400);
    }
    const finalNickname =
      nicknameRaw.length > 0 ? nicknameRaw : (normalizedEmail.split('@')[0] ?? '新朋友');
    // argon2id 哈希（PHC 格式；OWASP 推荐替代旧 scrypt）
    const passwordHash = await hashPasswordArgon2(password);
    let userId: string;
    try {
      userId = await deps.users.create(normalizedEmail, passwordHash);
    } catch (e) {
      // auth.users.email 唯一约束（23505）：重复注册 → 409 而非 500
      if ((e as { code?: string }).code === '23505') {
        return c.json({ error: '该邮箱已注册' }, 409);
      }
      throw e;
    }
    await deps.devices.register(userId, deviceId, String(platform ?? 'windows'), finalNickname);
    // 4.3 邀请状态机：注册即绑定 waitlist（invited/joined → joined + claimed_by；
    // 幂等；失败仅日志不阻塞注册）
    if (deps.waitlist) {
      await deps.waitlist
        .bindJoinedUser(normalizedEmail, userId)
        .catch((e) => console.warn('[waitlist] 注册绑定失败：', (e as Error).message));
    }
    return c.json({ userId }, 201);
  });

  app.post('/login', async (c) => {
    const ip = clientIpOf(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // 账号级失败锁定：锁定期间直接 429（防暴力破解；先取 email 判锁）
    const lockKey = `login:${typeof body.email === 'string' ? body.email.toLowerCase() : ''}`;
    const lockNow = authLimiter.lockStatus(lockKey);
    if (lockNow.locked) {
      return c.json({ error: 'rate_limit', retryAfterSec: lockNow.retryAfterSec }, 429);
    }
    // IP 窗口限流（防分布式爆破/灌号）
    const ipRate = authLimiter.check(`login-ip:${ip}`);
    if (!ipRate.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipRate.retryAfterSec }, 429);
    }
    const { platform, ...rest } = body;
    const parsed = SessionLoginPayloadSchema.safeParse(rest);
    if (!parsed.success) {
      return c.json({ error: 'email/password/deviceId 非法' }, 400);
    }
    const { email, password, deviceId } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const user = await deps.users.findByEmail(normalizedEmail);
    if (!user) {
      authLimiter.recordFailure(lockKey);
      return c.json({ error: 'invalid credentials' }, 401);
    }
    const { ok, needsUpgrade } = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      authLimiter.recordFailure(lockKey);
      return c.json({ error: 'invalid credentials' }, 401);
    }
    // 0015 暂停账号：密码校验通过也拒绝发 token（管理后台封禁即时生效）
    if (user.accountStatus === 'suspended') {
      return c.json({ error: 'account_suspended' }, 403);
    }
    // 登录成功：清除失败计数
    authLimiter.clear(lockKey);
    // 旧 scrypt 哈希校验通过 → 自动升级为 argon2id（平滑迁移）
    if (needsUpgrade && deps.users.updatePassword) {
      await deps.users
        .updatePassword(user.id, await hashPasswordArgon2(password))
        .catch((e) => console.warn('[auth] 密码哈希升级写回失败：', (e as Error).message));
    }
    // login 时 profile 已存在（on conflict do nothing）；昵称不变
    await deps.devices.register(user.id, deviceId, String(platform ?? 'windows'), '');
    const refreshToken = await deps.sessions.createRefreshToken(user.id, deviceId);
    const accessToken = await deps.jwt.sign({ sub: user.id, deviceId });
    return c.json({ accessToken, refreshToken, userId: user.id });
  });

  app.post('/refresh', async (c) => {
    const { refreshToken } = (await c.req.json().catch(() => ({}))) as { refreshToken?: string };
    let rotated: Awaited<ReturnType<SessionManager['rotate']>>;
    try {
      rotated = await deps.sessions.rotate(String(refreshToken));
    } catch (error) {
      if (error instanceof SessionRotationError) {
        return c.json({ error: 'refresh_invalid' }, 401);
      }
      throw error;
    }
    const accessToken = await deps.jwt.sign({
      sub: rotated.userId,
      deviceId: rotated.deviceId,
    });
    return c.json({ accessToken, refreshToken: rotated.refreshToken });
  });

  app.post('/revoke', async (c) => {
    const { refreshToken } = (await c.req.json().catch(() => ({}))) as { refreshToken?: string };
    await deps.sessions.revokeToken(String(refreshToken));
    return c.json({ ok: true });
  });

  // ---- 13.2 邮箱 OTP 登录（事务邮件；未注入 OtpService → 501） ----

  /** 基础邮箱校验（与 waitlist 同规则：形如 a@b.c，≤254 字符） */
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // 发送验证码：未注册邮箱 404；60s 冷却（指数退避）429；pending 上限 429；IP 限流
  app.post('/otp/request', async (c) => {
    if (!deps.otp) return c.json({ error: 'otp_disabled' }, 501);
    const ipRate = authLimiter.check(`otp-request-ip:${clientIpOf(c)}`);
    if (!ipRate.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipRate.retryAfterSec }, 429);
    }
    const { email } = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (typeof email !== 'string' || email.length === 0 || email.length > 254) {
      return c.json({ error: 'email 非法' }, 400);
    }
    if (!EMAIL_PATTERN.test(email)) return c.json({ error: 'email 格式非法' }, 400);
    const normalized = email.toLowerCase();
    const user = await deps.users.findByEmail(normalized);
    if (!user) return c.json({ error: 'email_not_registered' }, 404);

    const result = await deps.otp.request(normalized);
    if (result.status === 'cooldown') {
      return c.json({ error: 'rate_limit', retryAfterSec: result.retryAfterSec }, 429);
    }
    if (result.status === 'too_many_pending') {
      return c.json({ error: 'too_many_pending' }, 429);
    }
    return c.json({ ok: true, ...(result.devCode ? { devCode: result.devCode } : {}) });
  });

  // 验证码登录：校验通过 → 与密码登录同会话语义（9.8 设备激活/会话轮换）
  app.post('/otp/login', async (c) => {
    if (!deps.otp) return c.json({ error: 'otp_disabled' }, 501);
    // IP 限流（单码 5 次尝试上限在 OtpService；IP 窗口防 60s 轮换刷码）
    const ipRate = authLimiter.check(`otp-login-ip:${clientIpOf(c)}`);
    if (!ipRate.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipRate.retryAfterSec }, 429);
    }
    const { email, code, deviceId, platform } = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      code?: string;
      deviceId?: string;
      platform?: string;
    };
    if (typeof email !== 'string' || typeof code !== 'string' || code.length !== 6) {
      return c.json({ error: 'email/code 非法' }, 400);
    }
    const normalized = email.toLowerCase();
    const verify = await deps.otp.verify(normalized, code);
    if (!verify.ok) return c.json({ error: 'invalid_otp' }, 401);
    const user = await deps.users.findByEmail(normalized);
    if (!user) return c.json({ error: 'email_not_registered' }, 404);
    // 0015 暂停账号：验证码正确也拒绝发 token（与密码登录同策略）
    if (user.accountStatus === 'suspended') {
      return c.json({ error: 'account_suspended' }, 403);
    }

    const devId = String(deviceId);
    await deps.devices.register(user.id, devId, String(platform ?? 'windows'), '');
    const refreshToken = await deps.sessions.createRefreshToken(user.id, devId);
    const accessToken = await deps.jwt.sign({ sub: user.id, deviceId: devId });
    return c.json({ accessToken, refreshToken, userId: user.id });
  });

  return app;
}
