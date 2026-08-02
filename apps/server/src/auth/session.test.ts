import { describe, expect, it } from 'vitest';

import {
  SessionManager,
  hashRefreshToken,
  type RefreshSession,
  type SessionStore,
} from './session.js';

/** 内存版 SessionStore（测试用） */
class MemoryStore implements SessionStore {
  sessions = new Map<string, RefreshSession>();
  rotateCalls: Array<{ tokenHash: string; nextSession: RefreshSession; now: number }> = [];
  saveCalls = 0;

  async save(session: RefreshSession): Promise<void> {
    this.saveCalls += 1;
    this.sessions.set(session.tokenHash, session);
  }
  async load(tokenHash: string): Promise<RefreshSession | null> {
    const session = this.sessions.get(tokenHash);
    return session ? { ...session } : null;
  }
  async revokeToken(tokenHash: string): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = Date.now();
  }
  async rotateToken(tokenHash: string, nextSession: RefreshSession, now: number): Promise<boolean> {
    this.rotateCalls.push({ tokenHash, nextSession, now });
    const current = this.sessions.get(tokenHash);
    if (!current || current.revokedAt !== null || current.expiresAt <= now) return false;
    current.revokedAt = now;
    this.sessions.set(nextSession.tokenHash, nextSession);
    return true;
  }
  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    for (const s of this.sessions.values()) {
      if (s.userId === userId && s.deviceId === deviceId) s.revokedAt = Date.now();
    }
  }
  async setActiveDisplayDevice(_userId: string, _deviceId: string): Promise<void> {}
}

describe('SessionManager（自建 Auth refresh token 生命周期，9.8）', () => {
  it('creates a refresh token and stores only its hash', async () => {
    const store = new MemoryStore();
    const m = new SessionManager(store);
    const token = await m.createRefreshToken('u1', 'dev-1');
    expect(token).not.toBe(hashRefreshToken(token));
    expect(store.sessions.has(hashRefreshToken(token))).toBe(true);
    expect(store.sessions.size).toBe(1);
  });

  it('rotate() returns a new token and revokes the old one (防重放)', async () => {
    const store = new MemoryStore();
    const m = new SessionManager(store);
    const token1 = await m.createRefreshToken('u1', 'dev-1');
    const { refreshToken: token2, userId, deviceId } = await m.rotate(token1);
    expect(token2).not.toBe(token1);
    expect(userId).toBe('u1');
    expect(deviceId).toBe('dev-1');
    expect(store.sessions.get(hashRefreshToken(token1))?.revokedAt).not.toBeNull();
    // 旧 token 再轮换 → 拒绝（revoked）
    await expect(m.rotate(token1)).rejects.toMatchObject({
      code: 'revoked',
      message: 'refresh token revoked',
    });
  });

  it('rejects unknown / expired tokens', async () => {
    const store = new MemoryStore();
    const now = 1_000_000;
    const m = new SessionManager(store, 30 * 24 * 60 * 60_000, () => now);
    const token = await m.createRefreshToken('u1', 'dev-1');
    store.sessions.get(hashRefreshToken(token))!.expiresAt = now; // 边界时刻也已过期
    await expect(m.rotate(token)).rejects.toMatchObject({
      code: 'expired',
      message: 'refresh token expired',
    });
    await expect(m.rotate('not-a-real-token')).rejects.toMatchObject({
      code: 'invalid',
      message: 'invalid refresh token',
    });
  });

  it('revokeToken() only revokes the exact refresh token', async () => {
    const store = new MemoryStore();
    const m = new SessionManager(store);
    const oldToken = await m.createRefreshToken('u1', 'dev-1');
    const newToken = await m.createRefreshToken('u1', 'dev-1');

    await m.revokeToken(oldToken);

    expect(store.sessions.get(hashRefreshToken(oldToken))?.revokedAt).not.toBeNull();
    expect(store.sessions.get(hashRefreshToken(newToken))?.revokedAt).toBeNull();
  });

  it('only one concurrent rotation can consume the same refresh token', async () => {
    const store = new MemoryStore();
    const m = new SessionManager(store);
    const token = await m.createRefreshToken('u1', 'dev-1');

    const results = await Promise.allSettled([m.rotate(token), m.rotate(token)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'revoked', message: 'refresh token revoked' },
    });
    expect(store.rotateCalls).toHaveLength(2);
    expect(store.saveCalls).toBe(1);
    expect(store.sessions.size).toBe(2);
  });

  it('revokeDevice() kills all sessions of that device (9.8 停用旧设备)', async () => {
    const store = new MemoryStore();
    const m = new SessionManager(store);
    await m.createRefreshToken('u1', 'dev-1');
    await m.createRefreshToken('u1', 'dev-2');
    await m.revokeDevice('u1', 'dev-1');
    for (const s of store.sessions.values()) {
      if (s.deviceId === 'dev-1') expect(s.revokedAt).not.toBeNull();
      if (s.deviceId === 'dev-2') expect(s.revokedAt).toBeNull();
    }
  });
});
