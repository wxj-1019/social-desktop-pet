import { afterEach, describe, expect, it, vi } from 'vitest';

// 与 window-controller.test.ts 一致：electron 在 Node 下只导出路径字符串，必须 mock。
// 测试全部注入端口（createTray/buildMenu/loadIcon/win/handlers），默认实现不会被调用。
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  Tray: vi.fn(),
  nativeImage: { createEmpty: vi.fn(), createFromPath: vi.fn() },
}));

import {
  TrayController,
  type ImageLike,
  type MenuLike,
  type TrayControllerOptions,
  type TrayHandlers,
  type TrayLike,
  type TrayMenuItem,
} from './tray-controller.js';

interface TrayHarness {
  handlers: TrayHandlers;
  tray: TrayLike;
  options: TrayControllerOptions;
  menus: TrayMenuItem[][];
  doubleClicks: (() => void)[];
}

function makeHarness(iconAvailable = true): TrayHarness {
  const handlers: TrayHandlers = {
    onOpenPanel: vi.fn(),
    onSetDnd: vi.fn(),
    onSetPassThrough: vi.fn(),
    onHide: vi.fn(),
    onShow: vi.fn(),
    onQuit: vi.fn(),
  };
  const menus: TrayMenuItem[][] = [];
  const doubleClicks: (() => void)[] = [];
  const tray: TrayLike = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn((_event: string, listener: () => void) => void doubleClicks.push(listener)),
    destroy: vi.fn(),
  };
  const options: TrayControllerOptions = {
    createTray: vi.fn(() => tray),
    buildMenu: vi.fn((items: TrayMenuItem[]) => {
      menus.push(items);
      return {} as MenuLike;
    }),
    loadIcon: vi.fn(() => ({ isEmpty: () => !iconAvailable }) as ImageLike),
    win: vi.fn(() => null),
    handlers,
  };
  return { handlers, tray, options, menus, doubleClicks };
}

function makeController(harness: TrayHarness): TrayController {
  return new TrayController(harness.options);
}

function lastMenu(harness: TrayHarness): TrayMenuItem[] {
  return harness.menus.at(-1) ?? [];
}

function item(harness: TrayHarness, labelPrefix: string): TrayMenuItem {
  const found = lastMenu(harness).find((i) => i.label?.startsWith(labelPrefix));
  if (!found) throw new Error(`menu item ${labelPrefix} not found`);
  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrayController.create', () => {
  it('loads the icon, creates a tray, sets tooltip and menu, binds double-click', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);

    controller.create('/assets/tray.png');

    expect(harness.options.loadIcon).toHaveBeenCalledWith('/assets/tray.png');
    expect(harness.options.createTray).toHaveBeenCalledTimes(1);
    expect(harness.tray.setToolTip).toHaveBeenCalledWith('AI 桌宠');
    expect(harness.tray.setContextMenu).toHaveBeenCalledTimes(1);
    expect(harness.doubleClicks).toHaveLength(1);
  });

  it('creates a basic menu even when the icon cannot be loaded', () => {
    const harness = makeHarness(false);
    const controller = makeController(harness);

    controller.create('/missing.png');

    // 图标不可用仍创建托盘（允许基本菜单，仅禁用穿透开启）
    expect(harness.options.createTray).toHaveBeenCalledTimes(1);
    const pt = item(harness, '鼠标穿透');
    expect(pt.enabled).toBe(false);
  });

  it('enables the pass-through toggle when the icon is available', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);

    controller.create('/assets/tray.png');

    const pt = item(harness, '鼠标穿透');
    expect(pt.enabled).toBe(true);
  });

  it('is idempotent: second create does not re-create the tray', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);

    controller.create('/a.png');
    controller.create('/b.png');

    expect(harness.options.createTray).toHaveBeenCalledTimes(1);
  });
});

describe('TrayController.dispatch', () => {
  it('open-chat routes to onOpenPanel("chat")', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.dispatch('open-chat');

    expect(harness.handlers.onOpenPanel).toHaveBeenCalledWith('chat');
  });

  it('open-friends routes to onOpenPanel("friends")', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.dispatch('open-friends');

    expect(harness.handlers.onOpenPanel).toHaveBeenCalledWith('friends');
  });

  it('toggle-dnd flips dnd and reports through onSetDnd', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.dispatch('toggle-dnd');
    expect(controller.snapshot.dnd).toBe(true);
    expect(harness.handlers.onSetDnd).toHaveBeenCalledWith(true);

    controller.dispatch('toggle-dnd');
    expect(controller.snapshot.dnd).toBe(false);
    expect(harness.handlers.onSetDnd).toHaveBeenCalledWith(false);
  });

  it('toggle-pass-through flips the flag and reports through onSetPassThrough', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.dispatch('toggle-pass-through');
    expect(controller.snapshot.passThrough).toBe(true);
    expect(harness.handlers.onSetPassThrough).toHaveBeenCalledWith(true);

    controller.dispatch('toggle-pass-through');
    expect(controller.snapshot.passThrough).toBe(false);
    expect(harness.handlers.onSetPassThrough).toHaveBeenCalledWith(false);
  });

  it('throws when enabling pass-through while the tray icon is unavailable', () => {
    const harness = makeHarness(false);
    const controller = makeController(harness);
    controller.create('/missing.png');

    expect(() => controller.dispatch('toggle-pass-through')).toThrow('托盘图标不可用');
    expect(controller.snapshot.passThrough).toBe(false);
  });

  it('allows disabling pass-through even when the tray icon is unavailable', () => {
    const harness = makeHarness(false);
    const controller = makeController(harness);
    controller.create('/missing.png');
    controller.setPassThroughForced(true); // 外部（渲染进程/主进程）已开启穿透

    expect(() => controller.dispatch('toggle-pass-through')).not.toThrow();
    expect(controller.snapshot.passThrough).toBe(false);
    expect(harness.handlers.onSetPassThrough).toHaveBeenCalledWith(false);
  });

  it('hide routes to onHide without flipping tray state', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.dispatch('hide');
    expect(harness.handlers.onHide).toHaveBeenCalledTimes(1);
    expect(harness.handlers.onShow).not.toHaveBeenCalled();
  });

  it('show resets pass-through off, reports it, and calls onShow', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');
    controller.setPassThroughForced(true);
    controller.dispatch('toggle-dnd'); // 顺带打开勿扰，show 不应动它

    controller.dispatch('show');

    expect(controller.snapshot.passThrough).toBe(false);
    expect(harness.handlers.onSetPassThrough).toHaveBeenLastCalledWith(false);
    expect(harness.handlers.onShow).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.dnd).toBe(true);
  });

  it('quit routes to onQuit', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.dispatch('quit');

    expect(harness.handlers.onQuit).toHaveBeenCalledTimes(1);
  });

  it('double-click dispatch(show)', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    harness.doubleClicks[0]!();

    expect(harness.handlers.onShow).toHaveBeenCalledTimes(1);
    expect(harness.handlers.onSetPassThrough).toHaveBeenLastCalledWith(false);
  });

  it('menu callbacks all route through dispatch', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    item(harness, '打开聊天').click?.();
    expect(harness.handlers.onOpenPanel).toHaveBeenCalledWith('chat');

    item(harness, '好友面板').click?.();
    expect(harness.handlers.onOpenPanel).toHaveBeenCalledWith('friends');

    item(harness, '鼠标穿透').click?.();
    expect(controller.snapshot.passThrough).toBe(true);

    item(harness, '勿扰').click?.();
    expect(controller.snapshot.dnd).toBe(true);

    item(harness, '隐藏桌宠').click?.();
    expect(harness.handlers.onHide).toHaveBeenCalledTimes(1);

    item(harness, '显示桌宠').click?.();
    expect(harness.handlers.onShow).toHaveBeenCalledTimes(1);

    item(harness, '完全退出').click?.();
    expect(harness.handlers.onQuit).toHaveBeenCalledTimes(1);
  });
});

describe('TrayController.snapshot / refresh / setPassThroughForced', () => {
  it('snapshot reflects the current dnd and pass-through flags', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    expect(controller.snapshot).toEqual({ dnd: false, passThrough: false });
    controller.dispatch('toggle-dnd');
    controller.dispatch('toggle-pass-through');
    expect(controller.snapshot).toEqual({ dnd: true, passThrough: true });
  });

  it('refresh rebuilds the menu (label flips on state change)', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');
    expect(harness.menus).toHaveLength(1);

    controller.dispatch('toggle-dnd');
    // dispatch 内部已 refresh 一次
    expect(harness.menus.length).toBeGreaterThanOrEqual(2);
    expect(item(harness, '勿扰').label).toBe('勿扰：开');

    controller.refresh();
    expect(harness.menus).toHaveLength(harness.menus.length);
    expect(item(harness, '勿扰').label).toBe('勿扰：开');
  });

  it('setPassThroughForced syncs the snapshot without calling handlers', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.setPassThroughForced(true);

    expect(controller.snapshot.passThrough).toBe(true);
    expect(harness.handlers.onSetPassThrough).not.toHaveBeenCalled();
    expect(item(harness, '鼠标穿透').label).toBe('鼠标穿透：开');
  });
});

describe('TrayController.destroy', () => {
  it('destroys the underlying tray and becomes inert', () => {
    const harness = makeHarness(true);
    const controller = makeController(harness);
    controller.create('/a.png');

    controller.destroy();
    expect(harness.tray.destroy).toHaveBeenCalledTimes(1);

    // destroy 后再 refresh 不抛错
    expect(() => controller.refresh()).not.toThrow();
  });
});
