import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SessionController,
  type SessionAuthApi,
  type SessionProfile,
  type SessionStorage,
  type SessionTokens,
} from './session-controller.js';
import { createAuthApi, createSessionHandlers } from './session-service.js';

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

const profile: SessionProfile = { userId: 'u1', deviceId: 'dev-1', nickname: 'Alice' };
const tokens: SessionTokens = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: Date.now() + 15 * 60_000,
};

function makeAuth(): SessionAuthApi {
  return {
    refreshAccessToken: vi.fn(async () => tokens),
    loadProfile: vi.fn(async () => profile),
    revoke: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('session service', () => {
  it('init() waits for the single restore promise without restoring again', async () => {
    const storage = new MemoryStorage();
    storage.saveRefreshToken('refresh-1');
    const auth = makeAuth();
    let resolveRefresh!: (tokens: SessionTokens) => void;
    auth.refreshAccessToken = vi.fn(
      () =>
        new Promise<SessionTokens>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const session = new SessionController(storage, auth);
    const restore = vi.spyOn(session, 'restore');
    const restorePromise = session.restore();
    const handlers = createSessionHandlers(session, undefined, restorePromise);
    let settled = false;

    const initPromise = handlers.init().finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(restore).toHaveBeenCalledTimes(1);

    resolveRefresh({ ...tokens, accessToken: 'access-2', refreshToken: 'refresh-2' });
    await expect(initPromise).resolves.toEqual({
      phase: 'ACTIVE',
      accessToken: 'access-2',
      profile,
    });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('loadProfile() loads the authenticated device profile', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            userId: 'u1',
            nickname: 'Alice',
            device: { deviceId: 'dev-1' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const signal = AbortSignal.abort();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const result = await createAuthApi('https://pet.example').loadProfile('access-1');

    expect(result).toEqual(profile);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock).toHaveBeenCalledWith('https://pet.example/me', {
      headers: { authorization: 'Bearer access-1' },
      signal,
    });
  });

  it('refreshAccessToken() uses a 15 second timeout', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accessToken: 'access-2', refreshToken: 'refresh-2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const signal = AbortSignal.abort();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);

    await createAuthApi('https://pet.example').refreshAccessToken('refresh-1');

    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock).toHaveBeenCalledWith('https://pet.example/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-1' }),
      signal,
    });
  });

  it.each([401, 403])('refreshAccessToken() marks HTTP %s as an invalid token', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid refresh' }), { status })),
    );

    await expect(
      createAuthApi('https://pet.example').refreshAccessToken('refresh-1'),
    ).rejects.toMatchObject({ message: 'invalid refresh', invalidToken: true });
  });

  it.each([
    ['network', new Error('socket closed')],
    ['timeout', new DOMException('timed out', 'TimeoutError')],
  ])('refreshAccessToken() marks %s failures as transient', async (_caseName, error) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(error)),
    );

    await expect(
      createAuthApi('https://pet.example').refreshAccessToken('refresh-1'),
    ).rejects.toMatchObject({ message: error.message, invalidToken: false });
  });

  it('refreshAccessToken() marks HTTP 5xx as transient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'service unavailable' }), { status: 503 }),
      ),
    );

    await expect(
      createAuthApi('https://pet.example').refreshAccessToken('refresh-1'),
    ).rejects.toMatchObject({ message: 'service unavailable', invalidToken: false });
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing field', JSON.stringify({ userId: 'u1', nickname: 'Alice', device: {} })],
    [
      'wrong field type',
      JSON.stringify({ userId: 1, nickname: 'Alice', device: { deviceId: 'dev-1' } }),
    ],
  ])('loadProfile() rejects %s with a stable error', async (_caseName, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    await expect(createAuthApi('https://pet.example').loadProfile('access-1')).rejects.toThrow(
      '资料响应无效',
    );
  });

  it('loadProfile() preserves a stable non-2xx backend error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'profile forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    await expect(createAuthApi('https://pet.example').loadProfile('access-1')).rejects.toThrow(
      'profile forbidden',
    );
  });
});
