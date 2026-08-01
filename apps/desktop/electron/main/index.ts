/**
 * Electron Main 入口 —— 对应设计稿 8.2 模块结构。
 * 第 3 周单人 Alpha：接入 TrayController、多屏位置持久化（8.5）、IPC allowlist、
 * Session/DeepLink 控制器（9.8 / 6.3）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

import { DeepLinkController } from './deep-link-controller.js';
import type { PetPosition } from './display-controller.js';
import { registerIpcAllowlist } from './ipc/register.js';
import { SecureStorageController } from './secure-storage-controller.js';
import { SessionController } from './session-controller.js';
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
let session: SessionController | null = null;
let deepLink: DeepLinkController | null = null;
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

  // ---- 9.8 / 8.3：会话（令牌经 safeStorage 加密存储）----
  const secureStorage = new SecureStorageController({ dir: app.getPath('userData') });
  // Auth API：待 Supabase 原生 auth（Edge Functions + GoTrue）接入后替换实现
  session = new SessionController(secureStorage, {
    refreshAccessToken: async () => {
      throw new Error('SessionController: auth 尚未接入（第 3 周 Alpha 后）');
    },
    revoke: async () => undefined,
  });

  // ---- 6.3：Deep Link（pet://invite?token=...）----
  deepLink = new DeepLinkController(
    {
      isSignedIn: () => session?.snapshot.phase === 'ACTIVE',
      applyInvite: async (payload) => {
        // 已登录 → 转发渲染进程执行邀请流程；Alpha 阶段仅透传原始 token
        win.webContents.send('deeplink:payload', payload.rawToken);
      },
      requestSignIn: async () => {
        // 未登录 → Alpha 阶段透传，登录 UI 就绪后打开登录窗
        win.webContents.send('deeplink:payload', 'NEED_SIGN_IN');
      },
    },
    // pending 邀请跨重启保留（userData/deeplink-pending.json 由 store 管理）
  );
  void deepLink.restorePending();

  // Windows：注册 pet:// 为默认协议（用户点击链接拉起应用）
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('pet', process.execPath, [process.argv[1] ?? '']);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow({ savedPosition });
    }
  });
});

// 单实例：二次启动（含点击 pet:// 链接）→ 聚焦已有窗口并处理 deep link
app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('pet://'));
  if (url) void deepLink?.handle(url);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

// macOS：open-url 事件（D-2 后仅维护 Windows，保留以兼容开发环境）
app.on('open-url', (event, url) => {
  event.preventDefault();
  void deepLink?.handle(url);
});

app.on('window-all-closed', () => {
  // 8.2：托盘常驻，不走 quit（用户从托盘"完全退出"才退出）
});
