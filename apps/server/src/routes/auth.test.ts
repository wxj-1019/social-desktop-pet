import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';
import { OtpService, type OtpCodeStore } from '../auth/otp.js';
import { isArgon2Hash } from '../auth/password.js';
import {
  SessionManager,
  SessionRotationError,
  type RefreshSession,
  type SessionStore,
} from '../auth/session.js';

import { createAuthRouter, resetAuthRateLimiterForTest, type AuthDeps } from './auth.js';

/** 与真实客户端一致：deviceId 必须是 uuid（IPC/服务端 Session*PayloadSchema 约束） */
const DEVICE_ID = crypto.randomUUID();

beforeEach(() => {
  // 模块级限流单例跨测试共享：每个用例前重置，防顺序耦合
  resetAuthRateLimiterForTest();
});

class MemoryStore implements SessionStore {
  async save(_session: RefreshSession): Promise<void> {}
  revokedTokenHashes: string[] = [];

  async load(_tokenHash: string): Promise<RefreshSession | null> {
    return null;
  }
  async revokeToken(tokenHash: string): Promise<void> {
    this.revokedTokenHashes.push(tokenHash);
  }
  async rotateToken(
    _tokenHash: string,
    _nextSession: RefreshSession,
    _now: number,
  ): Promise<boolean> {
    return false;
  }
  async revokeDevice(_userId: string, _deviceId: string): Promise<void> {}
  async setActiveDisplayDevice(_userId: string, _deviceId: string): Promise<void> {}
}

function makeDeps(): AuthDeps {
  return {
    jwt: new JwtService({ secret: 'test-secret-at-least-32-bytes-long' }),
    sessions: new SessionManager(new MemoryStore()),
    store: new MemoryStore(),
    users: {
      findByEmail: vi.fn(async () => null),
      create: vi.fn(async () => 'u1'),
    },
    devices: {
      register: vi.fn(async () => undefined),
    },
  };
}

async function requestRefresh(deps: AuthDeps): Promise<Response> {
  return createAuthRouter(deps).request('/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: 'refresh-1' }),
  });
}

async function requestRevoke(deps: AuthDeps, refreshToken = 'refresh-1'): Promise<Response> {
  return createAuthRouter(deps).request('/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
}

describe('auth refresh route', () => {
  it('revoke route revokes only the exact refresh token', async () => {
    const deps = makeDeps();
    const revokeToken = vi.spyOn(deps.sessions, 'revokeToken').mockResolvedValue(undefined);

    const response = await requestRevoke(deps, 'old-refresh');

    expect(response.status).toBe(200);
    expect(revokeToken).toHaveBeenCalledWith('old-refresh');
  });

  it.each(['invalid', 'revoked', 'expired'] as const)(
    'maps %s rotation errors to a stable 401 response',
    async (code) => {
      const deps = makeDeps();
      vi.spyOn(deps.sessions, 'rotate').mockRejectedValue(
        new SessionRotationError(code, `refresh token ${code}`),
      );

      const response = await requestRefresh(deps);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'refresh_invalid' });
    },
  );

  it('does not misclassify unknown rotation failures as invalid refresh', async () => {
    const deps = makeDeps();
    const failure = new Error('database unavailable');
    vi.spyOn(deps.sessions, 'rotate').mockRejectedValue(failure);
    const app = createAuthRouter(deps);
    const onError = vi.fn((_error: Error) => new Response('internal error', { status: 500 }));
    app.onError(onError);

    const response = await app.request('/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-1' }),
    });

    expect(onError).toHaveBeenCalledWith(failure, expect.anything());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('refresh_invalid');
  });
});

describe('auth register/login（argon2 密码哈希）', () => {
  it('register 落库 argon2 PHC 哈希（非旧 scrypt 拼接）', async () => {
    const deps = makeDeps();
    const create = vi.mocked(deps.users.create);
    const app = createAuthRouter(deps);

    const res = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'a@b.com',
        password: 'password123',
        deviceId: DEVICE_ID,
        platform: 'windows',
      }),
    });
    expect(res.status).toBe(201);
    const [email, passwordHash] = create.mock.calls[0] as [string, string];
    expect(email).toBe('a@b.com');
    expect(isArgon2Hash(passwordHash)).toBe(true);
    expect(passwordHash).toContain('$argon2id$');
    expect(passwordHash.length).toBeGreaterThan(60);
  });

  it('login：argon2 哈希校验通过 → 会话；密码错误 → 401', async () => {
    const deps = makeDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    const stored = await hashPasswordArgon2('password123');
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: stored,
      accountStatus: 'active' as const,
    }));
    const app = createAuthRouter(deps);

    const ok = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123', deviceId: DEVICE_ID }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { accessToken: string; refreshToken: string };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    const bad = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong-pass', deviceId: DEVICE_ID }),
    });
    expect(bad.status).toBe(401);
  });

  it('旧 scrypt 哈希登录 → 校验通过 + updatePassword 自动升级为 argon2', async () => {
    const deps = makeDeps();
    const { randomBytes, scryptSync } = await import('node:crypto');
    const salt = randomBytes(16).toString('hex');
    const legacy = salt + scryptSync('password123', salt, 64).toString('hex');
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: legacy,
      accountStatus: 'active' as const,
    }));
    deps.users.updatePassword = vi.fn(async () => undefined);
    const app = createAuthRouter(deps);

    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123', deviceId: DEVICE_ID }),
    });
    expect(res.status).toBe(200);
    const [userId, newHash] = vi.mocked(deps.users.updatePassword!).mock.calls[0] as [
      string,
      string,
    ];
    expect(userId).toBe('u1');
    expect(isArgon2Hash(newHash)).toBe(true);
  });

  it('login rejects suspended accounts', async () => {
    const deps = makeDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    const stored = await hashPasswordArgon2('password123');
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: stored,
      accountStatus: 'suspended' as const,
    }));
    const app = createAuthRouter(deps);

    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123', deviceId: DEVICE_ID }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'account_suspended' });
  });
});

describe('auth 邮箱 OTP（13.2）', () => {
  /** 内存 OTP store（复用 OtpService 真逻辑走通 request→login 全链路） */
  function makeOtpService(): OtpService {
    const rows = new Map<string, { codeHash: string; attempts: number; expiresAt: Date }>();
    let seq = 0;
    const store: OtpCodeStore = {
      create: async (_email, codeHash, expiresAt) => {
        rows.set(String(_email), { codeHash, attempts: 0, expiresAt });
        void seq;
      },
      findLatest: async (email) => {
        const row = rows.get(email);
        return row
          ? {
              otpId: `otp-${++seq}`,
              codeHash: row.codeHash,
              attempts: row.attempts,
              expiresAt: row.expiresAt,
              consumedAt: null,
            }
          : null;
      },
      countPending: async () => 0,
      incrementAttempts: async (_otpId) => undefined,
      consumeIfUnused: async () => true,
      cleanup: async () => undefined,
    };
    return new OtpService(store, undefined, { devCodeInResponse: true });
  }

  it('request（未注册邮箱 → 404）；已注册 → 带 devCode；login 全链路出 token', async () => {
    const deps = makeDeps();
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: 'x',
      accountStatus: 'active' as const,
    }));
    deps.otp = makeOtpService();
    const app = createAuthRouter(deps);

    // 未注册邮箱（findByEmail null）→ 404
    deps.users.findByEmail = vi.fn(async () => null);
    const missing = await app.request('/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@b.com' }),
    });
    expect(missing.status).toBe(404);

    // 已注册 → 200 + devCode
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: 'x',
      accountStatus: 'active' as const,
    }));
    const request = await app.request('/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(request.status).toBe(200);
    const { devCode } = (await request.json()) as { devCode: string };
    expect(devCode).toMatch(/^\d{6}$/);

    // devCode 登录 → access/refresh token（与密码登录同语义）
    const login = await app.request('/otp/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', code: devCode, deviceId: DEVICE_ID }),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as {
      accessToken: string;
      refreshToken: string;
      userId: string;
    };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.userId).toBe('u1');
  });

  it('错误验证码 → 401；未注入 OtpService → 501', async () => {
    const deps = makeDeps();
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: 'x',
      accountStatus: 'active' as const,
    }));
    deps.otp = makeOtpService();
    const app = createAuthRouter(deps);

    const bad = await app.request('/otp/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', code: '000000', deviceId: DEVICE_ID }),
    });
    expect(bad.status).toBe(401);

    const depsNoOtp = makeDeps();
    const appNoOtp = createAuthRouter(depsNoOtp);
    const disabled = await appNoOtp.request('/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(disabled.status).toBe(501);
  });

  it('otp login rejects suspended accounts', async () => {
    const deps = makeDeps();
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: 'x',
      accountStatus: 'suspended' as const,
    }));
    deps.otp = makeOtpService();
    const app = createAuthRouter(deps);

    const request = await app.request('/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(request.status).toBe(200);
    const { devCode } = (await request.json()) as { devCode: string };

    const login = await app.request('/otp/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', code: devCode, deviceId: DEVICE_ID }),
    });
    expect(login.status).toBe(403);
    expect(await login.json()).toEqual({ error: 'account_suspended' });
  });

  it('邮箱格式非法 → 400', async () => {
    const deps = makeDeps();
    deps.otp = makeOtpService();
    const app = createAuthRouter(deps);
    const res = await app.request('/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('auth 防爆破与输入校验（3.x 阶段）', () => {
  it('login 连续失败达阈值 → 账号锁定 429；锁定期间正确密码也拒绝', async () => {
    const deps = makeDeps();
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: 'x',
      accountStatus: 'active' as const,
    }));
    const app = createAuthRouter(deps);

    // 5 次失败 → 触发锁定
    for (let i = 0; i < 5; i++) {
      const bad = await app.request('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', password: 'wrong-pass', deviceId: DEVICE_ID }),
      });
      expect(bad.status).toBe(401);
    }
    // 锁定：即使密码正确（mock 恒返回 user + verify 通过）也 429
    deps.users.findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: 'x',
      accountStatus: 'active' as const,
    }));
    const locked = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'whatever', deviceId: DEVICE_ID }),
    });
    expect(locked.status).toBe(429);
    const body = (await locked.json()) as { error: string; retryAfterSec: number };
    expect(body.error).toBe('rate_limit');
    expect(body.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('畸形 JSON body → 按语义返回且不 500（此前未捕获直接 500）', async () => {
    const app = createAuthRouter(makeDeps());
    const cases: Array<[string, number]> = [
      ['/register', 400], // schema 校验失败
      ['/login', 400], // schema 校验失败
      ['/refresh', 401], // rotate('undefined') 失败 → refresh_invalid
      ['/revoke', 200], // 幂等撤销
    ];
    for (const [path, expected] of cases) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      });
      expect(res.status, path).toBe(expected);
    }
  });

  it('register：email/deviceId 非法（schema 校验）→ 400；大小写邮箱归一落库', async () => {
    const deps = makeDeps();
    const create = vi.mocked(deps.users.create);
    const app = createAuthRouter(deps);

    const badEmail = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'password123', deviceId: DEVICE_ID }),
    });
    expect(badEmail.status).toBe(400);

    const badDevice = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123', deviceId: 'dev-1' }),
    });
    expect(badDevice.status).toBe(400);

    // 大小写邮箱 → 归一为小写落库（杜绝双账号）
    const ok = await app.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'User@Example.com',
        password: 'password123',
        deviceId: DEVICE_ID,
      }),
    });
    expect(ok.status).toBe(201);
    expect(create.mock.calls[0]?.[0]).toBe('user@example.com');
  });

  it('login：email 大小写不一致也能登录（归一查询）', async () => {
    const deps = makeDeps();
    const stored = await (await import('../auth/password.js')).hashPasswordArgon2('password123');
    const findByEmail = vi.fn(async () => ({
      id: 'u1',
      passwordHash: stored,
      accountStatus: 'active' as const,
    }));
    deps.users.findByEmail = findByEmail;
    const app = createAuthRouter(deps);

    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'A@B.COM',
        password: 'password123',
        deviceId: DEVICE_ID,
      }),
    });
    expect(res.status).toBe(200);
    expect(findByEmail).toHaveBeenCalledWith('a@b.com');
  });

  it('login：畸形 deviceId（非 uuid）→ 400（schema 校验，不再 500）', async () => {
    const app = createAuthRouter(makeDeps());
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123', deviceId: 'dev-1' }),
    });
    expect(res.status).toBe(400);
  });
});
