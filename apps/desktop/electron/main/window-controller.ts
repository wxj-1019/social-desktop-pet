/**
 * WindowController —— 对应设计稿 8.2 / 8.4 / 8.5。
 * 创建透明、无边框、置顶、可整窗穿透的桌宠窗口；集成多屏位置恢复。
 *
 * 注意（8.4 / D-7）：Electron 原生不支持透明区域点击穿透，
 * 只能整窗穿透切换 setIgnoreMouseEvents(true,{forward:true}) + 渲染进程 alpha 探测。
 */
import { join } from 'node:path';

import { BrowserWindow, screen } from 'electron';

import { resolvePetPosition, toAnchor, type PetPosition } from './display-controller.js';
import { SECURE_WEB_PREFS } from './security.js';

export interface WindowOptions {
  /** 持久化的宠物位置（8.5；无则默认底部中央） */
  savedPosition?: PetPosition | null;
  /** 位置变化回调（8.5 持久化） */
  onPositionChanged?: (pos: PetPosition) => void;
  /** 加载 URL 附加后缀（如 --poc 时 ?poc 进入窗口能力自检页） */
  urlSuffix?: string;
  /** 启动隐藏（--minimized：启动后最小化到托盘，不显示主窗） */
  startHidden?: boolean;
}

const PET_WINDOW_SIZE = { width: 360, height: 480 };

export function createPetWindow(options: WindowOptions = {}): BrowserWindow {
  const displays = screen.getAllDisplays().map((d) => ({
    id: String(d.id),
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
  }));
  // 8.5：恢复位置（找不到原显示器回主屏 + 夹进可见区域 + 负数坐标支持）
  const restored = resolvePetPosition(options.savedPosition ?? null, displays, PET_WINDOW_SIZE);

  const win = new BrowserWindow({
    width: PET_WINDOW_SIZE.width,
    height: PET_WINDOW_SIZE.height,
    x: restored.x,
    y: restored.y,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true, // 8.4 Interactive/Pass-through/Hidden 都置顶
    skipTaskbar: true, // 8.2 托盘
    hasShadow: false,
    show: false, // ready-to-show 时再显示
    webPreferences: {
      ...SECURE_WEB_PREFS,
      preload: join(__dirname, '../preload/index.js'), // CJS（sandbox 要求）
    },
  });

  win.once('ready-to-show', () => {
    // --minimized：启动隐藏到托盘
    if (!options.startHidden) win.show();
  });

  // 8.5：位置变化时回调（由调用方持久化）
  win.on('moved', () => {
    const pos = win.getPosition();
    const x = pos[0] ?? 0;
    const y = pos[1] ?? 0;
    const current = displays.find(
      (d) =>
        x >= d.workArea.x &&
        x < d.workArea.x + d.workArea.width &&
        y >= d.workArea.y &&
        y < d.workArea.y + d.workArea.height,
    );
    if (current && options.onPositionChanged) {
      const anchor = toAnchor(current, { x, y });
      options.onPositionChanged({
        displayId: current.id,
        anchorX: anchor.anchorX,
        anchorY: anchor.anchorY,
        scale: 1,
        savedAt: Date.now(),
      });
    }
  });

  // CSP 由 renderer 的 index.html <meta> 注入（见 security.ts CSP 常量）；
  // 也可通过 session.webRequest.onHeadersReceived 注入响应头，第 3 周实现。

  // electron-vite dev/prod 入口（--poc 时附加 ?poc 进入窗口能力自检页）
  const suffix = options.urlSuffix ?? '';
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + suffix);
  } else {
    void win.loadFile(
      join(__dirname, '../renderer/index.html'),
      suffix ? { search: suffix.slice(1) } : undefined,
    );
  }

  return win;
}

/** 8.4 整窗穿透切换 */
export function setPassThrough(win: BrowserWindow, ignore: boolean): void {
  // forward:true 让鼠标移动事件仍进渲染进程，以便 alpha 探测后切回
  win.setIgnoreMouseEvents(ignore, { forward: true });
}
