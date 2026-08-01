/**
 * WindowController —— 对应设计稿 8.2 / 8.4。
 * 创建透明、无边框、置顶、可整窗穿透的桌宠窗口。
 *
 * 注意（8.4 / D-7）：Electron 原生不支持透明区域点击穿透，
 * 只能整窗穿透切换 setIgnoreMouseEvents(true,{forward:true}) + 渲染进程 alpha 探测。
 */
import { join } from 'node:path';

import { BrowserWindow } from 'electron';

import { SECURE_WEB_PREFS } from './security.js';

export function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 480,
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

  win.once('ready-to-show', () => win.show());

  // CSP 由 renderer 的 index.html <meta> 注入（见 security.ts CSP 常量）；
  // 也可通过 session.webRequest.onHeadersReceived 注入响应头，第 3 周实现。

  // electron-vite dev/prod 入口
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/** 8.4 整窗穿透切换 */
export function setPassThrough(win: BrowserWindow, ignore: boolean): void {
  // forward:true 让鼠标移动事件仍进渲染进程，以便 alpha 探测后切回
  win.setIgnoreMouseEvents(ignore, { forward: true });
}
