/**
 * Auth 路由 —— 注册/登录/刷新/撤销（自建 Auth，9.8）。
 * 骨架：密码哈希用 node:crypto scrypt（自建实现，无需外部依赖）；
 * 生产前替换为 argon2（V-9 后评估）并加入邮件 OTP（13.2 事务邮件）。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';

import type { JwtService } from '../auth/jwt.js';
import { hashRefreshToken } from '../auth/session.js';
import type { SessionManager, SessionStore } from '../auth/session.js';

export interface AuthDeps {
  jwt: JwtService;
  sessions: SessionManager;
  store: SessionStore;
  /** 用户存储（auth.users 表操作；骨架注入，路由层不直接碰 pg） */
  users: {
    findByEmail(email: string): Promise<{ id: string; passwordHash: string } | null>;
    create(email: string, passwordHash: string): Promise<string>;
  };
  devices: {
    /** 注册设备并激活（9.8：激活新设备撤销旧设备会话）；nickname 仅首次注册生效 */
    register(userId: string, deviceId: string, platform: string, nickname: string): Promise<void>;
  };
}

export function createAuthRouter(deps: AuthDeps): Hono {
  const app = new Hono();

  function hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }

  app.post('/register', async (c) => {
    const { email, password, deviceId, platform, nickname } = await c.req.json();
    if (typeof email !== 'string' || typeof password !== 'string' || password.length < 8) {
      return c.json({ error: 'email/password 非法' }, 400);
    }
    const salt = randomBytes(16).toString('hex');
    // 存储格式：salt(32 hex) + scrypt hash(128 hex)；login 时按此拆分
    const userId = await deps.users.create(email, salt + hashPassword(password, salt));
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
    return c.json({ userId }, 201);
  });

  app.post('/login', async (c) => {
    const { email, password, deviceId, platform } = await c.req.json();
    const user = await deps.users.findByEmail(String(email));
    if (!user) return c.json({ error: 'invalid credentials' }, 401);
    const [salt, hash] = [user.passwordHash.slice(0, 32), user.passwordHash.slice(32)];
    const candidate = hashPassword(String(password), salt);
    if (!timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'))) {
      return c.json({ error: 'invalid credentials' }, 401);
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
    const rotated = await deps.sessions.rotate(String(refreshToken));
    const accessToken = await deps.jwt.sign({
      sub: rotated.userId,
      deviceId: rotated.deviceId,
    });
    return c.json({ accessToken, refreshToken: rotated.refreshToken });
  });

  app.post('/revoke', async (c) => {
    const { refreshToken } = await c.req.json();
    const session = await deps.store.load(hashRefreshToken(String(refreshToken)));
    if (session) {
      await deps.sessions.revokeDevice(session.userId, session.deviceId);
    }
    return c.json({ ok: true });
  });

  return app;
}
