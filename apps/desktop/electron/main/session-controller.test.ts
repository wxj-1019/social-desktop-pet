import { describe, expect, it, vi } from 'vitest';

import {
  SessionController,
  type SessionAuthApi,
  type SessionProfile,
  type SessionStorage,
  type SessionTokens,
} from './session-controller.js';

/** 内存版 SessionStorage（测试用） */
class MemoryStorage implements SessionStorage {
  private token: string | null = null;
  loadRefreshToken(): string | null {
    return this.token;
  }
  saveRefreshToken(token: string): void {
    this.token = token;
  }
  deleteRefreshToken(): void {
    this.token = null;
  }
}

const profile: SessionProfile = { userId: 'u1', deviceId: 'dev-1' };

function makeTokens(expiresAt = Date.now() + 15 * 60_000): SessionTokens {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', accessExpiresAt: expiresAt };
}

function makeAuth(): SessionAuthApi {
  return {
    refreshAccessToken: vi.fn(async () => ({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      accessExpiresAt: Date.now() + 15 * 60_000,
    })),
    loadProfile: vi.fn(async () => ({ ...profile, nickname: 'Alice' })),
    revoke: vi.fn(async () => undefined),
  };
}

describe('SessionController (9.8 多设备 / 8.3 令牌生命周期)', () => {
  it('starts SIGNED_OUT with no tokens', () => {
    const c = new SessionController(new MemoryStorage(), makeAuth());
    expect(c.snapshot.phase).toBe('SIGNED_OUT');
    expect(c.hasValidAccessToken()).toBe(false);
  });

  it('restore() enters SIGNED_OUT when no refresh token stored', async () => {
    const c = new SessionController(new MemoryStorage(), makeAuth());
    await c.restore();
    expect(c.snapshot.phase).toBe('SIGNED_OUT');
  });

  it('restore() refreshes to ACTIVE when a refresh token is stored', async () => {
    const storage = new MemoryStorage();
    storage.saveRefreshToken('refresh-1');
    const auth = makeAuth();
    const c = new SessionController(storage, auth);
    await c.restore();
    expect(c.snapshot.phase).toBe('ACTIVE');
    expect(auth.refreshAccessToken).toHaveBeenCalledWith('refresh-1');
    expect(storage.loadRefreshToken()).toBe('refresh-2');
    expect(c.snapshot.profile).toEqual({ userId: 'u1', deviceId: 'dev-1', nickname: 'Alice' });
    expect(c.hasValidAccessToken()).toBe(true);
  });

  it('concurrent refresh calls share one in-flight token rotation', async () => {
    const storage = new MemoryStorage();
    const auth = makeAuth();
    let resolveRefresh!: (tokens: SessionTokens) => void;
    auth.refreshAccessToken = vi.fn(
      () =>
        new Promise<SessionTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const c = new SessionController(storage, auth);

    const first = c.refresh('refresh-1');
    const second = c.refresh('refresh-1');
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);

    resolveRefresh({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      accessExpiresAt: Date.now() + 15 * 60_000,
    });
    const [firstState, secondState] = await Promise.all([first, second]);
    expect(firstState).toEqual(secondState);
    expect(firstState).toEqual(c.snapshot);
    expect(c.snapshot.profile).toEqual({ userId: 'u1', deviceId: 'dev-1', nickname: 'Alice' });
  });

  it('activate() saves refresh token to secure storage (8.3)', async () => {
    const storage = new MemoryStorage();
    const c = new SessionController(storage, makeAuth());
    await c.activate(makeTokens(), profile);
    expect(storage.loadRefreshToken()).toBe('refresh-1');
    expect(c.snapshot.profile).toEqual(profile);
    expect(c.snapshot.tokens?.accessToken).toBe('access-1');
  });

  it('refresh() failure transitions to EXPIRED', async () => {
    const storage = new MemoryStorage();
    storage.saveRefreshToken('stale');
    const auth = makeAuth();
    auth.refreshAccessToken = vi.fn(async () => {
      throw new Error('401 invalid_grant');
    });
    const c = new SessionController(storage, auth);
    await c.restore();
    expect(storage.loadRefreshToken()).toBeNull();
    expect(c.snapshot.phase).toBe('EXPIRED');
    expect(c.snapshot.profile).toBeNull();
    expect(c.snapshot.tokens).toBeNull();
    expect(c.snapshot.error).toContain('401');
  });

  it('access token validity window (short TTL per 9.8)', async () => {
    const now = 1_000_000;
    const c = new SessionController(new MemoryStorage(), makeAuth(), 15 * 60_000, () => now);
    await c.activate(makeTokens(now + 1), profile);
    expect(c.hasValidAccessToken()).toBe(true);
    // 过期后失效
    await c.activate(makeTokens(now - 1), profile);
    expect(c.hasValidAccessToken()).toBe(false);
  });

  it('revoke() clears tokens and storage; revoked flag blocks access until expiry (9.8 双保险)', async () => {
    const storage = new MemoryStorage();
    const auth = makeAuth();
    const now = 1_000_000;
    const c = new SessionController(storage, auth, 15 * 60_000, () => now);
    await c.activate(makeTokens(now + 60_000), profile);
    expect(c.hasValidAccessToken()).toBe(true);
    await c.revoke();
    expect(auth.revoke).toHaveBeenCalledWith('refresh-1');
    expect(storage.loadRefreshToken()).toBeNull();
    expect(c.snapshot.phase).toBe('SIGNED_OUT');
    expect(c.isRevoked).toBe(true);
    expect(c.hasValidAccessToken()).toBe(false); // 撤销后即使 token 未过期也拒绝
  });
});
