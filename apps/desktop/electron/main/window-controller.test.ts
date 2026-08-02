import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Electron 在非 Electron 运行时只导出路径字符串，必须 mock（与 ipc/register.test.ts 一致）。
// 测试始终注入 runtime 端口，因此真实 BrowserWindow/screen 不会被调用。
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  screen: { getAllDisplays: vi.fn(), getDisplayNearestPoint: vi.fn() },
}));

import type { DisplayInfo } from './display-controller.js';
import {
  createPanelWindow,
  createPetWindow,
  loadRendererSurface,
  setPassThrough,
  PANEL_WINDOW_SIZE,
  PET_WINDOW_SIZE,
  type PanelWindowHandle,
  type WindowControllerRuntime,
} from './window-controller.js';

const dualDisplays: DisplayInfo[] = [
  { id: 'primary', workArea: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 1 },
  { id: 'left', workArea: { x: -1280, y: 0, width: 1280, height: 800 }, scaleFactor: 1.5 },
];

/** 测试用最小 BrowserWindow fake */
interface FakeWindow {
  once: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  getPosition: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  webContents: { send: ReturnType<typeof vi.fn> };
  listeners: Map<string, (...args: unknown[]) => void>;
  position: number[];
  shown: boolean;
  hidden: boolean;
  focused: boolean;
  emitOnce(event: string): void;
  emit(event: string, ...args: unknown[]): void;
}

function makeFake(): FakeWindow {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const state = {
    position: [0, 0] as number[],
    shown: false,
    hidden: false,
    focused: false,
  };
  return {
    once: vi.fn((event: string, cb: () => void) => void listeners.set(`once:${event}`, cb)),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => void listeners.set(event, cb)),
    show: vi.fn(() => void (state.shown = true)),
    hide: vi.fn(() => void (state.hidden = true)),
    focus: vi.fn(() => void (state.focused = true)),
    getPosition: vi.fn(() => [...state.position]),
    getBounds: vi.fn(() => ({ x: state.position[0], y: state.position[1], width: 0, height: 0 })),
    setPosition: vi.fn((x: number, y: number) => void (state.position = [x, y])),
    setIgnoreMouseEvents: vi.fn(() => undefined),
    loadURL: vi.fn(() => undefined),
    loadFile: vi.fn(() => undefined),
    webContents: { send: vi.fn() },
    listeners,
    position: state.position,
    get shown() {
      return state.shown;
    },
    get hidden() {
      return state.hidden;
    },
    get focused() {
      return state.focused;
    },
    emitOnce(event: string): void {
      listeners.get(`once:${event}`)?.();
    },
    emit(event: string, ...args: unknown[]): void {
      listeners.get(event)?.(...args);
    },
  } as FakeWindow;
}

function asFake(win: BrowserWindow): FakeWindow {
  return win as unknown as FakeWindow;
}

function nearestDisplay(displays: DisplayInfo[], p: { x: number; y: number }): DisplayInfo {
  return (
    displays.find(
      (d) =>
        p.x >= d.workArea.x &&
        p.x < d.workArea.x + d.workArea.width &&
        p.y >= d.workArea.y &&
        p.y < d.workArea.y + d.workArea.height,
    ) ?? displays[0]!
  );
}

function makeRuntime(displays: DisplayInfo[]) {
  const created: Array<{ fake: FakeWindow; options: Record<string, unknown> }> = [];
  const runtime: WindowControllerRuntime = {
    createWindow: vi.fn((options) => {
      const fake = makeFake();
      created.push({ fake, options: { ...options } });
      return fake as unknown as BrowserWindow;
    }),
    getAllDisplays: vi.fn(() => displays),
    getDisplayNearestPoint: vi.fn((p: { x: number; y: number }) => nearestDisplay(displays, p)),
  };
  return { runtime, created };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createPetWindow (宠物窗)', () => {
  it('creates a fixed-size, non-resizable, frameless, transparent always-on-top pet window', () => {
    const { runtime, created } = makeRuntime(dualDisplays);
    createPetWindow({ runtime });

    const opts = created[0]!.options;
    expect(opts.width).toBe(PET_WINDOW_SIZE.width);
    expect(opts.height).toBe(PET_WINDOW_SIZE.height);
    expect(opts.width).toBe(280);
    expect(opts.height).toBe(320);
    expect(opts.resizable).toBe(false);
    expect(opts.frame).toBe(false);
    expect(opts.transparent).toBe(true);
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.hasShadow).toBe(false);
    expect(opts.show).toBe(false);
  });

  it('defaults to bottom-center of the primary display when no saved position', () => {
    const { runtime, created } = makeRuntime(dualDisplays);
    createPetWindow({ runtime });
    const opts = created[0]!.options;
    expect(opts.x).toBe((1000 - 280) / 2);
    expect(opts.y).toBe(800 - 320 - 8);
  });

  it('shows on ready-to-show unless startHidden', () => {
    const { runtime, created } = makeRuntime(dualDisplays);
    const visible = createPetWindow({ runtime });
    asFake(visible).emitOnce('ready-to-show');
    expect(created[0]!.fake.shown).toBe(true);

    const hidden = createPetWindow({ runtime, startHidden: true });
    asFake(hidden).emitOnce('ready-to-show');
    expect(created[1]!.fake.shown).toBe(false);
  });

  it('emits persisted anchor via onPositionChanged on moved', () => {
    const { runtime } = makeRuntime(dualDisplays);
    const onPositionChanged = vi.fn();
    const win = createPetWindow({ runtime, onPositionChanged });
    const fake = asFake(win);

    fake.position[0] = 200;
    fake.position[1] = 100;
    fake.emit('moved');
    expect(onPositionChanged).toHaveBeenCalledWith({
      displayId: 'primary',
      anchorX: 200,
      anchorY: 100,
      scale: 1,
      savedAt: expect.any(Number),
    });
  });

  it('does not persist when moved position is on no display', () => {
    const { runtime } = makeRuntime(dualDisplays);
    const onPositionChanged = vi.fn();
    const win = createPetWindow({ runtime, onPositionChanged });
    const fake = asFake(win);

    fake.position[0] = 500;
    fake.position[1] = 900; // 所有显示器之外
    fake.emit('moved');
    expect(onPositionChanged).not.toHaveBeenCalled();
  });

  it('loads the pet surface in production via loadFile with search', () => {
    const { runtime, created } = makeRuntime(dualDisplays);
    createPetWindow({ runtime });
    const fake = created[0]!.fake;

    expect(fake.loadFile).toHaveBeenCalledTimes(1);
    expect(fake.loadURL).not.toHaveBeenCalled();
    const [path, opts] = fake.loadFile.mock.calls[0]!;
    expect(String(path)).toMatch(/index\.html$/);
    expect(opts).toEqual({ search: 'surface=pet' });
  });

  it('keeps the ?poc compatibility: urlSuffix adds the poc param', () => {
    const { runtime, created } = makeRuntime(dualDisplays);
    createPetWindow({ runtime, urlSuffix: '?poc' });
    const fake = created[0]!.fake;
    const [, opts] = fake.loadFile.mock.calls[0]!;
    expect(opts).toEqual({ search: 'surface=pet&poc=1' });
  });

  it('loads the pet surface in dev from ELECTRON_RENDERER_URL', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    const { runtime, created } = makeRuntime(dualDisplays);
    createPetWindow({ runtime });
    const fake = created[0]!.fake;
    expect(fake.loadURL).toHaveBeenCalledWith('http://localhost:5173/?surface=pet');
    expect(fake.loadFile).not.toHaveBeenCalled();
  });
});

describe('loadRendererSurface', () => {
  it('appends surface and extra params to the dev renderer URL', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
    const fake = makeFake();
    loadRendererSurface(
      fake as unknown as BrowserWindow,
      'panel',
      new URLSearchParams({ poc: '1' }),
    );
    expect(fake.loadURL).toHaveBeenCalledWith('http://localhost:5173/?surface=panel&poc=1');
  });

  it('loads index.html with the surface search in production', () => {
    const fake = makeFake();
    loadRendererSurface(fake as unknown as BrowserWindow, 'panel');
    expect(fake.loadFile).toHaveBeenCalledTimes(1);
    expect(fake.loadURL).not.toHaveBeenCalled();
    const [path, opts] = fake.loadFile.mock.calls[0]!;
    expect(String(path)).toMatch(/index\.html$/);
    expect(opts).toEqual({ search: 'surface=panel' });
  });
});

describe('createPanelWindow (面板窗)', () => {
  it('creates a 360x480 hidden, frameless, focusable panel window', () => {
    const { runtime, created } = makeRuntime(dualDisplays);
    createPanelWindow({ runtime });

    const opts = created[0]!.options;
    expect(opts.width).toBe(PANEL_WINDOW_SIZE.width);
    expect(opts.height).toBe(PANEL_WINDOW_SIZE.height);
    expect(opts.width).toBe(360);
    expect(opts.height).toBe(480);
    expect(opts.show).toBe(false);
    expect(opts.frame).toBe(false);
    expect(opts.transparent).toBe(true);
  });

  it('intercepts close: preventDefault + hide, and calls onCloseRequest', () => {
    const { runtime } = makeRuntime(dualDisplays);
    const onCloseRequest = vi.fn();
    const panel = createPanelWindow({ runtime, onCloseRequest });
    const fake = asFake(panel.win);

    const closeEvent = { preventDefault: vi.fn() };
    fake.listeners.get('close')?.(closeEvent);

    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(fake.hide).toHaveBeenCalled();
    expect(onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it('does not intercept close after allowClose()', () => {
    const { runtime } = makeRuntime(dualDisplays);
    const panel = createPanelWindow({ runtime });
    const fake = asFake(panel.win);

    const closeEvent = { preventDefault: vi.fn() };
    panel.allowClose();
    fake.listeners.get('close')?.(closeEvent);

    expect(closeEvent.preventDefault).not.toHaveBeenCalled();
    expect(fake.hide).not.toHaveBeenCalled();
  });

  it('loads the panel surface', () => {
    const { runtime, created } = makeRuntime(dualDisplays);
    createPanelWindow({ runtime });
    const fake = created[0]!.fake;
    const [, opts] = fake.loadFile.mock.calls[0]!;
    expect(opts).toEqual({ search: 'surface=panel' });
  });

  it('showPanel anchors next to the pet, then shows and focuses', () => {
    const { runtime } = makeRuntime(dualDisplays);
    const panel = createPanelWindow({ runtime });
    const fake = asFake(panel.win);

    panel.showPanel({ x: 700, y: 100, width: 280, height: 320 });
    // 右侧放不下（980+360>1000）→ 左侧 700-360=340
    expect(fake.setPosition).toHaveBeenCalledWith(340, 100);
    expect(fake.show).toHaveBeenCalledTimes(1);
    expect(fake.focus).toHaveBeenCalledTimes(1);
  });

  it('positions and shows once at creation when anchorTo is given', () => {
    const { runtime } = makeRuntime(dualDisplays);
    const panel: PanelWindowHandle = createPanelWindow({
      runtime,
      anchorTo: { x: 700, y: 100, width: 280, height: 320 },
    });
    const fake = asFake(panel.win);
    expect(fake.setPosition).toHaveBeenCalledWith(340, 100);
    expect(fake.show).toHaveBeenCalledTimes(1);
    expect(fake.focus).toHaveBeenCalledTimes(1);
  });
});

describe('setPassThrough', () => {
  it('forwards the ignore flag with forward:true', () => {
    const fake = makeFake();
    const win = fake as unknown as BrowserWindow;
    setPassThrough(win, true);
    expect(fake.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    setPassThrough(win, false);
    expect(fake.setIgnoreMouseEvents).toHaveBeenCalledWith(false, { forward: true });
  });
});
