import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionServiceHandlers } from '../session-service.js';

const electronMocks = vi.hoisted(() => ({
  invokeHandlers: new Map<
    string,
    (event: unknown, payload: unknown) => Promise<unknown> | unknown
  >(),
  handle: vi.fn(),
  on: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  ipcMain: {
    handle: electronMocks.handle.mockImplementation((channel, handler) => {
      electronMocks.invokeHandlers.set(channel, handler);
    }),
    on: electronMocks.on,
  },
  screen: { getAllDisplays: vi.fn(() => []) },
}));

import { registerIpcAllowlist } from './register.js';

function makeHandlers(): SessionServiceHandlers {
  const result = { phase: 'SIGNED_OUT' as const, accessToken: null, profile: null };
  return {
    init: vi.fn(async () => result),
    login: vi.fn(async () => result),
    register: vi.fn(async () => result),
    refresh: vi.fn(async () => result),
    revoke: vi.fn(async () => result),
  };
}

beforeEach(() => {
  electronMocks.invokeHandlers.clear();
  electronMocks.handle.mockClear();
  electronMocks.on.mockClear();
});

describe('session IPC payload validation', () => {
  it.each([
    [
      'bad email',
      'session:login',
      { email: 'invalid', password: 'password1', deviceId: crypto.randomUUID() },
    ],
    [
      'bad device',
      'session:login',
      { email: 'a@b.com', password: 'password1', deviceId: 'not-a-uuid' },
    ],
    [
      'bad nickname',
      'session:register',
      { email: 'a@b.com', password: 'password1', deviceId: crypto.randomUUID(), nickname: '' },
    ],
  ])('rejects %s without calling the service', async (_name, channel, payload) => {
    const handlers = makeHandlers();
    registerIpcAllowlist(() => null, handlers);
    const ipcHandler = electronMocks.invokeHandlers.get(channel);

    await expect(ipcHandler?.({}, payload)).resolves.toMatchObject({ error: expect.any(String) });
    expect(handlers.login).not.toHaveBeenCalled();
    expect(handlers.register).not.toHaveBeenCalled();
  });
});
