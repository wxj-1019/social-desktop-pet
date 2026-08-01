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

  async save(session: RefreshSession): Promise<void> {
    this.sessions.set(session.tokenHash, session);
  }
  async load(tokenHash: string): Promise<RefreshSession | null> {
    return this.sessions.get(tokenHash) ?? null;
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
    await expect(m.rotate(token1)).rejects.toThrow('revoked');
  });

  it('rejects unknown / expired tokens', async () => {
    const store = new MemoryStore();
    const now = 1_000_000;
    const m = new SessionManager(store, 30 * 24 * 60 * 60_000, () => now);
    const token = await m.createRefreshToken('u1', 'dev-1');
    store.sessions.get(hashRefreshToken(token))!.expiresAt = now - 1; // 过期
    await expect(m.rotate(token)).rejects.toThrow('expired');
    await expect(m.rotate('not-a-real-token')).rejects.toThrow('invalid');
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
