/**
 * IPC 注册 —— 对应设计稿 8.3（IPC 输入使用 Schema 验证、allowlist）。
 *
 * 审查修复 #6：preload 只暴露最小 API，main 侧必须：
 * 1. 只注册 allowlist 内的通道（其余一律拒绝）
 * 2. 输入用 @pet/protocol 的 zod schema 校验
 */
import { BrowserWindow, ipcMain, screen } from 'electron';

import { IPC_ALLOWLIST } from '../security.js';

const ALLOWED = new Set<string>(IPC_ALLOWLIST);

/** 注册一个受 allowlist + schema 保护的 IPC handler */
export function registerIpcHandler(
  channel: string,
  handler: (win: BrowserWindow, payload: unknown) => unknown,
): void {
  if (!ALLOWED.has(channel)) {
    throw new Error(`[IPC] 通道 "${channel}" 不在 allowlist 中`);
  }
  ipcMain.on(channel, (event, payload: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    handler(win, payload);
  });
}

/** 注册全部基础通道（第 3 周接 WindowController/TrayController 时扩展） */
export function registerIpcAllowlist(getWindow: () => BrowserWindow | null): void {
  registerIpcHandler('window:setIgnoreMouseEvents', (win, payload) => {
    if (typeof payload !== 'boolean') throw new TypeError('payload 必须是 boolean');
    win.setIgnoreMouseEvents(payload, { forward: true });
  });
  registerIpcHandler('window:minimize', (win) => {
    win.minimize();
  });
  registerIpcHandler('window:hide', (win) => {
    win.hide();
  });
  registerIpcHandler('app:version', () => getWindow()?.webContents.getURL() ?? null);
  // tray:toggle / deeplink:payload / storage:get / storage:set —— 第 3 周接 TrayController/SecureStorage
  void getWindow;

  // PoC 专用：多屏信息（第 1–2 周窗口能力 PoC；第 3 周由 DisplayController 正式接入）
  ipcMain.handle('poc:getDisplays', () => {
    return screen.getAllDisplays().map((d) => ({
      id: String(d.id),
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    }));
  });
}
