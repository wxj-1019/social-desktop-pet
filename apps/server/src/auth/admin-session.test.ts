import { describe, expect, it } from 'vitest';

import { AdminSessionManager, SessionRotationError } from './admin-session.js';
import type { AdminSession, AdminSessionStore } from './admin-session.js';
import { hashRefreshToken } from './session.js';

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

describe('AdminSessionManager', () => {
  it('createRefreshToken stores only the hash', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store, 30 * 24 * 60 * 60_000);
    const token = await mgr.createRefreshToken('admin-1');
    expect(token).not.toContain('admin-1');
    expect(store.sessions.has(hashRefreshToken(token))).toBe(true);
    expect([...store.sessions.values()][0]!.adminId).toBe('admin-1');
  });

  it('rotate rotates and revokes the old token', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store);
    const token = await mgr.createRefreshToken('admin-1');
    const { refreshToken, adminId } = await mgr.rotate(token);
    expect(adminId).toBe('admin-1');
    expect(store.sessions.get(hashRefreshToken(token))!.revokedAt).not.toBeNull();
    expect(store.sessions.has(hashRefreshToken(refreshToken))).toBe(true);
  });

  it('rejects revoked / expired / unknown tokens', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store, 60_000, () => 1_000_000);
    const token = await mgr.createRefreshToken('admin-1');
    await mgr.revokeToken(token);
    await expect(mgr.rotate(token)).rejects.toThrow(SessionRotationError);

    const expired = await mgr.createRefreshToken('admin-1'); // 60s TTL，now=1_000_000
    store.sessions.get(hashRefreshToken(expired))!.expiresAt = 1_000_000; // 边界时刻也已过期（与 session.test.ts 同法）
    await expect(mgr.rotate(expired)).rejects.toThrow(SessionRotationError); // expiresAt 已过
    await expect(mgr.rotate('unknown')).rejects.toThrow(SessionRotationError);
  });

  it('revokeAllForAdmin revokes every session of the admin', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store);
    const t1 = await mgr.createRefreshToken('admin-1');
    const t2 = await mgr.createRefreshToken('admin-1');
    await mgr.createRefreshToken('admin-2');
    await mgr.revokeAllForAdmin('admin-1');
    expect(store.sessions.get(hashRefreshToken(t1))!.revokedAt).not.toBeNull();
    expect(store.sessions.get(hashRefreshToken(t2))!.revokedAt).not.toBeNull();
  });
});
