/**
 * Electron Main 入口 —— 对应设计稿 8.2 模块结构。
 * 第 0-2 周为可启动骨架；controllers 将在第 3-6 周填充。
 */
import { app, BrowserWindow } from 'electron';

import { registerIpcAllowlist } from './ipc/register.js';
import { createPetWindow } from './window-controller.js';

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

void app.whenReady().then(() => {
  const win = createPetWindow();

  // 8.3 IPC allowlist 生效（审查修复 #6）
  registerIpcAllowlist(() => win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 8.2：托盘常驻，不走 quit（第 3 周接 TrayController）
  if (process.platform !== 'darwin') app.quit();
});
