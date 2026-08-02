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

  it('revoke() invalidates all refresh operations from the previous generation', async () => {
    const storage = new MemoryStorage();
    const auth = makeAuth();
    const pending = new Map<string, (tokens: SessionTokens) => void>();
    auth.refreshAccessToken = vi.fn(
      (refreshToken) =>
        new Promise<SessionTokens>((resolve) => {
          pending.set(refreshToken, resolve);
        }),
    );
    const c = new SessionController(storage, auth);
    await c.activate(makeTokens(), profile);

    const refreshA = c.refresh('refresh-a');
    const refreshB = c.refresh('refresh-b');
    await c.revoke();
    pending.get('refresh-a')?.({
      ...makeTokens(),
      accessToken: 'access-a-old',
      refreshToken: 'refresh-a-2',
    });
    pending.get('refresh-b')?.({
      ...makeTokens(),
      accessToken: 'access-b-old',
      refreshToken: 'refresh-b-2',
    });
    await Promise.all([refreshA, refreshB]);

    expect(c.snapshot).toEqual({ phase: 'SIGNED_OUT', profile: null, tokens: null });
    expect(storage.loadRefreshToken()).toBeNull();
  });

  it('a delayed old revoke cannot invalidate a newly activated session', async () => {
    const storage = new MemoryStorage();
    const auth = makeAuth();
    let resolveRevoke!: () => void;
    auth.revoke = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    const c = new SessionController(storage, auth);
    await c.activate(makeTokens(), profile);

    await c.revoke();
    const newTokens = {
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      accessExpiresAt: Date.now() + 15 * 60_000,
    };
    const newProfile = { userId: 'u2', deviceId: 'dev-2', nickname: 'Bob' };
    await c.activate(newTokens, newProfile);
    resolveRevoke();
    await Promise.resolve();

    expect(auth.revoke).toHaveBeenCalledWith('refresh-1');
    expect(c.snapshot).toEqual({ phase: 'ACTIVE', profile: newProfile, tokens: newTokens });
    expect(storage.loadRefreshToken()).toBe('refresh-new');
  });

  it('revoke() immediately signs out while restore refresh is pending', async () => {
    const storage = new MemoryStorage();
    storage.saveRefreshToken('refresh-1');
    const auth = makeAuth();
    let resolveRefresh!: (tokens: SessionTokens) => void;
    let resolveRevoke!: () => void;
    auth.refreshAccessToken = vi.fn(
      () =>
        new Promise<SessionTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    auth.revoke = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    const c = new SessionController(storage, auth);

    const restorePromise = c.restore();
    const revokePromise = c.revoke();
    expect(c.snapshot).toEqual({ phase: 'SIGNED_OUT', profile: null, tokens: null });
    expect(storage.loadRefreshToken()).toBeNull();
    expect(auth.revoke).toHaveBeenCalledWith('refresh-1');

    resolveRefresh({ ...makeTokens(), accessToken: 'access-old', refreshToken: 'refresh-2' });
    await restorePromise;
    expect(c.snapshot).toEqual({ phase: 'SIGNED_OUT', profile: null, tokens: null });
    expect(storage.loadRefreshToken()).toBeNull();

    resolveRevoke();
    await revokePromise;
  });

  it('activate() invalidates all refresh operations from the previous account', async () => {
    const storage = new MemoryStorage();
    const auth = makeAuth();
    const pending = new Map<string, (tokens: SessionTokens) => void>();
    auth.refreshAccessToken = vi.fn(
      (refreshToken) =>
        new Promise<SessionTokens>((resolve) => {
          pending.set(refreshToken, resolve);
        }),
    );
    const c = new SessionController(storage, auth);
    await c.activate(makeTokens(), profile);

    const refreshA = c.refresh('refresh-a');
    const refreshB = c.refresh('refresh-b');
    const newProfile = { userId: 'u2', deviceId: 'dev-2', nickname: 'Bob' };
    const newTokens = {
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      accessExpiresAt: Date.now() + 15 * 60_000,
    };
    await c.activate(newTokens, newProfile);
    pending.get('refresh-a')?.({
      ...makeTokens(),
      accessToken: 'access-a-old',
      refreshToken: 'refresh-a-2',
    });
    pending.get('refresh-b')?.({
      ...makeTokens(),
      accessToken: 'access-b-old',
      refreshToken: 'refresh-b-2',
    });
    await Promise.all([refreshA, refreshB]);

    expect(c.snapshot).toEqual({ phase: 'ACTIVE', profile: newProfile, tokens: newTokens });
    expect(storage.loadRefreshToken()).toBe('refresh-new');
  });

  it('isolates A → B → A refresh operations and reuses the matching A operation', async () => {
    const storage = new MemoryStorage();
    const auth = makeAuth();
    const pending = new Map<string, (tokens: SessionTokens) => void>();
    auth.refreshAccessToken = vi.fn(
      (refreshToken) =>
        new Promise<SessionTokens>((resolve) => {
          pending.set(refreshToken, resolve);
        }),
    );
    const c = new SessionController(storage, auth);

    const firstA = c.refresh('refresh-a');
    const refreshB = c.refresh('refresh-b');
    const secondA = c.refresh('refresh-a');
    expect(secondA).toBe(firstA);
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(2);
    expect(auth.refreshAccessToken).toHaveBeenCalledWith('refresh-a');
    expect(auth.refreshAccessToken).toHaveBeenCalledWith('refresh-b');

    pending.get('refresh-a')?.({
      ...makeTokens(),
      accessToken: 'access-a',
      refreshToken: 'refresh-a-2',
    });
    const [firstAState, secondAState] = await Promise.all([firstA, secondA]);
    expect(firstAState).toEqual(secondAState);
    expect(c.snapshot).toEqual(firstAState);
    expect(storage.loadRefreshToken()).toBe('refresh-a-2');

    pending.get('refresh-b')?.({
      ...makeTokens(),
      accessToken: 'access-b',
      refreshToken: 'refresh-b-2',
    });
    await refreshB;
    expect(c.snapshot).toEqual(firstAState);
    expect(storage.loadRefreshToken()).toBe('refresh-a-2');
  });

  it('activate() saves refresh token to secure storage (8.3)', async () => {
    const storage = new MemoryStorage();
    const c = new SessionController(storage, makeAuth());
    await c.activate(makeTokens(), profile);
    expect(storage.loadRefreshToken()).toBe('refresh-1');
    expect(c.snapshot.profile).toEqual(profile);
    expect(c.snapshot.tokens?.accessToken).toBe('access-1');
  });

  it('invalid refresh rotation clears storage and transitions to EXPIRED', async () => {
    const storage = new MemoryStorage();
    storage.saveRefreshToken('stale');
    const auth = makeAuth();
    auth.refreshAccessToken = vi.fn(async () => {
      throw Object.assign(new Error('401 invalid_grant'), { invalidToken: true });
    });
    const c = new SessionController(storage, auth);
    await c.restore();
    expect(storage.loadRefreshToken()).toBeNull();
    expect(c.snapshot.phase).toBe('EXPIRED');
    expect(c.snapshot.profile).toBeNull();
    expect(c.snapshot.tokens).toBeNull();
    expect(c.snapshot.error).toContain('401');
  });

  it('transient refresh failure preserves the stored token and allows retry', async () => {
    const storage = new MemoryStorage();
    storage.saveRefreshToken('refresh-1');
    const auth = makeAuth();
    auth.refreshAccessToken = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('网络超时'), { invalidToken: false }))
      .mockResolvedValueOnce({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        accessExpiresAt: Date.now() + 15 * 60_000,
      });
    const c = new SessionController(storage, auth);

    await c.restore();
    expect(storage.loadRefreshToken()).toBe('refresh-1');
    expect(c.snapshot.phase).toBe('ERROR');
    expect(c.snapshot.error).toBe('网络超时');

    await c.refresh();
    expect(auth.refreshAccessToken).toHaveBeenLastCalledWith('refresh-1');
    expect(c.snapshot.phase).toBe('ACTIVE');
    expect(c.snapshot.profile).toEqual({ userId: 'u1', deviceId: 'dev-1', nickname: 'Alice' });
    expect(storage.loadRefreshToken()).toBe('refresh-2');
  });

  it('profile failure preserves newly rotated tokens and storage', async () => {
    const storage = new MemoryStorage();
    storage.saveRefreshToken('refresh-1');
    const auth = makeAuth();
    auth.loadProfile = vi.fn(async () => {
      throw new Error('资料响应无效');
    });
    const c = new SessionController(storage, auth);

    await c.restore();

    expect(storage.loadRefreshToken()).toBe('refresh-2');
    expect(c.snapshot.phase).toBe('ERROR');
    expect(c.snapshot.tokens?.accessToken).toBe('access-2');
    expect(c.snapshot.tokens?.refreshToken).toBe('refresh-2');
    expect(c.snapshot.error).toBe('资料响应无效');
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
