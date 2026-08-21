import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PanelOpen, PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';

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
const PUSH_ONLY = new Set([
  'pet:runtime:snapshot',
  'pet:visual-command',
  'deeplink:payload',
  'pet:profile-changed',
]);

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
  const consumeDeepLinkPayload = vi.fn<() => string | null>(() => null);
  const consumePendingView = vi.fn<() => PanelOpen['view'] | null>(() => null);
  const showContextMenu = vi.fn();
  const setPassThrough = vi.fn();
  // 勿扰单一状态源：与 index.ts syncDnd 一致，先驱动 runtime（emitSnapshot 广播）
  const setDnd = vi.fn((enabled: boolean) => runtime.setDnd(enabled));
  const setPetScale = vi.fn();
  const getPetScale = vi.fn(() => 1);
  const setMenuCanvas = vi.fn();
  const hidePet = vi.fn();
  const showPet = vi.fn();
  const autoLaunch = {
    get: vi.fn(() => false),
    set: vi.fn(),
  };
  const localLlm = {
    view: vi.fn(() => ({ enabled: false, baseUrl: '', model: '', hasApiKey: false })),
    save: vi.fn(),
    chat: vi.fn(async () => ({ error: 'not_configured' })),
  };
  const reloadPetWithCharacter = vi.fn();
  const deps: PetIpcDependencies = {
    appVersion: '4.5.6-test',
    getPetWindow: () => asWindow(pet),
    getPanelWindow: () => asWindow(panel),
    runtime,
    drag,
    profile: profile as unknown as PetIpcDependencies['profile'],
    getDisplays: () => [{ id: 'primary', workArea: { x: 0, y: 0, width: 1000, height: 800 } }],
    openPanel,
    closePanel,
    consumeDeepLinkPayload,
    consumePendingView,
    showContextMenu,
    setPassThrough,
    setDnd,
    setPetScale,
    getPetScale,
    setMenuCanvas,
    hidePet,
    showPet,
    autoLaunch,
    localLlm,
    reloadPetWithCharacter,
  };
  return {
    pet,
    panel,
    runtime,
    drag,
    profile,
    openPanel,
    closePanel,
    consumeDeepLinkPayload,
    consumePendingView,
    showContextMenu,
    setPassThrough,
    setDnd,
    setPetScale,
    getPetScale,
    setMenuCanvas,
    autoLaunch,
    reloadPetWithCharacter,
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

describe('基础通道（Task 7）', () => {
  it('app:version returns the injected app version, not the window URL', async () => {
    const { pet, panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('app:version');

    await expect(handler?.(eventFrom(pet), undefined)).resolves.toBe('4.5.6-test');
    await expect(handler?.(eventFrom(panel), undefined)).resolves.toBe('4.5.6-test');
  });

  it('app:get-auto-launch is panel-only and returns the injected value', async () => {
    const { pet, panel, autoLaunch, deps } = makeDeps();
    autoLaunch.get.mockReturnValue(true);
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('app:get-auto-launch');

    await expect(handler?.(eventFrom(panel), undefined)).resolves.toBe(true);
    await expect(handler?.(eventFrom(pet), undefined)).rejects.toThrow(IpcSenderError);
  });

  it('app:set-auto-launch validates the payload and forwards to the injected port', () => {
    const { panel, autoLaunch, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('app:set-auto-launch');

    expect(() => handler?.(eventFrom(panel), { enabled: true })).not.toThrow();
    expect(autoLaunch.set).toHaveBeenCalledWith(true);
    expect(() => handler?.(eventFrom(panel), { enabled: 'yes' })).toThrow(IpcPayloadError);
    expect(autoLaunch.set).toHaveBeenCalledTimes(1);
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
      ['pet:set-hidden', { enabled: true }],
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
    const panelOnly: Array<[string, unknown]> = [
      ['panel:close', undefined],
      ['app:set-auto-launch', { enabled: true }],
      ['pet:set-online', { enabled: false }],
    ];
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

  it('pet:set-online forwards panel connectivity to the runtime and validates payload', () => {
    const { panel, runtime, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-online');

    expect(() => handler?.(eventFrom(panel), { enabled: false })).not.toThrow();
    expect(runtime.snapshot.state).toBe('OFFLINE');
    expect(() => handler?.(eventFrom(panel), { enabled: true })).not.toThrow();
    expect(runtime.snapshot.state).toBe('IDLE');
    expect(() => handler?.(eventFrom(panel), { enabled: 'yes' })).toThrow(IpcPayloadError);
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

  it('allows pet-profile:set from both surfaces（环形菜单"换肤"从宠物窗发起）', async () => {
    const { pet, panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('pet-profile:set');
    const profile = {
      version: 1,
      petId: 'star-isle',
      displayName: '星屿',
      reducedMotion: false,
      dnd: false,
      bubbleEnabled: true,
      menuStyle: 'classic',
    };

    expect(await handler?.(eventFrom(pet), profile)).toEqual(profile);
    expect(await handler?.(eventFrom(panel), profile)).toEqual(profile);
    // 面板窗也收到广播：面板侧 useCurrentCharacter 原地跟随（形象协议阶段 C）
    expect(panel.webContents.send).toHaveBeenCalledWith(
      'pet:profile-changed',
      expect.objectContaining({ petId: 'star-isle' }),
    );
  });

  it('pet:set-character 保存后广播面板（桌宠窗整窗重载，面板原地换视觉）', async () => {
    const { pet, panel, profile, reloadPetWithCharacter, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('pet:set-character');

    await expect(handler?.(eventFrom(panel), 'codenono')).resolves.toBe('codenono');
    expect(profile.save).toHaveBeenCalledWith(expect.objectContaining({ petId: 'codenono' }));
    expect(reloadPetWithCharacter).toHaveBeenCalledWith('codenono');
    // 桌宠窗走整窗重载（不发 profile-changed）；面板靠广播原地换装
    expect(pet.webContents.send).not.toHaveBeenCalled();
    expect(panel.webContents.send).toHaveBeenCalledWith(
      'pet:profile-changed',
      expect.objectContaining({ petId: 'codenono' }),
    );
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

  it('pet:set-dnd routes to the setDnd dependency（单一状态源）and flips the runtime flag', () => {
    const { pet, runtime, deps, setDnd, snapshots } = makeDeps();
    registerIpcAllowlist(deps);

    electronMocks.onHandlers.get('pet:set-dnd')?.(eventFrom(pet), { enabled: true });
    expect(setDnd).toHaveBeenCalledWith(true);
    // syncDnd 驱动 runtime → emitSnapshot 广播（面板/桌宠快照同步路径）
    expect(runtime.snapshot.dnd).toBe(true);
    expect(snapshots.at(-1)).toMatchObject({ dnd: true });
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

describe('pet:set-size / pet:get-size（桌宠大小调节）', () => {
  it('panel 发送合法 scale → setPetScale 被调用', () => {
    const { panel, deps, setPetScale } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-size');

    expect(() => handler?.(eventFrom(panel), { scale: 1.25 })).not.toThrow();
    expect(setPetScale).toHaveBeenCalledWith(1.25);
  });

  it('拒绝越界 scale（>2）', () => {
    const { panel, deps, setPetScale } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-size');

    expect(() => handler?.(eventFrom(panel), { scale: 3 })).toThrow(IpcPayloadError);
    expect(setPetScale).not.toHaveBeenCalled();
  });

  it('拒绝多余字段', () => {
    const { panel, deps, setPetScale } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-size');

    expect(() => handler?.(eventFrom(panel), { scale: 1, width: 999 })).toThrow(IpcPayloadError);
    expect(setPetScale).not.toHaveBeenCalled();
  });

  it('pet 窗口也可调节（右键档位走渲染层回调）', () => {
    const { pet, deps, setPetScale } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-size');

    expect(() => handler?.(eventFrom(pet), { scale: 0.75 })).not.toThrow();
    expect(setPetScale).toHaveBeenCalledWith(0.75);
  });

  it('pet:get-size 返回当前 scale', async () => {
    const { panel, deps, getPetScale } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers?.get('pet:get-size');

    await expect(handler?.(eventFrom(panel), undefined)).resolves.toBe(1);
    expect(getPetScale).toHaveBeenCalled();
  });

  it('pet 窗口也可查询 scale（环形菜单画布锚定需要缩放比例）', async () => {
    const { pet, deps, getPetScale } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers?.get('pet:get-size');

    await expect(handler?.(eventFrom(pet), undefined)).resolves.toBe(1);
    expect(getPetScale).toHaveBeenCalled();
  });
});

describe('pet:set-menu-canvas（环形菜单画布扩窗）', () => {
  it('pet 窗发送 expanded:true → setMenuCanvas 被调用', () => {
    const { pet, deps, setMenuCanvas } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-menu-canvas');

    expect(() => handler?.(eventFrom(pet), { expanded: true })).not.toThrow();
    expect(setMenuCanvas).toHaveBeenCalledWith(true);
  });

  it('拒绝非法 payload（expanded 非布尔 / 多余字段）', () => {
    const { pet, deps, setMenuCanvas } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-menu-canvas');

    expect(() => handler?.(eventFrom(pet), { expanded: 'yes' })).toThrow(IpcPayloadError);
    expect(() => handler?.(eventFrom(pet), { expanded: true, extra: 1 })).toThrow(IpcPayloadError);
    expect(setMenuCanvas).not.toHaveBeenCalled();
  });

  it('panel 窗越权调用被拒绝（画布通道仅 pet 窗的环形菜单使用）', () => {
    const { panel, deps, setMenuCanvas } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:set-menu-canvas');

    expect(() => handler?.(eventFrom(panel), { expanded: true })).toThrow(IpcSenderError);
    expect(setMenuCanvas).not.toHaveBeenCalled();
  });
});

describe('pet:social-event（好友送礼 → 桌宠反应）', () => {
  it('panel 发送合法礼物事件 → happy 表情 + happy 动作 + 气泡', () => {
    const { panel, visuals, runtime, deps } = makeDeps();
    registerIpcAllowlist(deps);
    runtime.start(); // 进入 IDLE，cheer 才在白名单
    const handler = electronMocks.onHandlers.get('pet:social-event');

    expect(() =>
      handler?.(eventFrom(panel), {
        type: 'gift.snack_sent',
        giftId: 'gift-1',
        snackId: 'snack_cookie',
        fromUserId: 'user-1',
        fromNickname: 'Alice',
      }),
    ).not.toThrow();
    expect(visuals).toContainEqual({ type: 'expression', expression: 'happy' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'happy', intensity: 1 });
    expect(visuals).toContainEqual({ type: 'bubble', text: 'Alice 送来了小饼干！' });
    runtime.stop();
  });

  it('pet 窗口也可发送礼物事件（无昵称回退"好友"）', () => {
    const { pet, visuals, runtime, deps } = makeDeps();
    registerIpcAllowlist(deps);
    runtime.start();
    const handler = electronMocks.onHandlers.get('pet:social-event');

    expect(() =>
      handler?.(eventFrom(pet), {
        type: 'gift.snack_sent',
        giftId: 'gift-2',
        snackId: 'snack_candy',
        fromUserId: 'user-2',
      }),
    ).not.toThrow();
    expect(visuals).toContainEqual({ type: 'bubble', text: '好友 送来了糖果！' });
    runtime.stop();
  });

  it('拒绝多余字段的礼物事件', () => {
    const { panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:social-event');

    expect(() =>
      handler?.(eventFrom(panel), {
        type: 'gift.snack_sent',
        giftId: 'gift-3',
        snackId: 'snack_cookie',
        fromUserId: 'user-3',
        toUserId: 'user-4',
      }),
    ).toThrow(IpcPayloadError);
  });

  it('拒绝未知 type 的社交事件', () => {
    const { panel, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.onHandlers.get('pet:social-event');

    expect(() =>
      handler?.(eventFrom(panel), {
        type: 'gift.visit',
        giftId: 'gift-4',
        snackId: 'snack_cookie',
        fromUserId: 'user-3',
      }),
    ).toThrow(IpcPayloadError);
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

    expect(() => handler?.(eventFrom(panel), { view: 'unknown' })).toThrow(IpcPayloadError);
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

  it('deeplink:consume-pending returns the pending payload (panel only; 拉取即清除由 deps 实现)', async () => {
    const { panel, deps, consumeDeepLinkPayload } = makeDeps();
    consumeDeepLinkPayload.mockReturnValue('raw-token-abc');
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('deeplink:consume-pending');

    await expect(handler?.(eventFrom(panel), undefined)).resolves.toBe('raw-token-abc');
  });

  it('deeplink:consume-pending rejects pet-window callers', async () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('deeplink:consume-pending');

    await expect(handler?.(eventFrom(pet), undefined)).rejects.toThrow(IpcSenderError);
  });

  it('panel:consume-pending-view returns the buffered navigation intent (panel only)', async () => {
    const { panel, deps, consumePendingView } = makeDeps();
    consumePendingView.mockReturnValue('character');
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('panel:consume-pending-view');

    await expect(handler?.(eventFrom(panel), undefined)).resolves.toBe('character');
  });

  it('panel:consume-pending-view rejects pet-window callers', async () => {
    const { pet, deps } = makeDeps();
    registerIpcAllowlist(deps);
    const handler = electronMocks.invokeHandlers.get('panel:consume-pending-view');

    await expect(handler?.(eventFrom(pet), undefined)).rejects.toThrow(IpcSenderError);
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
