import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminSessionManager } from '../auth/admin-session.js';
import type { AdminSession, AdminSessionStore } from '../auth/admin-session.js';
import { JwtService } from '../auth/jwt.js';

import { createAdminRouter, resetAdminRateLimiterForTest } from './admin.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

beforeEach(() => {
  // 模块级限流单例跨测试共享：每个用例前重置，防顺序耦合（与 auth.test.ts 同策略）
  resetAdminRateLimiterForTest();
});

class MemoryAdminStore implements AdminSessionStore {
  sessions = new Map<string, AdminSession>();
  async save(s: AdminSession) {
    this.sessions.set(s.tokenHash, s);
  }
  async load(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async rotateToken(tokenHash: string, next: AdminSession, now: number) {
    const cur = this.sessions.get(tokenHash);
    if (!cur || cur.revokedAt !== null || now >= cur.expiresAt) return false;
    this.sessions.set(tokenHash, { ...cur, revokedAt: now });
    this.sessions.set(next.tokenHash, next);
    return true;
  }
  async revokeToken(tokenHash: string) {
    const cur = this.sessions.get(tokenHash);
    if (cur) this.sessions.set(tokenHash, { ...cur, revokedAt: Date.now() });
  }
  async revokeAllForAdmin(adminId: string) {
    for (const [h, s] of this.sessions)
      if (s.adminId === adminId) this.sessions.set(h, { ...s, revokedAt: Date.now() });
  }
}

function buildDeps() {
  const store = new MemoryAdminStore();
  const sessions = new AdminSessionManager(store);
  const users = {
    findByEmail: vi.fn(async (email: string) =>
      email === 'admin@pet.dev'
        ? {
            id: 'a1',
            email,
            passwordHash: 'phc',
            status: 'active',
            lastLoginAt: null,
            createdAt: 0,
          }
        : null,
    ),
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
    create: vi.fn(async () => 'a1'),
    setStatus: vi.fn(async () => undefined),
    recordLogin: vi.fn(async () => undefined),
  };
  const pool = {
    query: vi.fn(async (..._args: unknown[]) => ({
      rows: [{ total_users: 3, online_devices: 1, chat_requests_today: 10, pending_invites: 2 }],
      rowCount: 1,
    })),
  };
  const app = createAdminRouter({
    pool: pool as never,
    jwt: JWT,
    adminSessions: sessions,
    adminSessionStore: store,
    adminUsers: users as never,
    realtime: { kickUser: vi.fn() } as never,
    waitlist: null as never,
  });
  return { app, store, users, pool };
}

describe('admin auth routes', () => {
  it('login succeeds and sets refresh cookie + access token', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'active',
      lastLoginAt: null,
      createdAt: 0,
    });
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'Admin@123456' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; admin: { id: string } };
    expect(body.admin.id).toBe('a1');
    expect(body.accessToken).toBeTruthy();
    expect(res.headers.get('set-cookie')).toContain('admin_refresh=');
    expect(users.recordLogin).toHaveBeenCalledWith('a1');
  });

  it('login rejects wrong password with 401 and does not set cookie', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'active',
      lastLoginAt: null,
      createdAt: 0,
    });
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refresh rotates the refresh token', async () => {
    const { app, store } = buildDeps();
    const mgr = new AdminSessionManager(store);
    const token = await mgr.createRefreshToken('a1');
    const res = await app.request('/admin/auth/refresh', {
      method: 'POST',
      headers: { cookie: `admin_refresh=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string };
    expect(body.accessToken).toBeTruthy();
    expect(res.headers.get('set-cookie')).toContain('admin_refresh=');
  });

  it('me requires admin access token', async () => {
    const { app } = buildDeps();
    const userToken = await JWT.sign({ sub: 'u1', deviceId: 'dev-1' });
    const denied = await app.request('/admin/auth/me', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(denied.status).toBe(401);
    const adminToken = await JWT.signAdmin('a1');
    const ok = await app.request('/admin/auth/me', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ok.status).toBe(200);
  });

  it('login sets HttpOnly refresh cookie scoped to /admin', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'active',
      lastLoginAt: null,
      createdAt: 0,
    });
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'Admin@123456' }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('Path=/admin');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('login with non-string email returns 401 instead of 500', async () => {
    const { app } = buildDeps();
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 123, password: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('login rejects a disabled admin with 403', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'disabled',
      lastLoginAt: null,
      createdAt: 0,
    });
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'Admin@123456' }),
    });
    expect(res.status).toBe(403);
    expect(users.recordLogin).not.toHaveBeenCalled();
  });

  it('me rejects a token after the admin is disabled', async () => {
    const { app, users } = buildDeps();
    users.getById.mockResolvedValue({ id: 'a1', email: 'admin@pet.dev', status: 'disabled' });
    const adminToken = await JWT.signAdmin('a1');
    const res = await app.request('/admin/auth/me', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(403);
  });

  it('locks the email after 5 failed login attempts', async () => {
    const { app } = buildDeps();
    const attempt = () =>
      app.request('/admin/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@pet.dev', password: 'wrong-password' }),
      });
    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }
    const res = await attempt();
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; retryAfterSec: number };
    expect(body.error).toBe('rate_limit');
    expect(body.retryAfterSec).toBeGreaterThan(0);
  });

  it('revoke invalidates the refresh token', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'active',
      lastLoginAt: null,
      createdAt: 0,
    });
    const login = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'Admin@123456' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const revoke = await app.request('/admin/auth/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(revoke.status).toBe(200);
    const refresh = await app.request('/admin/auth/refresh', {
      method: 'POST',
      headers: { cookie },
    });
    expect(refresh.status).toBe(401);
  });

  it('audit-log rejects malformed date params with 422', async () => {
    const { app } = buildDeps();
    const adminToken = await JWT.signAdmin('a1');
    const res = await app.request('/admin/audit-log?from=not-a-date', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(422);
  });

  it('audit-log rejects non-uuid adminId with 422 (not PG 22P02 → 500)', async () => {
    const { app } = buildDeps();
    const adminToken = await JWT.signAdmin('a1');
    const res = await app.request('/admin/audit-log?adminId=not-a-uuid', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(422);
  });

  it('login and refresh responses are no-store (token 不进任何缓存)', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'active',
      lastLoginAt: null,
      createdAt: 0,
    });
    const login = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'Admin@123456' }),
    });
    expect(login.headers.get('cache-control')).toBe('no-store');
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const refresh = await app.request('/admin/auth/refresh', {
      method: 'POST',
      headers: { cookie },
    });
    expect(refresh.status).toBe(200);
    expect(refresh.headers.get('cache-control')).toBe('no-store');
  });

  it('audit: disabled-admin login attempts are recorded (admin.login_rejected)', async () => {
    const { app, users, pool } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'disabled',
      lastLoginAt: null,
      createdAt: 0,
    });
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'Admin@123456' }),
    });
    expect(res.status).toBe(403);
    const auditCall = pool.query.mock.calls.find(
      (call) =>
        String(call[0]).includes('insert into admin_audit_log') &&
        (call[1] as unknown[])[1] === 'admin.login_rejected',
    );
    expect(auditCall).toBeDefined();
  });

  it('refresh rejects a disabled admin with 403 and revokes all their sessions', async () => {
    const { app, store, users } = buildDeps();
    const mgr = new AdminSessionManager(store);
    const token = await mgr.createRefreshToken('a1');
    users.getById.mockResolvedValue({ id: 'a1', email: 'admin@pet.dev', status: 'disabled' });
    const res = await app.request('/admin/auth/refresh', {
      method: 'POST',
      headers: { cookie: `admin_refresh=${token}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'admin_disabled' });
    // 停用即全撤：该管理员全部 refresh session 已撤销
    const { hashRefreshToken } = await import('../auth/session.js');
    expect(store.sessions.get(hashRefreshToken(token))!.revokedAt).not.toBeNull();
  });

  it('refresh of unknown cookie token returns 401', async () => {
    const { app } = buildDeps();
    const res = await app.request('/admin/auth/refresh', {
      method: 'POST',
      headers: { cookie: 'admin_refresh=unknown-token' },
    });
    expect(res.status).toBe(401);
  });

  it('refuses to start in production without ADMIN_COOKIE_SECURE (fail-closed)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ADMIN_COOKIE_SECURE', '');
    try {
      expect(() => buildDeps()).toThrow(/ADMIN_COOKIE_SECURE/);
      vi.stubEnv('ADMIN_COOKIE_SECURE', 'true');
      expect(() => buildDeps()).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
