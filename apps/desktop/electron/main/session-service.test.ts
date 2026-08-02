import { describe, expect, it, vi } from 'vitest';

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

describe('session service', () => {
  it('init() returns the current snapshot without restoring again', async () => {
    const session = new SessionController(new MemoryStorage(), makeAuth());
    await session.activate(tokens, profile);
    const restore = vi.spyOn(session, 'restore');
    const handlers = createSessionHandlers(session);

    await expect(handlers.init()).resolves.toEqual({
      phase: 'ACTIVE',
      accessToken: 'access-1',
      profile,
    });
    expect(restore).not.toHaveBeenCalled();
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

    const result = await createAuthApi('https://pet.example').loadProfile('access-1');

    expect(result).toEqual(profile);
    expect(fetchMock).toHaveBeenCalledWith('https://pet.example/me', {
      headers: { authorization: 'Bearer access-1' },
    });
    vi.unstubAllGlobals();
  });
});
