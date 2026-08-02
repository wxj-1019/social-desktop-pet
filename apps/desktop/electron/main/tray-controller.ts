/**
 * TrayController —— 对应设计稿 8.2（托盘）+ 8.4（穿透恢复入口）。
 *
 * 托盘常驻：打开聊天/好友、穿透切换、勿扰开关、隐藏/显示、完全退出。
 * 8.4：穿透始终可通过托盘恢复（不可恢复事故为 0，15.2 Go/No-Go）。
 *
 * 测试性：托盘/菜单/图标/窗口均通过 TrayControllerOptions 端口注入，
 * 单测用最小 fake（与 WindowControllerRuntime 一致），默认实现用 Electron 原生。
 * 所有菜单回调都收敛到 dispatch(action)，状态翻转/恢复逻辑只在 dispatch 内维护。
 */
import { join } from 'node:path';

import { app, Menu, Tray, nativeImage } from 'electron';
import type { BrowserWindow, MenuItemConstructorOptions, NativeImage } from 'electron';

export type TrayAction =
  'open-chat' | 'open-friends' | 'toggle-dnd' | 'toggle-pass-through' | 'hide' | 'show' | 'quit';

export interface TrayHandlers {
  /** 打开聊天/好友面板（Main 端接 openPanel） */
  onOpenPanel(view: 'chat' | 'friends'): void;
  /** 勿扰开关（Main 端接 runtime.setDnd） */
  onSetDnd(enabled: boolean): void;
  /** 穿透开关（Main 端接窗口 setIgnoreMouseEvents + snapshot 同步） */
  onSetPassThrough(enabled: boolean): void;
  /** 隐藏桌宠（Main 端接 petWindow.hide + runtime.setHidden） */
  onHide(): void;
  /** 显示桌宠（Main 端接 petWindow.show + 解除穿透 + runtime.setHidden(false)） */
  onShow(): void;
  /** 完全退出 */
  onQuit(): void;
}

/** 菜单项的最小形态（buildMenu 负责翻译成原生菜单） */
export interface TrayMenuItem {
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  toolTip?: string;
  click?: () => void;
}

/** 托盘实例端口（真实 Tray 亦满足） */
export interface TrayLike {
  setToolTip(tip: string): void;
  setContextMenu(menu: MenuLike): void;
  on(event: 'double-click', listener: () => void): void;
  destroy(): void;
}

/** 原生菜单不透明句柄（由 buildMenu 产生） */
export type MenuLike = object;

/** 图标端口：isEmpty() 判断是否成功加载 */
export interface ImageLike {
  isEmpty(): boolean;
}

export interface TrayControllerOptions {
  /** 创建托盘实例（默认 new Tray(icon)） */
  createTray?(icon: ImageLike): TrayLike;
  /** 由菜单项列表构建原生菜单（默认 Menu.buildFromTemplate） */
  buildMenu?(items: TrayMenuItem[]): MenuLike;
  /** 从磁盘加载图标（默认 nativeImage.createFromPath；isEmpty() 判断可用性） */
  loadIcon?(path: string): ImageLike;
  /** 取桌宠窗口（show 时聚焦；hide/show 动作由 Main handlers 处理） */
  win(): BrowserWindow | null;
  /** 用户动作回调（Main 接 runtime / 窗口） */
  handlers: TrayHandlers;
}

/** 生产默认端口：直接用 Electron 原生 Tray/Menu/nativeImage */
function defaultOptions(): Pick<
  Required<TrayControllerOptions>,
  'createTray' | 'buildMenu' | 'loadIcon'
> {
  return {
    createTray: (icon) => new Tray(icon as NativeImage) as unknown as TrayLike,
    buildMenu: (items) => Menu.buildFromTemplate(items as MenuItemConstructorOptions[]),
    loadIcon: (path) => nativeImage.createFromPath(path),
  };
}

export class TrayController {
  private tray: TrayLike | null = null;
  private iconReady = false;
  private passThrough = false;
  private dnd = false;
  private readonly options: Required<
    Pick<TrayControllerOptions, 'createTray' | 'buildMenu' | 'loadIcon'>
  > &
    Pick<TrayControllerOptions, 'win' | 'handlers'>;

  constructor(options: TrayControllerOptions) {
    this.options = {
      ...defaultOptions(),
      ...options,
    };
  }

  /** 当前托盘状态快照（Main 侧同步用） */
  get snapshot(): { dnd: boolean; passThrough: boolean } {
    return { dnd: this.dnd, passThrough: this.passThrough };
  }

  /**
   * 创建托盘：图标可用则启用穿透开启；图标不可用仍创建（基本菜单可用，
   * 仅禁用穿透开启，保证穿透一旦开启必可经托盘恢复）。
   */
  create(iconPath: string): void {
    if (this.tray) return;
    const icon = this.options.loadIcon(iconPath);
    this.iconReady = !icon.isEmpty();
    this.tray = this.options.createTray(icon);
    this.tray.setToolTip('AI 桌宠');
    this.tray.setContextMenu(this.options.buildMenu(this.buildMenuItems()));
    this.tray.on('double-click', () => this.dispatch('show'));
  }

  /** 重建菜单（状态变化后调用，dispatch 内部已自动 refresh） */
  refresh(): void {
    if (this.tray) this.tray.setContextMenu(this.options.buildMenu(this.buildMenuItems()));
  }

  /** Main 同步外部穿透状态（如渲染进程 window:setIgnoreMouseEvents），不触发 handler 避免循环 */
  setPassThroughForced(enabled: boolean): void {
    this.passThrough = enabled;
    this.refresh();
  }

  /** Main 同步外部勿扰状态（单一状态源入口 syncDnd 驱动），不触发 handler 避免循环 */
  setDndForced(enabled: boolean): void {
    this.dnd = enabled;
    this.refresh();
  }

  /** 唯一动作入口：菜单回调 / double-click 全部收敛到这里 */
  dispatch(action: TrayAction): void {
    switch (action) {
      case 'open-chat':
        this.options.handlers.onOpenPanel('chat');
        return;
      case 'open-friends':
        this.options.handlers.onOpenPanel('friends');
        return;
      case 'toggle-dnd':
        this.dnd = !this.dnd;
        this.options.handlers.onSetDnd(this.dnd);
        this.refresh();
        return;
      case 'toggle-pass-through':
        // 8.4：图标不可用且当前关闭时不允许开启穿透（开了将无法经托盘恢复）
        if (!this.iconReady && !this.passThrough) {
          throw new Error('托盘图标不可用，不能开启穿透');
        }
        this.passThrough = !this.passThrough;
        this.options.handlers.onSetPassThrough(this.passThrough);
        this.refresh();
        return;
      case 'hide':
        this.options.handlers.onHide();
        return;
      case 'show':
        // 8.4：从穿透/隐藏恢复 —— 先强制解除穿透再显示
        this.passThrough = false;
        this.options.handlers.onSetPassThrough(false);
        this.options.handlers.onShow();
        this.refresh();
        return;
      case 'quit':
        this.options.handlers.onQuit();
        return;
    }
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private buildMenuItems(): TrayMenuItem[] {
    return [
      { label: '打开聊天', click: () => this.dispatch('open-chat') },
      { label: '好友面板', click: () => this.dispatch('open-friends') },
      { type: 'separator' },
      {
        label: `鼠标穿透：${this.passThrough ? '开' : '关'}`,
        // 图标不可用且未穿透时禁用（开启后无法恢复）
        enabled: this.iconReady || this.passThrough,
        click: () => this.dispatch('toggle-pass-through'),
      },
      {
        label: `勿扰：${this.dnd ? '开' : '关'}`,
        click: () => this.dispatch('toggle-dnd'),
      },
      { type: 'separator' },
      { label: '隐藏桌宠', click: () => this.dispatch('hide') },
      { label: '显示桌宠', click: () => this.dispatch('show') },
      { type: 'separator' },
      { label: '完全退出', click: () => this.dispatch('quit') },
    ];
  }
}

/** 托盘图标路径（Task 10：assets:tray 生成，经 electron-builder extraResources 打包） */
export function trayIconPath(): string {
  // 打包：extraResources 把 resources/tray.png 放到 <resources>/tray.png（app.asar 外）
  // 开发：仓库内 apps/desktop/resources/tray.png
  if (app.isPackaged) {
    return join(process.resourcesPath, 'tray.png');
  }
  return join(__dirname, '../../resources/tray.png');
}
