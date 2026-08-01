/**
 * Electron Main 入口 —— 对应设计稿 8.2 模块结构。
 * 第 3 周单人 Alpha：接入 TrayController、多屏位置持久化（8.5）、IPC allowlist、
 * Session/DeepLink 控制器（9.8 / 6.3）、Startup/Update 控制器（8.2）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

import { DeepLinkController } from './deep-link-controller.js';
import type { PetPosition } from './display-controller.js';
import { registerIpcAllowlist } from './ipc/register.js';
import { SecureStorageController } from './secure-storage-controller.js';
import { SessionController } from './session-controller.js';
import { createAuthApi, createSessionHandlers } from './session-service.js';
import { StartupController, parseStartupArgs } from './startup-controller.js';
import { TrayController } from './tray-controller.js';
import { UpdateController } from './update-controller.js';
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
let updater: UpdateController | null = null;
const savedPosition = loadSavedPosition();

// 8.2 StartupController：自启动开关（D30 留存指标依赖项）+ 启动参数
const startup = new StartupController({
  setAutoLaunch: (enabled) => {
    // Windows 登录项（app.setLoginItemSettings）；仅打包版生效
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled });
  },
  isAutoLaunchEnabled: () => (app.isPackaged ? app.getLoginItemSettings().openAtLogin : false),
});
const startupArgs = parseStartupArgs(process.argv);

void app.whenReady().then(async () => {
  // 主窗先行（桌宠核心；即便会话恢复失败也保证窗口出现）
  const win = createPetWindow({
    savedPosition,
    // 8.5：位置变化 → 持久化
    onPositionChanged: (pos) => persistPosition(pos),
    // 启动参数：--poc 进窗口能力自检页；--minimized 启动隐藏到托盘
    urlSuffix: startupArgs.poc ? '?poc' : '',
    startHidden: startupArgs.minimized,
  });

  // 8.2 启动序列：单点失败不阻塞后续（降级友好）
  const failures = await startup.bootstrap([
    {
      name: 'session-restore',
      run: async () => {
        // 9.8 / 8.3：会话（令牌经 safeStorage 加密存储；Auth API 直连自建后端，D-13）
        const secureStorage = new SecureStorageController({ dir: app.getPath('userData') });
        // SecureStorageController（get/set/deleteToken）适配 SessionStorage 接口
        session = new SessionController(
          {
            loadRefreshToken: () => secureStorage.getToken(),
            saveRefreshToken: (token) => secureStorage.setToken(token),
            deleteRefreshToken: () => secureStorage.deleteToken(),
          },
          createAuthApi(),
        );
        await session.restore();
      },
    },
    {
      name: 'deep-link-restore',
      run: async () => {
        // 6.3：Deep Link（pet://invite?token=...）
        deepLink = new DeepLinkController({
          isSignedIn: () => session?.snapshot.phase === 'ACTIVE',
          applyInvite: async (payload) => {
            // 已登录 → 转发渲染进程执行邀请流程；Alpha 阶段仅透传原始 token
            win.webContents.send('deeplink:payload', payload.rawToken);
          },
          requestSignIn: async () => {
            // 未登录 → Alpha 阶段透传，登录 UI 就绪后打开登录窗
            win.webContents.send('deeplink:payload', 'NEED_SIGN_IN');
          },
        });
        await deepLink.restorePending();
      },
    },
  ]);
  if (failures.length > 0) {
    // 启动降级记录（console + 可接日志上报）；不阻止主窗
    console.warn(`[startup] degraded hooks: ${failures.join(', ')}`);
  }

  // 6.3：应用未运行时点击 pet:// 链接 → 启动 argv 携带 URL → 记入 pending
  //（已运行场景由 second-instance 事件处理；未登录时登录成功后 restorePending 恢复）
  const startupDeepLink = process.argv.find((a) => a.startsWith('pet://'));
  if (startupDeepLink) void deepLink?.handle(startupDeepLink);

  // 8.2 更新：启动 30s 后静默检查（不自打扰）；仅打包版执行
  if (app.isPackaged) {
    updater = new UpdateController(
      {
        // Update API：待接入更新服务器（HTTPS manifest + 签名校验，见 8.3/13.5）
        checkForUpdate: async () => null,
        download: async () => {
          throw new Error('UpdateController: 更新源尚未接入');
        },
        verify: async () => undefined,
        install: async () => undefined,
      },
      app.getVersion(),
      'stable',
    );
    setTimeout(() => void updater?.check(), 30_000);
  }

  // 8.2 托盘
  tray = new TrayController(() => win, {
    onTogglePassThrough: (on) => setPassThrough(win, on),
    onToggleDnd: () => {
      /* 第 3 周接 PetStateMachine QUIET 状态 */
    },
    onQuit: () => app.quit(),
  });
  tray.create();

  // 8.3 IPC allowlist 生效（session 通道：登录完成 → 恢复 pending 邀请，6.3）
  registerIpcAllowlist(
    () => win,
    createSessionHandlers(session!, () => void deepLink?.restorePending()),
  );

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
