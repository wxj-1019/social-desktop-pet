/**
 * Electron Main 入口 —— 对应设计稿 8.2 模块结构。
 *
 * Task 10：星屿 Main 生命周期接线。
 * - 显式双窗口：桌宠窗（8.4 透明置顶/穿透）+ 面板窗（8.2 懒创建锚定）
 * - 托盘（8.2/8.4）：打开面板 / 穿透 / 勿扰 / 隐藏显示 / 完全退出
 * - 穿透/隐藏恢复（8.4：不可恢复事故为 0，15.2 Go/No-Go）
 * - 渲染进程崩溃重建（30s 稳定后重置计数）
 * - E2E 钩子：PET_E2E=1 + PET_E2E_USER_DATA_DIR → ready 前隔离 userData
 * - Session/DeepLink/Startup/Update 控制器沿用 Task 1/3，session restore 唯一一次
 */
import type { PanelOpen } from '@pet/protocol';
import { app, BrowserWindow, screen } from 'electron';

import { DeepLinkController } from './deep-link-controller.js';
import { toPersistedPosition } from './display-controller.js';
import { broadcastPetSnapshot, registerIpcAllowlist, sendPetVisual } from './ipc/register.js';
import type { PetIpcDependencies } from './ipc/register.js';
import { PetDragController } from './pet-drag-controller.js';
import { PetProfileStore } from './pet-profile-store.js';
import { PetRuntimeController } from './pet-runtime-controller.js';
import { PositionStore } from './position-store.js';
import { SecureStorageController } from './secure-storage-controller.js';
import { SessionController } from './session-controller.js';
import { createAuthApi, createSessionHandlers } from './session-service.js';
import { StartupController, parseStartupArgs } from './startup-controller.js';
import { TrayController, trayIconPath, type TrayAction } from './tray-controller.js';
import { UpdateController } from './update-controller.js';
import { createUpdateApi } from './update-source.js';
import { createPanelWindow, createPetWindow, setPassThrough } from './window-controller.js';
import type { PanelWindowHandle } from './window-controller.js';

// ---- 8.7 资源削减（app ready 前必须设置）----
// 禁用无关 Chromium 特性（Windows 遮挡计算/翻译/媒体路由/优化提示）——降低后台 CPU 与内存杂项
app.commandLine.appendSwitch(
  'disable-features',
  [
    'CalculateNativeWinOcclusion',
    'Translate',
    'MediaRouter',
    'OptimizationHints',
    'UseOzonePlatform',
  ].join(','),
);
// 渲染进程 V8 老生代堆上限（防堆膨胀；128MB 在历史消息+流式渲染下会 OOM 崩渲染进程，取 256MB）
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---- E2E 隔离（ready 前）：PET_E2E=1 且提供 PET_E2E_USER_DATA_DIR → 独立 userData ----
if (
  process.env['PET_E2E'] &&
  process.env['PET_E2E'] !== '0' &&
  process.env['PET_E2E_USER_DATA_DIR']
) {
  app.setPath('userData', process.env['PET_E2E_USER_DATA_DIR']);
}

// ---- 生命周期状态（模块级，事件处理器跨 whenReady 引用）----
let petWindow: BrowserWindow | null = null;
let panelHandle: PanelWindowHandle | null = null;
let quitting = false;
let tray: TrayController | null = null;
let runtime: PetRuntimeController | null = null;
let drag: PetDragController | null = null;
let profileStore: PetProfileStore | null = null;
let positionStore: PositionStore | null = null;
let ipcDeps: PetIpcDependencies | null = null;
let session: SessionController | null = null;
let deepLink: DeepLinkController | null = null;
let updater: UpdateController | null = null;

// 渲染进程崩溃重建：仅允许一次快速重建；did-finish-load 后 30s 无崩溃重置计数（防崩溃循环）
const RENDERER_STABILIZE_MS = 30_000;
let rendererCrashAttempts = 0;
let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
let runtimeStarted = false;

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
  // 9.8 / 8.3：先创建会话并启动唯一恢复操作，IPC 必须在 renderer 加载前可用。
  const secureStorage = new SecureStorageController({ dir: app.getPath('userData') });
  const createdSession = new SessionController(
    {
      loadRefreshToken: () => secureStorage.getToken(),
      saveRefreshToken: (token) => secureStorage.setToken(token),
      deleteRefreshToken: () => secureStorage.deleteToken(),
    },
    createAuthApi(),
  );
  session = createdSession;
  const restorePromise = createdSession.restore();

  // Task 4：宠物档案持久化（userData/pet-profile.json）
  profileStore = new PetProfileStore(app.getPath('userData'));
  // 8.5：宠物位置持久化（userData/pet-position.json）
  positionStore = new PositionStore(app.getPath('userData'));
  // Task 6：安全拖动控制器；拖动结束即持久化当前位置（可靠触发点——
  // 部分环境 setPosition 不触发 'moved' 事件，不能依赖窗口事件做唯一保存）
  const savePetPosition = (): void => {
    if (!petWindow || !positionStore) return;
    const [x = 0, y = 0] = petWindow.getPosition();
    const displays = screen
      .getAllDisplays()
      .map((d) => ({ id: String(d.id), workArea: d.workArea, scaleFactor: d.scaleFactor }));
    const persisted = toPersistedPosition(displays, { x, y });
    if (persisted) positionStore.save(persisted);
  };
  drag = new PetDragController({ onDragEnd: () => savePetPosition() });

  // Task 5/10：桌宠唯一运行时；snapshot/visual 推送经 IPC deps 广播
  //（ipcDeps 在 createPetWindow 后组装，运行时 start 前的早发 snapshot 被忽略）
  runtime = new PetRuntimeController({
    emitSnapshot: (snap) => {
      if (ipcDeps) broadcastPetSnapshot(ipcDeps, snap);
    },
    emitVisual: (cmd) => {
      if (ipcDeps) sendPetVisual(ipcDeps, cmd);
    },
  });
  // 在线状态：本任务固定 online=true（运行时默认），Task 11 由聊天/网络状态驱动 setOnline

  // ---- 8.4 穿透（Main 端）：窗口 + 托盘 snapshot 同步 ----
  // 唯一穿透入口；tray 的 dispatch('show') 也会先经 onSetPassThrough(false) 回到这里。
  const setPassThroughFromMain = (enabled: boolean): void => {
    if (petWindow) setPassThrough(petWindow, enabled);
    tray?.setPassThroughForced(enabled);
  };

  // ---- 8.2 面板：首次打开时懒创建，锚定到宠物旁 ----
  const openPanel = (view: PanelOpen['view']): void => {
    // 面板窗口若被硬关闭/渲染崩溃销毁，重建句柄（保证面板随时可重开）
    if (!panelHandle || panelHandle.win.isDestroyed()) {
      panelHandle = createPanelWindow();
    }
    if (petWindow) panelHandle.showPanel(petWindow.getBounds());
    panelHandle.win.webContents.send('panel:navigate', view);
  };
  const closePanel = (): void => panelHandle?.hide();
  const showContextMenu = (): void => {
    // Task 10：自定义右键菜单未实现；桌宠右键交互由托盘承载（8.2）
  };

  // ---- 桌宠窗创建 + 生命周期接线（崩溃重建 / 渲染就绪启动运行时）----
  const createAndWirePetWindow = (): BrowserWindow => {
    const win = createPetWindow({
      savedPosition: positionStore!.load(),
      // 8.5：位置变化 → 持久化
      onPositionChanged: (pos) => positionStore!.save(pos),
      // 启动参数：--poc 进窗口能力自检页；--minimized 启动隐藏到托盘
      urlSuffix: startupArgs.poc ? '?poc' : '',
      startHidden: startupArgs.minimized,
    });
    petWindow = win;

    // 崩溃重建：quitting / 已重建过一次 → 跳过；否则 destroy 重建，30s 稳定后重置计数
    win.webContents.on('render-process-gone', () => {
      if (quitting) return;
      if (rendererCrashAttempts >= 1) return;
      rendererCrashAttempts += 1;
      if (stabilityTimer !== null) {
        clearTimeout(stabilityTimer);
        stabilityTimer = null;
      }
      win.destroy();
      createAndWirePetWindow();
    });

    // 渲染就绪：启动运行时（仅一次）+ 挂起 30s 稳定计时（届时重置崩溃计数）
    win.webContents.on('did-finish-load', () => {
      if (!runtimeStarted && runtime) {
        runtimeStarted = true;
        runtime.start();
      }
      if (stabilityTimer !== null) {
        clearTimeout(stabilityTimer);
        stabilityTimer = null;
      }
      stabilityTimer = setTimeout(() => {
        stabilityTimer = null;
        rendererCrashAttempts = 0;
      }, RENDERER_STABILIZE_MS);
    });

    return win;
  };

  // 8.3 IPC allowlist：在 createPetWindow 后、runtime.start 前注册。
  createAndWirePetWindow();
  ipcDeps = {
    getPetWindow: () => petWindow,
    getPanelWindow: () => panelHandle?.win ?? null,
    runtime: runtime!,
    drag: drag!,
    profile: profileStore!,
    getDisplays: () =>
      screen.getAllDisplays().map((d) => ({
        id: String(d.id),
        workArea: d.workArea,
        scaleFactor: d.scaleFactor,
      })),
    openPanel: (target: PanelOpen) => openPanel(target.view),
    closePanel,
    showContextMenu,
    setPassThrough: setPassThroughFromMain,
    sessionHandlers: createSessionHandlers(
      createdSession,
      () => void deepLink?.restorePending(),
      restorePromise,
    ),
  };
  registerIpcAllowlist(ipcDeps);

  // 8.2 启动序列：单点失败不阻塞后续（降级友好）；session restore 由 Task 1 唯一 restorePromise 处理
  const failures = await startup.bootstrap([
    {
      name: 'session-restore',
      run: async () => {
        await restorePromise;
      },
    },
    {
      name: 'deep-link-restore',
      run: async () => {
        // 6.3：Deep Link（pet://invite?token=...）→ 面板方向（登录 / 好友），不直接给 pet 发 payload
        deepLink = new DeepLinkController({
          isSignedIn: () => session?.snapshot.phase === 'ACTIVE',
          applyInvite: async () => {
            // 已登录 → 打开好友面板执行邀请流程
            openPanel('friends');
          },
          requestSignIn: async () => {
            // 未登录 → 打开登录面板
            openPanel('login');
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
  // 13.1/13.5：manifest 经 HTTPS 拉取 + sha256 校验（下载/安装待 V-11 签名链）
  if (app.isPackaged) {
    updater = new UpdateController(
      createUpdateApi(process.env['UPDATE_MANIFEST_URL']),
      app.getVersion(),
      'stable',
    );
    setTimeout(() => void updater?.check(), 30_000);
  }

  // 8.2 托盘（Task 10：注入端口默认用 Electron 原生；图标 assets:tray 生成）
  tray = new TrayController({
    win: () => petWindow,
    handlers: {
      onOpenPanel: (view) => openPanel(view),
      onSetDnd: (enabled) => runtime?.setDnd(enabled),
      onSetPassThrough: setPassThroughFromMain,
      onHide: () => {
        petWindow?.hide();
        runtime?.setHidden(true);
      },
      onShow: () => {
        petWindow?.show();
        petWindow?.setIgnoreMouseEvents(false);
        runtime?.setHidden(false);
      },
      onQuit: () => {
        quitting = true;
        app.quit();
      },
    },
  });
  tray.create(trayIconPath());

  // Windows：注册 pet:// 为默认协议（用户点击链接拉起应用）
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('pet', process.execPath, [process.argv[1] ?? '']);
  }

  app.on('activate', () => {
    // macOS 语义：窗口不存在则重建，存在则前台聚焦
    if (petWindow) {
      petWindow.show();
      petWindow.focus();
    } else {
      createAndWirePetWindow();
    }
  });
});

// 单实例：二次启动（含点击 pet:// 链接）→ 聚焦已有宠物窗并处理 deep link
app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('pet://'));
  if (url) void deepLink?.handle(url);
  if (petWindow) {
    if (petWindow.isMinimized()) petWindow.restore();
    petWindow.show();
    petWindow.focus();
  }
});

// macOS：open-url 事件（D-2 后仅维护 Windows，保留以兼容开发环境）
app.on('open-url', (event, url) => {
  event.preventDefault();
  void deepLink?.handle(url);
});

app.on('before-quit', () => {
  // 托盘"完全退出"/系统退出：标记 quitting（跳过崩溃重建），清理定时器与子资源
  quitting = true;
  if (stabilityTimer !== null) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }
  runtime?.stop();
  drag?.cancel();
  tray?.destroy();
  panelHandle?.allowClose();
});

app.on('window-all-closed', () => {
  // 8.2：托盘常驻，不走 quit（用户从托盘"完全退出"才退出）
});

// ---- Task 12：E2E hook（仅 PET_E2E=1 时暴露；Main 进程直接调用，不经 IPC）----
// 供 e2e/helpers/electron-app.ts 经 app.evaluate 驱动托盘动作 / 读托盘快照 /
// 读窗口状态（bounds/visible）。生产（PET_E2E 未设置）不定义，测试代码拿不到。
export interface PetE2EHookShape {
  invokeTrayAction(action: TrayAction): boolean;
  getTrayState(): { dnd: boolean; passThrough: boolean };
  getPetWindowState(): { bounds: Electron.Rectangle; visible: boolean } | null;
  getWindowState(surface: 'pet' | 'panel'): { bounds: Electron.Rectangle; visible: boolean } | null;
}

declare global {
  var __petE2E: PetE2EHookShape;
}

if (process.env['PET_E2E'] === '1') {
  Object.defineProperty(globalThis, '__petE2E', {
    configurable: true,
    value: {
      invokeTrayAction: (action: TrayAction) => {
        // 返回是否已 dispatch（托盘未就绪时返回 false，供 E2E 轮询等待启动完成）
        if (!tray) return false;
        tray.dispatch(action);
        return true;
      },
      getTrayState: () => tray?.snapshot ?? { dnd: false, passThrough: false },
      getPetWindowState: () =>
        petWindow ? { bounds: petWindow.getBounds(), visible: petWindow.isVisible() } : null,
      getWindowState: (surface: 'pet' | 'panel') => {
        const match = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes(`surface=${surface}`),
        );
        return match ? { bounds: match.getBounds(), visible: match.isVisible() } : null;
      },
    },
  });
}
