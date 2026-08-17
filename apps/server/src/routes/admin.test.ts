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
  async revokeAllForAdmin() {}
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
});
