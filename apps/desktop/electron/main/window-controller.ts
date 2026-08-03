/**
 * WindowController —— 对应设计稿 8.2 / 8.4 / 8.5。
 * 拆分宠物窗与面板窗：
 * - createPetWindow：透明、无边框、不可缩放、置顶、可整窗穿透的桌宠窗（240×260）。
 * - createPanelWindow：可聚焦的面板窗（360×480），默认隐藏，随宠物锚定显示。
 * - loadRendererSurface：pet/panel 共用同一渲染入口，靠 ?surface= 区分。
 *
 * 注意（8.4 / D-7）：Electron 原生不支持透明区域点击穿透，
 * 只能整窗穿透切换 setIgnoreMouseEvents(true,{forward:true}) + 渲染进程 alpha 探测。
 *
 * 测试性：BrowserWindow / screen 通过 WindowControllerRuntime 端口注入，单测用最小 fake。
 */
import { join } from 'node:path';

import { BrowserWindow, screen } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';

import {
  anchorPanelToPet,
  resolvePetPosition,
  toPersistedPosition,
  type DisplayInfo,
  type PetPosition,
} from './display-controller.js';
import { SECURE_WEB_PREFS } from './security.js';

/** 宠物窗：240×260 —— 桌面常驻小巧，角色经构图框放大后占窗口高度约 81%（viewBox 320×380） */
export const PET_WINDOW_SIZE = { width: 240, height: 260 };
export const PANEL_WINDOW_SIZE = { width: 360, height: 480 };

/** 测试注入端口：生产默认由 BrowserWindow + screen 实现 */
export interface WindowControllerRuntime {
  /** 创建窗口（对应 new BrowserWindow(...)） */
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  /** 全部显示器（同 screen.getAllDisplays 的映射） */
  getAllDisplays(): DisplayInfo[];
  /** 取离某点最近的显示器（同 screen.getDisplayNearestPoint 的映射） */
  getDisplayNearestPoint(point: { x: number; y: number }): DisplayInfo;
}

export interface WindowOptions {
  /** 持久化的宠物位置（8.5；无则默认底部中央） */
  savedPosition?: PetPosition | null;
  /** 位置变化回调（8.5 持久化） */
  onPositionChanged?: (pos: PetPosition) => void;
  /** 加载 URL 附加后缀（如 --poc 时 ?poc 进入窗口能力自检页） */
  urlSuffix?: string;
  /** 启动隐藏（--minimized：启动后最小化到托盘，不显示主窗） */
  startHidden?: boolean;
  /** 测试注入：窗口/显示器端口（默认 BrowserWindow + screen） */
  runtime?: WindowControllerRuntime;
}

export interface PanelWindowOptions {
  /** 初始锚定目标（宠物窗口）；缺省先不定位，首次 showPanel 时定位 */
  anchorTo?: { x: number; y: number; width: number; height: number };
  /** 用户尝试关闭面板时回调（面板本身隐藏而非销毁） */
  onCloseRequest?: () => void;
  /** 测试注入：窗口/显示器端口 */
  runtime?: WindowControllerRuntime;
}

/** createPanelWindow 的句柄：底层窗口 + 面板专用辅助 */
export interface PanelWindowHandle {
  /** 底层面板窗口（Task 10 接 IPC / webContents） */
  win: BrowserWindow;
  /** 锚定到宠物旁并显示 + 聚焦（用 anchorPanelToPet 计算位置） */
  showPanel(anchorTo: { x: number; y: number; width: number; height: number }): void;
  /** 允许真正关闭（应用退出 / 替换面板时调用；之后 close 不再拦截） */
  allowClose(): void;
  /** 隐藏面板（保留窗口） */
  hide(): void;
}

/** 生产默认端口：直接用 Electron 的 BrowserWindow 与 screen */
function defaultRuntime(): WindowControllerRuntime {
  return {
    createWindow: (options) => new BrowserWindow(options),
    getAllDisplays: () =>
      screen.getAllDisplays().map((d) => ({
        id: String(d.id),
        workArea: d.workArea,
        scaleFactor: d.scaleFactor,
      })),
    getDisplayNearestPoint: (p) => {
      const d = screen.getDisplayNearestPoint(p);
      return { id: String(d.id), workArea: d.workArea, scaleFactor: d.scaleFactor };
    },
  };
}

const preloadPath = () => join(__dirname, '../preload/index.js');

/**
 * 加载渲染表面：pet/panel 共用渲染入口，用 ?surface= 区分。
 * dev：ELECTRON_RENDERER_URL + ?surface=...；prod：loadFile(out/renderer/index.html, {search})。
 */
export function loadRendererSurface(
  win: BrowserWindow,
  surface: 'pet' | 'panel',
  extra?: URLSearchParams,
): void {
  const params = new URLSearchParams();
  params.set('surface', surface);
  if (extra) {
    for (const [key, value] of extra) params.set(key, value);
  }
  const search = params.toString();

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl + (search ? `?${search}` : ''));
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), search ? { search } : undefined);
  }
}

/**
 * 创建桌宠窗：固定 240×260、不可缩放、透明无边框、置顶、跳过任务栏。
 * moved → toAnchor 回调（8.5 位置持久化）；加载 surface=pet。
 */
export function createPetWindow(options: WindowOptions = {}): BrowserWindow {
  const runtime = options.runtime ?? defaultRuntime();
  // 8.5：恢复位置（找不到原显示器回主屏 + 夹进可见区域 + 负数坐标支持）
  const displays = runtime.getAllDisplays();
  const restored = resolvePetPosition(options.savedPosition ?? null, displays, PET_WINDOW_SIZE);

  const win = runtime.createWindow({
    width: PET_WINDOW_SIZE.width,
    height: PET_WINDOW_SIZE.height,
    x: restored.x,
    y: restored.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true, // 8.4 Interactive/Pass-through/Hidden 都置顶
    skipTaskbar: true, // 8.2 托盘
    hasShadow: false,
    show: false, // ready-to-show 时再显示
    webPreferences: {
      ...SECURE_WEB_PREFS,
      preload: preloadPath(),
    },
  });

  win.once('ready-to-show', () => {
    // --minimized：启动隐藏到托盘
    if (!options.startHidden) win.show();
  });

  // 8.5：位置变化时回调（由调用方持久化）。
  // 注：部分环境（RDP 会话等）setPosition 不触发 'move'/'moved'，持久化的可靠
  // 触发点是拖动结束（PetDragController.onDragEnd → index.ts），这里作为补充。
  win.on('moved', () => {
    const pos = win.getPosition();
    const persisted = toPersistedPosition(displays, { x: pos[0] ?? 0, y: pos[1] ?? 0 });
    if (persisted && options.onPositionChanged) {
      options.onPositionChanged(persisted);
    }
  });

  // 兼容旧 ?poc（窗口能力自检页）：urlSuffix 存在时附加 poc 参数
  const extra = new URLSearchParams();
  if (options.urlSuffix) extra.set('poc', '1');
  loadRendererSurface(win, 'pet', extra);

  return win;
}

/**
 * 创建面板窗：360×480、无边框、透明但可聚焦（非穿透）、默认隐藏、跳过任务栏。
 * close 默认 preventDefault + hide（面板常驻可随时重开）；allowClose() 后放行销毁。
 * 提供 showPanel(anchorTo)：用 anchorPanelToPet 计算位置后 show + focus。
 */
export function createPanelWindow(options: PanelWindowOptions = {}): PanelWindowHandle {
  const runtime = options.runtime ?? defaultRuntime();

  const win = runtime.createWindow({
    width: PANEL_WINDOW_SIZE.width,
    height: PANEL_WINDOW_SIZE.height,
    frame: false,
    transparent: true, // 外观与桌宠一致；窗口本身可聚焦（穿透仅在 PetWindow 上切换）
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false, // 由 showPanel / 调用方显式显示
    webPreferences: {
      ...SECURE_WEB_PREFS,
      preload: preloadPath(),
    },
  });

  let allowClose = false;

  // 用户点 X / 系统关闭 → 隐藏而非销毁（面板随时可重新打开）
  win.on('close', (event) => {
    if (!allowClose) {
      event.preventDefault();
      win.hide();
      options.onCloseRequest?.();
    }
  });

  loadRendererSurface(win, 'panel');

  const showPanel = (anchorTo: { x: number; y: number; width: number; height: number }): void => {
    // 取宠物所在显示器的工作区做锚定计算
    const display = runtime.getDisplayNearestPoint({
      x: anchorTo.x + anchorTo.width / 2,
      y: anchorTo.y + anchorTo.height / 2,
    });
    const { x, y } = anchorPanelToPet(anchorTo, PANEL_WINDOW_SIZE, display.workArea);
    win.setPosition(x, y);
    win.show();
    win.focus();
  };

  // 有初始锚定时立刻定位（仍在 show:false 后首次显示）
  if (options.anchorTo) showPanel(options.anchorTo);

  return {
    win,
    showPanel,
    allowClose: () => {
      allowClose = true;
    },
    hide: () => win.hide(),
  };
}

/** 8.4 整窗穿透切换 */
export function setPassThrough(win: BrowserWindow, ignore: boolean): void {
  // forward:true 让鼠标移动事件仍进渲染进程，以便 alpha 探测后切回
  win.setIgnoreMouseEvents(ignore, { forward: true });
}
