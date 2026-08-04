/**
 * Auth 路由 —— 注册/登录/刷新/撤销/邮箱 OTP（自建 Auth，9.8 / 13.2）。
 * 密码哈希：argon2id（@node-rs/argon2，OWASP 推荐）；旧 scrypt 格式登录时
 * 校验通过自动升级写回（平滑迁移）。邮箱 OTP 登录（13.2 事务邮件）：
 * POST /auth/otp/request → 邮件 6 位验证码（sha256 落库，60s 冷却）；
 * POST /auth/otp/login → 校验通过直接登录（同 password login 会话语义）。
 */
import { Hono } from 'hono';

import type { JwtService } from '../auth/jwt.js';
import type { OtpService } from '../auth/otp.js';
import { hashPasswordArgon2, verifyPassword } from '../auth/password.js';
import { SessionRotationError } from '../auth/session.js';
import type { SessionManager, SessionStore } from '../auth/session.js';

export interface AuthDeps {
  jwt: JwtService;
  sessions: SessionManager;
  store: SessionStore;
  /** 用户存储（auth.users 表操作；骨架注入，路由层不直接碰 pg） */
  users: {
    findByEmail(email: string): Promise<{ id: string; passwordHash: string } | null>;
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
    const { email, password, deviceId, platform, nickname } = await c.req.json();
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8) {
      return c.json({ error: 'email/password 非法' }, 400);
    }
    // argon2id 哈希（PHC 格式；OWASP 推荐替代旧 scrypt）
    const passwordHash = await hashPasswordArgon2(password);
    const userId = await deps.users.create(email, passwordHash);
    // 默认昵称 = email 前缀（6.x 注册流程接入后由用户设置）
    const defaultNickname =
      typeof nickname === 'string' && nickname.length > 0
        ? nickname
        : (email.split('@')[0] ?? '新朋友');
    await deps.devices.register(
      userId,
      String(deviceId),
      String(platform ?? 'windows'),
      defaultNickname,
    );
    // 4.3 邀请状态机：注册即绑定 waitlist（invited/joined → joined + claimed_by；
    // 幂等；失败仅日志不阻塞注册）
    if (deps.waitlist) {
      await deps.waitlist
        .bindJoinedUser(email.toLowerCase(), userId)
        .catch((e) => console.warn('[waitlist] 注册绑定失败：', (e as Error).message));
    }
    return c.json({ userId }, 201);
  });

  app.post('/login', async (c) => {
    const { email, password, deviceId, platform } = await c.req.json();
    const user = await deps.users.findByEmail(String(email));
    if (!user) return c.json({ error: 'invalid credentials' }, 401);
    const { ok, needsUpgrade } = await verifyPassword(String(password), user.passwordHash);
    if (!ok) return c.json({ error: 'invalid credentials' }, 401);
    // 旧 scrypt 哈希校验通过 → 自动升级为 argon2id（平滑迁移）
    if (needsUpgrade && deps.users.updatePassword) {
      await deps.users
        .updatePassword(user.id, await hashPasswordArgon2(String(password)))
        .catch((e) => console.warn('[auth] 密码哈希升级写回失败：', (e as Error).message));
    }
    const devId = String(deviceId);
    // login 时 profile 已存在（on conflict do nothing）；昵称不变
    await deps.devices.register(user.id, devId, String(platform ?? 'windows'), '');
    const refreshToken = await deps.sessions.createRefreshToken(user.id, devId);
    const accessToken = await deps.jwt.sign({ sub: user.id, deviceId: devId });
    return c.json({ accessToken, refreshToken, userId: user.id });
  });

  app.post('/refresh', async (c) => {
    const { refreshToken } = await c.req.json();
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
    const { refreshToken } = await c.req.json();
    await deps.sessions.revokeToken(String(refreshToken));
    return c.json({ ok: true });
  });

  // ---- 13.2 邮箱 OTP 登录（事务邮件；未注入 OtpService → 501） ----

  /** 基础邮箱校验（与 waitlist 同规则：形如 a@b.c，≤254 字符） */
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // 发送验证码：未注册邮箱 404；60s 冷却 429；pending 上限 429
  app.post('/otp/request', async (c) => {
    if (!deps.otp) return c.json({ error: 'otp_disabled' }, 501);
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

    const devId = String(deviceId);
    await deps.devices.register(user.id, devId, String(platform ?? 'windows'), '');
    const refreshToken = await deps.sessions.createRefreshToken(user.id, devId);
    const accessToken = await deps.jwt.sign({ sub: user.id, deviceId: devId });
    return c.json({ accessToken, refreshToken, userId: user.id });
  });

  return app;
}
