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
import { join } from 'node:path';

import type { PanelOpen, PetRuntimeSnapshot } from '@pet/protocol';
import { app, BrowserWindow, screen } from 'electron';

import { DeepLinkController } from './deep-link-controller.js';
import {
  DEFAULT_PET_SCALE,
  MAX_PET_SCALE,
  MIN_PET_SCALE,
  resolvePetPosition,
  toPersistedPosition,
  type DisplayInfo,
  type PetPosition,
} from './display-controller.js';
import { broadcastPetSnapshot, registerIpcAllowlist, sendPetVisual } from './ipc/register.js';
import type { PetIpcDependencies } from './ipc/register.js';
import { deliverPanelMessage } from './panel-delivery.js';
import { PendingInviteStore } from './pending-invite-store.js';
import { PetDragController } from './pet-drag-controller.js';
import { PetProfileStore } from './pet-profile-store.js';
import { PetRuntimeController } from './pet-runtime-controller.js';
import { PetWanderController } from './pet-wander-controller.js';
import { PositionStore } from './position-store.js';
import { SecureStorageController } from './secure-storage-controller.js';
import { SessionController } from './session-controller.js';
import { createAuthApi, createSessionHandlers } from './session-service.js';
import { StartupController, parseStartupArgs } from './startup-controller.js';
import { TrayController, trayIconPath, type TrayAction } from './tray-controller.js';
import { UpdateController } from './update-controller.js';
import { createUpdateApi } from './update-source.js';
import {
  createPanelWindow,
  createPetWindow,
  petWindowSizeFor,
  setPassThrough,
} from './window-controller.js';
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

// ---- E2E 隔离（ready / 单实例锁前）：独立 userData 也隔离 Electron 的实例锁 ----
if (
  process.env['PET_E2E'] &&
  process.env['PET_E2E'] !== '0' &&
  process.env['PET_E2E_USER_DATA_DIR']
) {
  app.setPath('userData', process.env['PET_E2E_USER_DATA_DIR']);
}

// 单实例锁（E2E 已先切换到独立 userData，不会与正在运行的开发实例互斥）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---- 生命周期状态（模块级，事件处理器跨 whenReady 引用）----
let petWindow: BrowserWindow | null = null;
let panelHandle: PanelWindowHandle | null = null;
let quitting = false;
let tray: TrayController | null = null;
let runtime: PetRuntimeController | null = null;
let drag: PetDragController | null = null;
let wander: PetWanderController | null = null;
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
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let runtimeStarted = false;
/** 显示器列表缓存（app ready 后由 refreshDisplays 填充；显示器事件刷新） */
let cachedDisplays: DisplayInfo[] = [];

/** 桌宠窗存活（未销毁）时返回，否则 null —— 崩溃重建边界：所有窗口操作先判存活 */
function alivePetWindow(): BrowserWindow | null {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null;
}

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
  // 6.3：深链 pending 跨重启持久化（userData/pending-invite.json）
  const pendingStore = new PendingInviteStore(join(app.getPath('userData'), 'pending-invite.json'));
  // Task 6：安全拖动控制器；拖动结束即持久化当前位置（可靠触发点——
  // 部分环境 setPosition 不触发 'moved' 事件，不能依赖窗口事件做唯一保存）
  const clearScheduledPositionSave = (): void => {
    if (positionSaveTimer === null) return;
    clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  };
  const schedulePetPositionSave = (position: PetPosition): void => {
    clearScheduledPositionSave();
    positionSaveTimer = setTimeout(() => {
      positionSaveTimer = null;
      positionStore?.save(position);
    }, 250);
  };
  // 显示器列表缓存：wander tick（30fps）与拖动 move 每帧查询显示器，
  // screen.getAllDisplays() 是同步原生调用，显示器变化频率极低 →
  // 缓存 + 显示器事件刷新（语义不变，省掉高频 IPC 往返）。
  const refreshDisplays = (): void => {
    cachedDisplays = screen
      .getAllDisplays()
      .map((d) => ({ id: String(d.id), workArea: d.workArea, scaleFactor: d.scaleFactor }));
  };
  refreshDisplays();
  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);
  const currentDisplays = (): DisplayInfo[] => cachedDisplays;
  const savePetPosition = (): void => {
    clearScheduledPositionSave();
    const win = alivePetWindow();
    if (!win || !positionStore) return;
    const [x = 0, y = 0] = win.getPosition();
    const persisted = toPersistedPosition(currentDisplays(), { x, y });
    // toPersistedPosition 只负责位置（scale 恒为 1）——必须保留当前持久化的
    // 缩放比例，否则拖动/溜达结束保存会把用户调好的桌宠大小重置为 100%
    if (persisted) positionStore.save({ ...persisted, scale: positionStore.load().scale });
  };
  wander = new PetWanderController({
    getWindow: () => alivePetWindow(),
    getDisplays: currentDisplays,
    emitVisual: (command) => {
      if (ipcDeps) sendPetVisual(ipcDeps, command);
    },
    onPositionChanged: savePetPosition,
    onError: (error) => console.warn('[pet-wander] movement stopped', error),
  });
  drag = new PetDragController({
    onDragStart: () => {
      wander?.stop();
      runtime?.beginManualDrag();
    },
    onDragMove: ({ deltaX }) => runtime?.updateManualDrag(deltaX),
    onDragEnd: () => {
      runtime?.endManualDrag();
      savePetPosition();
    },
    onDragCancel: () => runtime?.endManualDrag(),
  });

  const syncWanderToSnapshot = (snapshot: PetRuntimeSnapshot): void => {
    if (snapshot.state === 'WALKING' && !profileStore?.load().reducedMotion) {
      wander?.start();
    } else {
      wander?.stop();
    }
  };

  // Task 5/10：桌宠唯一运行时；snapshot/visual 推送经 IPC deps 广播
  //（ipcDeps 在 createPetWindow 后组装，运行时 start 前的早发 snapshot 被忽略）
  runtime = new PetRuntimeController({
    emitSnapshot: (snap) => {
      syncWanderToSnapshot(snap);
      if (ipcDeps) broadcastPetSnapshot(ipcDeps, snap);
    },
    emitVisual: (cmd) => {
      if (ipcDeps) sendPetVisual(ipcDeps, cmd);
    },
  });
  // 在线状态：本任务固定 online=true（运行时默认），Task 11 由聊天/网络状态驱动 setOnline
  // 勿扰恢复：start() 前用持久化档案初始化（启动即进入 QUIET 模式）
  runtime.setDnd(profileStore.load().dnd);

  // ---- 8.4 穿透（Main 端）：窗口 + 托盘 snapshot 同步 ----
  // 唯一穿透入口；tray 的 dispatch('show') 也会先经 onSetPassThrough(false) 回到这里。
  const setPassThroughFromMain = (enabled: boolean): void => {
    // 拖动中切换穿透会让窗口跟着光标"鬼畜"：先解除拖动状态
    if (enabled) drag?.cancel();
    if (enabled) {
      wander?.stop();
      runtime?.cancelWander();
    }
    const win = alivePetWindow();
    if (win) setPassThrough(win, enabled);
    tray?.setPassThroughForced(enabled);
    // 穿透状态给用户即时反馈：一次性气泡提示（穿透后仍可经托盘/右键恢复）
    if (enabled) {
      runtime?.showBubble('穿透已开启，点击会穿过我。托盘或右键可以恢复');
    }
  };

  // ---- 勿扰（DND）：Main 唯一入口，统一 runtime / 档案 / 托盘快照 ----
  // 托盘 toggle-dnd 与渲染进程 pet:set-dnd 都收敛到这里；托盘侧快照由
  // setDndForced 强制同步（不触发 handler 避免循环），档案持久化供重启恢复。
  const syncDnd = (enabled: boolean): void => {
    runtime?.setDnd(enabled);
    if (profileStore) {
      const current = profileStore.load();
      profileStore.save({ ...current, dnd: enabled });
    }
    tray?.setDndForced(enabled);
  };

  // ---- 桌宠大小：Main 唯一入口，统一窗口尺寸 / 位置钳制 / 持久化 / 托盘快照 ----
  // 右键菜单档位与设置页滑块都收敛到这里；scale 持久化于 PetPosition（重启恢复，
  // 8.5）；托盘菜单勾选由 setScaleForced 强制同步。
  const setPetScale = (scale: number): void => {
    const win = alivePetWindow();
    if (!win || !positionStore) return;
    const s = Math.min(Math.max(scale, MIN_PET_SCALE), MAX_PET_SCALE);
    const size = petWindowSizeFor(s);
    // 以窗口中心为锚 resize + 夹进所在显示器工作区（复用 8.5 位置钳制）
    const displays = currentDisplays();
    const restored = resolvePetPosition(
      { ...positionStore.load(), scale: s, savedAt: Date.now() },
      displays,
      size,
    );
    win.setBounds({ x: restored.x, y: restored.y, width: size.width, height: size.height });
    positionStore.save({ ...positionStore.load(), scale: s, savedAt: Date.now() });
    tray?.setScaleForced(s);
  };

  /** 当前缩放比例（设置页滑块初始值） */
  const getPetScale = (): number => positionStore?.load().scale ?? DEFAULT_PET_SCALE;

  // ---- 8.2 面板：首次打开时懒创建，锚定到宠物旁 ----
  // C1 修复：深链 payload（deeplink:payload）只投递到面板渲染进程，不再发往桌宠窗；
  // 渲染进程未就绪（首次创建/正在加载）时等 did-finish-load 再发（见 panel-delivery.ts）。
  // 待投递 payload 保留在缓冲里，供渲染进程挂载后主动拉取（deeplink:consume-pending），
  // 覆盖"推送早于组件挂载"的时序（登录完成瞬间 FriendsPage 尚未订阅）。
  let panelDeepLinkPayload: string | null = null;
  let panelCrashed = false;
  const openPanel = (view: PanelOpen['view'], deeplinkPayload?: string): void => {
    // 面板窗口被硬关闭销毁 / 渲染进程崩溃 → 重建句柄（保证面板随时可重开）
    if (!panelHandle || panelHandle.win.isDestroyed() || panelCrashed) {
      if (panelHandle && !panelHandle.win.isDestroyed()) {
        // 渲染进程崩溃的旧窗口：放行关闭并销毁，避免泄漏
        panelHandle.allowClose();
        panelHandle.win.destroy();
      }
      panelHandle = createPanelWindow();
      panelCrashed = false;
      // 面板渲染进程崩溃：标记损坏，下次 openPanel 重建（win 对象本身仍存活）
      panelHandle.win.webContents.on('render-process-gone', () => {
        panelCrashed = true;
      });
    }
    const win = alivePetWindow();
    if (win) panelHandle.showPanel(win.getBounds());
    if (deeplinkPayload !== undefined) panelDeepLinkPayload = deeplinkPayload;
    deliverPanelMessage(panelHandle.win, view, deeplinkPayload);
  };
  const closePanel = (): void => panelHandle?.hide();
  // 桌宠右键菜单（8.2）：弹出与托盘同源的原生菜单（打开聊天/好友、穿透、
  // 勿扰、隐藏/显示、退出），动作与勾选状态与托盘完全一致
  const showContextMenu = (): void => {
    const win = alivePetWindow();
    if (win) tray?.popupContextMenu(win);
  };

  // ---- 桌宠窗创建 + 生命周期接线（崩溃重建 / 渲染就绪启动运行时）----
  const createAndWirePetWindow = (): BrowserWindow => {
    const win = createPetWindow({
      savedPosition: positionStore!.load(),
      // 8.5：位置变化 → 持久化
      onPositionChanged: schedulePetPositionSave,
      // 启动参数：--poc 进窗口能力自检页；--minimized 启动隐藏到托盘
      urlSuffix: startupArgs.poc ? '?poc' : '',
      startHidden: startupArgs.minimized,
      // 角色皮肤：从持久化档案读取（重启还原选择）
      character: profileStore!.load().petId,
    });
    petWindow = win;

    // 崩溃重建：quitting → 跳过；二次崩溃 → 放弃重建并置空引用（托盘/面板操作
    // 经 alivePetWindow 判空，不再触碰已销毁窗口）；首次崩溃 destroy 重建，
    // 30s 稳定后重置计数。
    win.webContents.on('render-process-gone', () => {
      if (quitting) return;
      drag?.cancel(); // 拖动中的崩溃：先解除拖动状态，避免残留引用
      wander?.stop();
      if (rendererCrashAttempts >= 1) {
        petWindow = null;
        return;
      }
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
      } else if (runtimeStarted && runtime) {
        syncWanderToSnapshot(runtime.snapshot);
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
    appVersion: app.getVersion(),
    getPetWindow: () => petWindow,
    getPanelWindow: () => panelHandle?.win ?? null,
    runtime: runtime!,
    drag: drag!,
    profile: profileStore!,
    getDisplays: currentDisplays,
    openPanel: (target: PanelOpen) => openPanel(target.view),
    closePanel,
    showContextMenu,
    // C1：渲染进程挂载后拉取尚未投递成功的深链 payload（拉取即清除，兜底时序竞态）
    consumeDeepLinkPayload: () => {
      const payload = panelDeepLinkPayload;
      panelDeepLinkPayload = null;
      return payload;
    },
    setPassThrough: setPassThroughFromMain,
    setDnd: syncDnd,
    setPetScale,
    getPetScale,
    // 角色皮肤切换：保存 profile 后用新 character 参数重建桌宠窗
    //（销毁旧窗 → createAndWirePetWindow 读 profileStore.petId 创建新窗；
    // 重载瞬间空白可接受——角色切换是低频操作，运行时不重启）
    reloadPetWithCharacter: () => {
      drag?.cancel();
      wander?.stop();
      const old = alivePetWindow();
      if (old && !old.isDestroyed()) {
        old.destroy();
      }
      petWindow = null;
      rendererCrashAttempts = 0; // 重建不算崩溃，重置计数
      createAndWirePetWindow();
    },
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
        deepLink = new DeepLinkController(
          {
            isSignedIn: () => session?.snapshot.phase === 'ACTIVE',
            applyInvite: async (payload) => {
              // 已登录 → 打开好友面板执行邀请流程；邀请 token 投递到面板（C1）
              openPanel('friends', payload.rawToken);
            },
            requestSignIn: async () => {
              // 未登录 → 打开登录面板；登录后恢复邀请（6.3）
              openPanel('login', 'NEED_SIGN_IN');
            },
          },
          // 6.3：pending 跨重启持久化（点链接后退出应用，下次启动登录完成仍可恢复邀请）
          pendingStore,
        );
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
    handlers: {
      onOpenPanel: (view) => openPanel(view),
      onSetDnd: (enabled) => syncDnd(enabled),
      onSetScale: (scale) => setPetScale(scale),
      onSetPassThrough: setPassThroughFromMain,
      onHide: () => {
        drag?.cancel(); // 隐藏前解除进行中的拖动，避免残留会话
        wander?.stop();
        alivePetWindow()?.hide();
        runtime?.setHidden(true);
      },
      onShow: () => {
        const win = alivePetWindow();
        win?.show();
        win?.setIgnoreMouseEvents(false);
        runtime?.setHidden(false);
      },
      onQuit: () => {
        quitting = true;
        app.quit();
      },
    },
  });
  tray.create(trayIconPath());
  // 托盘创建后同步持久化的勿扰状态（菜单勾选与 runtime/档案一致）
  tray.setDndForced(profileStore.load().dnd);

  // Windows：注册 pet:// 为默认协议（用户点击链接拉起应用）
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient('pet', process.execPath, [process.argv[1] ?? '']);
  }

  app.on('activate', () => {
    // macOS 语义：窗口不存在/已销毁则重建，存在则前台聚焦
    const win = alivePetWindow();
    if (win) {
      win.show();
      win.focus();
    } else {
      createAndWirePetWindow();
    }
  });
});

// 单实例：二次启动（含点击 pet:// 链接）→ 聚焦已有宠物窗并处理 deep link
app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('pet://'));
  if (url) void deepLink?.handle(url);
  const win = alivePetWindow();
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

app.on('before-quit', () => {
  // 托盘"完全退出"/系统退出：标记 quitting（跳过崩溃重建），清理定时器与子资源
  quitting = true;
  if (stabilityTimer !== null) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }
  runtime?.stop();
  wander?.stop();
  drag?.cancel();
  if (positionSaveTimer !== null) {
    clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
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
  startWander(): boolean;
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
      startWander: () => runtime?.tryStartWander() ?? false,
      getTrayState: () => tray?.snapshot ?? { dnd: false, passThrough: false },
      getPetWindowState: () => {
        const win = alivePetWindow();
        return win ? { bounds: win.getBounds(), visible: win.isVisible() } : null;
      },
      getWindowState: (surface: 'pet' | 'panel') => {
        const match = BrowserWindow.getAllWindows().find((w) => {
          try {
            return w.webContents.getURL().includes(`surface=${surface}`);
          } catch {
            // 窗口 close 异步：webContents 可能已销毁（e2e 轮询竞态），跳过
            return false;
          }
        });
        return match ? { bounds: match.getBounds(), visible: match.isVisible() } : null;
      },
    },
  });
}
