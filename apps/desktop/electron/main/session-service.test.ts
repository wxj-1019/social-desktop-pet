import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SessionController,
  type SessionAuthApi,
  type SessionProfile,
  type SessionStorage,
  type SessionTokens,
} from './session-controller.js';
import {
  createAuthApi,
  createSessionHandlers,
  loginWithBackend,
  registerWithBackend,
} from './session-service.js';

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

  it('refresh handler lets the controller resolve its stored token', async () => {
    const session = new SessionController(new MemoryStorage(), makeAuth());
    const refresh = vi.spyOn(session, 'refresh').mockResolvedValue(session.snapshot);
    const handlers = createSessionHandlers(session);

    await handlers.refresh();

    expect(refresh).toHaveBeenCalledWith(undefined);
  });

  it('loginWithBackend() uses a 15 second timeout and validates tokens', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ accessToken: 'access-1', refreshToken: 'refresh-1', userId: 'u1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const signal = AbortSignal.abort();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);

    await expect(
      loginWithBackend('https://pet.example', 'alice@example.com', 'password1', 'dev-1'),
    ).resolves.toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pet.example/auth/login',
      expect.objectContaining({ signal }),
    );
  });

  it('registerWithBackend() applies a 15 second timeout to register and login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: 'u1' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ accessToken: 'access-1', refreshToken: 'refresh-1', userId: 'u1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    const signal = AbortSignal.abort();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);

    await registerWithBackend(
      'https://pet.example',
      'alice@example.com',
      'password1',
      'dev-1',
      'Alice',
    );

    expect(AbortSignal.timeout).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://pet.example/auth/register',
      expect.objectContaining({ signal }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://pet.example/auth/login',
      expect.objectContaining({ signal }),
    );
  });

  it.each([
    ['login', () => loginWithBackend('https://pet.example', 'a@b.com', 'password1', 'dev-1')],
    [
      'register',
      () => registerWithBackend('https://pet.example', 'a@b.com', 'password1', 'dev-1', 'Alice'),
    ],
  ])('%s maps AbortError to a stable unavailable error', async (_name, request) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new DOMException('platform abort', 'AbortError'))),
    );

    await expect(request()).rejects.toMatchObject({
      message: expect.stringMatching(/服务暂时不可用/),
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing field', JSON.stringify({ accessToken: 'access-1', userId: 'u1' })],
    [
      'wrong field type',
      JSON.stringify({ accessToken: 1, refreshToken: 'refresh-1', userId: 'u1' }),
    ],
  ])('login rejects %s without activating the session', async (_name, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const storage = new MemoryStorage();
    const session = new SessionController(storage, makeAuth());
    const handlers = createSessionHandlers(session);

    await expect(
      handlers.login({ email: 'alice@example.com', password: 'password1', deviceId: 'dev-1' }),
    ).rejects.toMatchObject({ message: '登录响应无效' });
    expect(session.snapshot.phase).toBe('SIGNED_OUT');
    expect(storage.loadRefreshToken()).toBeNull();
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

  it.each([
    ['malformed JSON', '{'],
    ['missing field', JSON.stringify({ accessToken: 'access-2' })],
    ['wrong field type', JSON.stringify({ accessToken: 2, refreshToken: 'refresh-2' })],
  ])('refreshAccessToken() rejects %s with a stable transient error', async (_name, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    await expect(
      createAuthApi('https://pet.example').refreshAccessToken('refresh-1'),
    ).rejects.toMatchObject({ message: 'refresh 响应无效', invalidToken: false });
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
    ['network', new Error('socket closed')],
    ['abort', new DOMException('platform abort text', 'AbortError')],
  ])('loadProfile() maps %s failures to profile_unavailable', async (_caseName, error) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(error)),
    );

    await expect(
      createAuthApi('https://pet.example').loadProfile('access-1'),
    ).rejects.toMatchObject({ code: 'profile_unavailable', message: '资料服务暂时不可用' });
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing field', JSON.stringify({ userId: 'u1', nickname: 'Alice', device: {} })],
    [
      'wrong field type',
      JSON.stringify({ userId: 1, nickname: 'Alice', device: { deviceId: 'dev-1' } }),
    ],
  ])('loadProfile() maps %s to profile_invalid', async (_caseName, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    await expect(
      createAuthApi('https://pet.example').loadProfile('access-1'),
    ).rejects.toMatchObject({ code: 'profile_invalid', message: '资料响应无效' });
  });

  it('loadProfile() maps non-2xx backend errors to profile_http', async () => {
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

    await expect(
      createAuthApi('https://pet.example').loadProfile('access-1'),
    ).rejects.toMatchObject({ code: 'profile_http', message: 'profile forbidden' });
  });
});
