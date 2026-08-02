import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';
import {
  SessionManager,
  SessionRotationError,
  type RefreshSession,
  type SessionStore,
} from '../auth/session.js';

import { createAuthRouter, type AuthDeps } from './auth.js';

class MemoryStore implements SessionStore {
  async save(_session: RefreshSession): Promise<void> {}
  async load(_tokenHash: string): Promise<RefreshSession | null> {
    return null;
  }
  async revokeDevice(_userId: string, _deviceId: string): Promise<void> {}
  async setActiveDisplayDevice(_userId: string, _deviceId: string): Promise<void> {}
}

function makeDeps(): AuthDeps {
  return {
    jwt: new JwtService({ secret: 'test-secret-at-least-32-bytes-long' }),
    sessions: new SessionManager(new MemoryStore()),
    store: new MemoryStore(),
    users: {
      findByEmail: vi.fn(async () => null),
      create: vi.fn(async () => 'u1'),
    },
    devices: {
      register: vi.fn(async () => undefined),
    },
  };
}

async function requestRefresh(deps: AuthDeps): Promise<Response> {
  return createAuthRouter(deps).request('/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: 'refresh-1' }),
  });
}

describe('auth refresh route', () => {
  it.each(['invalid', 'revoked', 'expired'] as const)(
    'maps %s rotation errors to a stable 401 response',
    async (code) => {
      const deps = makeDeps();
      vi.spyOn(deps.sessions, 'rotate').mockRejectedValue(
        new SessionRotationError(code, `refresh token ${code}`),
      );

      const response = await requestRefresh(deps);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'refresh_invalid' });
    },
  );

  it('does not misclassify unknown rotation failures as invalid refresh', async () => {
    const deps = makeDeps();
    const failure = new Error('database unavailable');
    vi.spyOn(deps.sessions, 'rotate').mockRejectedValue(failure);
    const app = createAuthRouter(deps);
    const onError = vi.fn((_error: Error) => new Response('internal error', { status: 500 }));
    app.onError(onError);

    const response = await app.request('/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-1' }),
    });

    expect(onError).toHaveBeenCalledWith(failure, expect.anything());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('refresh_invalid');
  });
});
