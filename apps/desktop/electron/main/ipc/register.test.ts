import type { PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PetDragController } from '../pet-drag-controller.js';
import { PetRuntimeController } from '../pet-runtime-controller.js';
import { IPC_ALLOWLIST } from '../security.js';
import type { SessionServiceHandlers } from '../session-service.js';

import { IpcPayloadError, IpcSenderError } from './ipc-validation.js';
import { registerIpcAllowlist } from './register.js';
import type { PetIpcDependencies } from './register.js';

const electronMocks = vi.hoisted(() => {
  const windows = new Map<unknown, unknown>();
  const invokeHandlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const onHandlers = new Map<string, (event: unknown, payload: unknown) => void>();
  return {
    windows,
    invokeHandlers,
    onHandlers,
    fromWebContents: vi.fn((webContents: unknown) => windows.get(webContents) ?? null),
    handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      // 与真实 ipcMain.handle 一致：handler 同步抛错也变成 invoke rejection
      invokeHandlers.set(channel, (event, payload) => {
        try {
          return Promise.resolve(handler(event, payload));
        } catch (error) {
          return Promise.reject(error);
        }
      });
    }),
    on: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => void) => {
      onHandlers.set(channel, handler);
    }),
    getAllDisplays: vi.fn(() => []),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  ipcMain: { handle: electronMocks.handle, on: electronMocks.on },
  screen: { getAllDisplays: electronMocks.getAllDisplays },
}));

/** 生产打包后渲染入口（pathname 以 /renderer/index.html 结尾） */
const PROD_URL = (surface: 'pet' | 'panel') =>
  `file:///E:/app/out/renderer/index.html?surface=${surface}`;

/** 推送专用通道：main→renderer，无 renderer→main handler */
const PUSH_ONLY = new Set(['pet:runtime:snapshot', 'pet:visual-command', 'deeplink:payload']);

type FakeWindow = {
  id: string;
  webContents: {
    mainFrame: { url: string };
    send: ReturnType<typeof vi.fn>;
    getURL: () => string;
  };
  getBounds: () => { x: number; y: number; width: number; height: number };
  setPosition: ReturnType<typeof vi.fn>;
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
  minimize: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
};

function makeWindow(id: string, surface: 'pet' | 'panel'): FakeWindow {
  const frame = { url: PROD_URL(surface) };
  const win: FakeWindow = {
    id,
    webContents: {
      mainFrame: frame,
      send: vi.fn(),
      getURL: () => frame.url,
    },
    getBounds: () => ({ x: 0, y: 0, width: 280, height: 320 }),
    setPosition: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    minimize: vi.fn(),
    hide: vi.fn(),
  };
  electronMocks.windows.set(win.webContents, win);
  return win;
}

function eventFrom(win: FakeWindow): { sender: unknown; senderFrame: unknown } {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame };
}

function asWindow(win: FakeWindow): BrowserWindow {
  return win as unknown as BrowserWindow;
}

function makeDeps() {
  const pet = makeWindow('pet', 'pet');
  const panel = makeWindow('panel', 'panel');
  const snapshots: PetRuntimeSnapshot[] = [];
  const visuals: PetVisualCommand[] = [];
  const runtime = new PetRuntimeController({
    emitSnapshot: (s) => snapshots.push(s),
    emitVisual: (c) => visuals.push(c),
  });
  const drag = new PetDragController();
  const profile = {
    load: vi.fn(() => ({
      version: 1,
      petId: 'star-isle',
      displayName: '星屿',
      reducedMotion: false,
      dnd: false,
      bubbleEnabled: true,
    })),
    save: vi.fn(),
  };
  const openPanel = vi.fn();
  const closePanel = vi.fn();
  const showContextMenu = vi.fn();
  const setPassThrough = vi.fn();
  const deps: PetIpcDependencies = {
    getPetWindow: () => asWindow(pet),
    getPanelWindow: () => asWindow(panel),
    runtime,
    drag,
    profile: profile as unknown as PetIpcDependencies['profile'],
    getDisplays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1000, height: 800 } }],
    openPanel,
    closePanel,
    showContextMenu,
    setPassThrough,
  };
  return {
    pet,
    panel,
    runtime,
    drag,
    profile,
    openPanel,
    closePanel,
    showContextMenu,
    setPassThrough,
    deps,
    snapshots,
    visuals,
  };
}

function makeSessionHandlers(): SessionServiceHandlers {
  const result = { phase: 'SIGNED_OUT' as const, accessToken: null, profile: null };
  return {
    init: vi.fn(async () => result),
    login: vi.fn(async () => result),
    register: vi.fn(async () => result),
    refresh: vi.fn(async () => result),
    revoke: vi.fn(async () => result),
  };
}

/** process.env 的写入/删除辅助（@types/node 将 ELECTRON_RENDERER_URL 标为 readonly） */
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  electronMocks.windows.clear();
  electronMocks.invokeHandlers.clear();
  electronMocks.onHandlers.clear();
  electronMocks.handle.mockClear();
  electronMocks.on.mockClear();
  electronMocks.fromWebContents.mockClear();
  electronMocks.getAllDisplays.mockClear();
  delete env.ELECTRON_RENDERER_URL;
});

describe('session IPC payload validation（Task 1 基线）', () => {
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
    const handlers = makeSessionHandlers();
    const { panel, deps } = makeDeps();
    registerIpcAllowlist({ ...deps, sessionHandlers: handlers });
    const ipcHandler = electronMocks.invokeHandlers.get(channel);

    await expect(ipcHandler?.(eventFrom(panel), payload)).resolves.toMatchObject({
      error: expect.any(String),
    });
    expect(handlers.login).not.toHaveBeenCalled();
    expect(handlers.register).not.toHaveBeenCalled();
  });

  it('forwards a valid login from the panel surface to the service', async () => {
    const handlers = makeSessionHandlers();
    const { panel, deps } = makeDeps();
    registerIpcAllowlist({ ...deps, sessionHandlers: handlers });
    const payload = { email: 'a@b.com', password: 'password1', deviceId: crypto.randomUUID() };

    await electronMocks.invokeHandlers.get('session:login')?.(eventFrom(panel), payload);
    expect(handlers.login).toHaveBeenCalledWith(payload);
  });

  it('blocks session calls from the pet surface', async () => {
    const handlers = makeSessionHandlers();
    const { pet, deps } = makeDeps();
    registerIpcAllowlist({ ...deps, sessionHandlers: handlers });

    const result = await electronMocks.invokeHandlers.get('session:init')?.(
      eventFrom(pet),
      undefined,
    );
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(handlers.init).not.toHaveBeenCalled();
  });
});

describe('channel-to-surface binding（Task 7）', () => {
  it('rejects pet-only on-channels when the panel window sends', () => {
    const { panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const petOnly: Array<[string, unknown]> = [
      ['pet:interaction', { kind: 'head_touch' }],
      ['pet:drag-start', { x: 10, y: 20 }],
      ['pet:drag-move', { x: 30, y: 40 }],
      ['pet:drag-end', undefined],
      ['pet:set-dnd', { enabled: true }],
      ['pet:set-pass-through', { enabled: true }],
      ['pet:show-context-menu', undefined],
    ];
    for (const [channel, payload] of petOnly) {
      const handler = electronMocks.onHandlers.get(channel);
      expect(() => handler?.(eventFrom(panel), payload), channel).toThrow(IpcSenderError);
    }
  });

  it('rejects panel-only on-channels when the pet window sends', () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const panelOnly: Array<[string, unknown]> = [['panel:close', undefined]];
    for (const [channel, payload] of panelOnly) {
      const handler = electronMocks.onHandlers.get(channel);
      expect(() => handler?.(eventFrom(pet), payload), channel).toThrow(IpcSenderError);
    }
  });

  it('allows pet:chat-event from the panel window（本地模式聊天驱动桌宠）', () => {
    const { panel, visuals, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:chat-event');

    expect(() =>
      handler?.(eventFrom(panel), { phase: 'start', source: 'local_chat', text: '你好' }),
    ).not.toThrow();
    // handleChatStart 一定广播 speaking 视觉指令（状态无关）
    expect(visuals).toContainEqual({ type: 'speaking', active: true });
  });

  it('allows panel:open from the pet window（桌宠双击打开面板）', () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('panel:open');

    expect(() => handler?.(eventFrom(pet), { view: 'chat' })).not.toThrow();
    expect(deps.openPanel).toHaveBeenCalledWith({ view: 'chat' });
  });

  it('rejects pet-only invoke channels when the panel window sends', async () => {
    const { panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('pet:request-action');

    await expect(
      handler?.(eventFrom(panel), { intent: 'wave', source: 'local_chat' }),
    ).rejects.toThrow(IpcSenderError);
  });

  it('rejects panel-only invoke channels when the pet window sends', async () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('pet-profile:set');

    await expect(
      handler?.(eventFrom(pet), {
        version: 1,
        petId: 'star-isle',
        displayName: '星屿',
        reducedMotion: false,
        dnd: false,
        bubbleEnabled: true,
      }),
    ).rejects.toThrow(IpcSenderError);
  });

  it('allows pet:runtime:get from both surfaces', async () => {
    const { pet, panel, runtime, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('pet:runtime:get');

    expect(await handler?.(eventFrom(pet), undefined)).toEqual(runtime.snapshot);
    expect(await handler?.(eventFrom(panel), undefined)).toEqual(runtime.snapshot);
  });
});

describe('allowlist 与实际注册一一对应（Task 7）', () => {
  it('registers exactly the allowlist channels (minus push-only) and nothing outside', () => {
    const handlers = makeSessionHandlers();
    const { deps } = makeDeps();
    registerIpcAllowlist({ ...deps, sessionHandlers: handlers });

    const registered = new Set([
      ...electronMocks.invokeHandlers.keys(),
      ...electronMocks.onHandlers.keys(),
    ]);
    const expected = new Set(IPC_ALLOWLIST.filter((channel) => !PUSH_ONLY.has(channel)));
    expect(registered).toEqual(expected);

    // 反向检查：没有任何 allowlist 之外的 handle/on
    for (const channel of registered) {
      expect(IPC_ALLOWLIST).toContain(channel);
    }
  });
});

describe('pet payload 校验（Task 7）', () => {
  it('rejects a malformed interaction payload', () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:interaction');

    expect(() => handler?.(eventFrom(pet), { kind: 'pet_head' })).toThrow(IpcPayloadError);
  });

  it('rejects a non-finite drag point', () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:drag-start');

    expect(() => handler?.(eventFrom(pet), { x: Number.NaN, y: 1 })).toThrow(IpcPayloadError);
  });

  it('rejects a pet profile whose petId is not star-isle', async () => {
    const { panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('pet-profile:set');

    await expect(
      handler?.(eventFrom(panel), {
        version: 1,
        petId: 'other-pet',
        displayName: 'x',
        reducedMotion: false,
        dnd: false,
        bubbleEnabled: true,
      }),
    ).rejects.toThrow(IpcPayloadError);
  });

  it('rejects window:setIgnoreMouseEvents sent as a raw boolean', () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('window:setIgnoreMouseEvents');

    expect(() => handler?.(eventFrom(pet), true)).toThrow(IpcPayloadError);
  });
});

describe('pet runtime 通道（Task 7）', () => {
  it('pet:interaction routes to the runtime and emits a visual', () => {
    const { pet, visuals, runtime, deps } = makeDeps();
    registerIpcAllowlist(deps);
    runtime.start(); // 进入 IDLE，动作审批才放行触摸

    electronMocks.onHandlers.get('pet:interaction')?.(eventFrom(pet), { kind: 'head_touch' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'touch', intensity: 1 });
    runtime.stop();
  });

  it('pet:request-action returns the approved decision', async () => {
    const { pet, runtime, deps } = makeDeps();
    registerIpcAllowlist(deps);
    runtime.start();
    const handler = electronMocks.invokeHandlers.get('pet:request-action');

    const decision = await handler?.(eventFrom(pet), {
      intent: 'wave',
      source: 'local_interaction',
    });
    expect(decision).toMatchObject({ approved: true, intent: 'wave' });
    runtime.stop();
  });

  it('pet:set-dnd flips the runtime flag and broadcasts a snapshot to the panel', () => {
    const { pet, panel, runtime, deps } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('pet:set-dnd')?.(eventFrom(pet), { enabled: true });
    expect(runtime.snapshot.dnd).toBe(true);
    expect(panel.webContents.send).toHaveBeenCalledWith(
      'pet:runtime:snapshot',
      expect.objectContaining({ dnd: true }),
    );
  });

  it('pet:set-pass-through forwards to the setPassThrough dependency', () => {
    const { pet, deps, setPassThrough } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('pet:set-pass-through')?.(eventFrom(pet), { enabled: true });
    expect(setPassThrough).toHaveBeenCalledWith(true);
  });

  it('pet:show-context-menu invokes the context-menu dependency', () => {
    const { pet, deps, showContextMenu } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('pet:show-context-menu')?.(eventFrom(pet), undefined);
    expect(showContextMenu).toHaveBeenCalled();
  });
});

describe('pet drag 通道（Task 7）', () => {
  it('pet:drag-start + pet:drag-move moves the pet window by the pointer offset', () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('pet:drag-start')?.(eventFrom(pet), { x: 120, y: 70 });
    electronMocks.onHandlers.get('pet:drag-move')?.(eventFrom(pet), { x: 220, y: 170 });
    // 窗口在 (0,0)，按下 (120,70) → 偏移 (-120,-70)；移指针 (220,170) → 目标 (100,100)
    expect(pet.setPosition).toHaveBeenCalledWith(100, 100);
  });

  it('pet:drag-end ends the drag so later moves are ignored', () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('pet:drag-start')?.(eventFrom(pet), { x: 10, y: 10 });
    electronMocks.onHandlers.get('pet:drag-end')?.(eventFrom(pet), undefined);
    electronMocks.onHandlers.get('pet:drag-move')?.(eventFrom(pet), { x: 500, y: 500 });
    expect(pet.setPosition).not.toHaveBeenCalled();
  });
});

describe('panel 通道（Task 7）', () => {
  it('panel:open forwards the parsed view to openPanel', () => {
    const { panel, deps, openPanel } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('panel:open')?.(eventFrom(panel), { view: 'chat' });
    expect(openPanel).toHaveBeenCalledWith({ view: 'chat' });
  });

  it('panel:open rejects an unknown view', () => {
    const { panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('panel:open');

    expect(() => handler?.(eventFrom(panel), { view: 'settings' })).toThrow(IpcPayloadError);
  });

  it('panel:close hides the panel via closePanel', () => {
    const { panel, deps, closePanel } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('panel:close')?.(eventFrom(panel), undefined);
    expect(closePanel).toHaveBeenCalled();
  });

  it('panel:navigate broadcasts the view back to the panel window', async () => {
    const { panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('panel:navigate');

    await handler?.(eventFrom(panel), { view: 'friends' });
    expect(panel.webContents.send).toHaveBeenCalledWith('panel:navigate', { view: 'friends' });
  });
});

describe('pet-profile 通道（Task 7）', () => {
  it('pet-profile:set saves and returns the parsed profile', async () => {
    const { panel, deps, profile } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('pet-profile:set');
    const next = {
      version: 1,
      petId: 'star-isle',
      displayName: '星屿二号',
      reducedMotion: true,
      dnd: false,
      bubbleEnabled: true,
    };

    const result = await handler?.(eventFrom(panel), next);
    expect(profile.save).toHaveBeenCalledWith(next);
    expect(result).toEqual(next);
  });
});
