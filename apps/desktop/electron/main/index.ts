/**
 * Electron Main 入口 —— 对应设计稿 8.2 模块结构。
 * 第 3 周单人 Alpha：接入 TrayController、多屏位置持久化（8.5）、IPC allowlist。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

import type { PetPosition } from './display-controller.js';
import { registerIpcAllowlist } from './ipc/register.js';
import { TrayController } from './tray-controller.js';
import { createPetWindow, setPassThrough } from './window-controller.js';

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** 8.5 位置持久化文件（userData/pet-position.json） */
function positionFile(): string {
  return join(app.getPath('userData'), 'pet-position.json');
}
function loadSavedPosition(): PetPosition | null {
  try {
    const f = positionFile();
    if (!existsSync(f)) return null;
    return JSON.parse(readFileSync(f, 'utf-8')) as PetPosition;
  } catch {
    return null;
  }
}
function persistPosition(pos: PetPosition): void {
  try {
    writeFileSync(positionFile(), JSON.stringify(pos));
  } catch {
    /* 持久化失败不阻塞运行 */
  }
}

let tray: TrayController | null = null;
const savedPosition = loadSavedPosition();

void app.whenReady().then(() => {
  const win = createPetWindow({
    savedPosition,
    // 8.5：位置变化 → 持久化
    onPositionChanged: (pos) => persistPosition(pos),
  });

  // 8.2 托盘
  tray = new TrayController(() => win, {
    onTogglePassThrough: (on) => setPassThrough(win, on),
    onToggleDnd: () => {
      /* 第 3 周接 PetStateMachine QUIET 状态 */
    },
    onQuit: () => app.quit(),
  });
  tray.create();

  // 8.3 IPC allowlist 生效
  registerIpcAllowlist(() => win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow({ savedPosition });
    }
  });
});

app.on('window-all-closed', () => {
  // 8.2：托盘常驻，不走 quit（用户从托盘"完全退出"才退出）
});
