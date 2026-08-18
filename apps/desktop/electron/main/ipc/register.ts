/**
 * IPC 注册 —— 对应设计稿 8.3（IPC 输入使用 Schema 验证、allowlist、sender 窗口绑定）。
 *
 * 审查修复 #6 + Task 7：
 * 1. 只注册 allowlist 内的通道（其余一律拒绝）
 * 2. 输入用 @pet/protocol 的 zod schema 校验（parseIpcPayload，失败抛稳定错误）
 * 3. 每个 handler 先用 validateIpcSender 绑定窗口身份（pet/panel surface），
 *    越权 surface 调用一律拒绝
 * 4. main→renderer 推送辅助 broadcastPetSnapshot / sendPetVisual（Task 10 接线）
 */
import { ipcMain, screen } from 'electron';
import type { BrowserWindow } from 'electron';

import {
  BooleanSettingSchema,
  LocalLlmChatRequestSchema,
  LocalLlmConfigSchema,
  PanelOpenSchema,
  PetActionRequestSchema,
  PetChatEventSchema,
  PetDragPointSchema,
  PetIdSchema,
  PetInteractionSchema,
  PetProfileSchema,
  PetSetSizeSchema,
  PetSocialEventSchema,
  PetVisualCommandSchema,
} from '@pet/protocol';
import type {
  LocalLlmChatRequest,
  LocalLlmConfig,
  LocalLlmConfigView,
  PanelOpen,
  PetRuntimeSnapshot,
  PetVisualCommand,
} from '@pet/protocol';

import type { DisplayLike } from '../display-controller.js';
import type { PetDragController } from '../pet-drag-controller.js';
import type { PetProfileStore } from '../pet-profile-store.js';
import type { PetRuntimeController } from '../pet-runtime-controller.js';
import { IPC_ALLOWLIST } from '../security.js';
import {
  apiBaseUrl,
  SessionLoginPayloadSchema,
  SessionRegisterPayloadSchema,
  type SessionServiceHandlers,
} from '../session-service.js';

import { parseIpcPayload, validateIpcSender } from './ipc-validation.js';
import type { IpcSenderEvent, IpcSurface } from './ipc-validation.js';

const ALLOWED = new Set<string>(IPC_ALLOWLIST);

/** Task 7：registerIpcAllowlist 的依赖端口（窗口 + 运行时 + 拖动 + 档案 + 面板动作） */
export interface PetIpcDependencies {
  /** 应用版本（app.getVersion() 注入；app:version 返回） */
  appVersion: string;
  /** 桌宠窗口（可空，未创建前拒绝调用） */
  getPetWindow: () => BrowserWindow | null;
  /** 面板窗口（可空） */
  getPanelWindow: () => BrowserWindow | null;
  /** 桌宠唯一运行时（Task 5） */
  runtime: PetRuntimeController;
  /** 安全拖动控制器（Task 6） */
  drag: PetDragController;
  /** 档案持久化（Task 4） */
  profile: PetProfileStore;
  /** 全部显示器（拖动夹取用，8.5） */
  getDisplays: () => DisplayLike[];
  /** 打开面板（按目标视图） */
  openPanel: (view: PanelOpen) => void;
  /** 关闭面板 */
  closePanel: () => void;
  /** 消费主进程待投递的深链 payload（拉取即清除；C1 时序兜底） */
  consumeDeepLinkPayload: () => string | null;
  /** 桌宠右键菜单 */
  showContextMenu: () => void;
  /** 整窗穿透切换（8.4） */
  setPassThrough: (enabled: boolean) => void;
  /** 勿扰开关单一入口（Main 端 syncDnd：runtime + 档案持久化 + 托盘快照） */
  setDnd: (enabled: boolean) => void;
  /** 桌宠大小调节单一入口（Main 端 setPetScale：resize + 位置钳制 + 持久化 + 托盘快照） */
  setPetScale: (scale: number) => void;
  /** 当前缩放比例（设置页滑块初始值） */
  getPetScale: () => number;
  /** 隐藏桌宠单一入口（窗口 hide + 运行时 HIDDEN；托盘同源） */
  hidePet: () => void;
  /** 显示桌宠单一入口（窗口 show + 解除穿透 + 运行时恢复；托盘同源） */
  showPet: () => void;
  /** 开机自启（8.2 留存指标）：查询/开关，仅面板窗可调用 */
  autoLaunch: {
    get: () => boolean;
    set: (enabled: boolean) => void;
  };
  /** 本地 BYOK 模型（OpenAI 兼容）：配置视图 / 保存 / 聊天 */
  localLlm: {
    view: () => LocalLlmConfigView;
    save: (config: LocalLlmConfig) => LocalLlmConfigView;
    chat: (request: LocalLlmChatRequest) => Promise<{ reply: string } | { error: string }>;
  };
  /** 切换角色皮肤：保存 profile.petId + 用新 ?character= 重载桌宠窗 */
  reloadPetWithCharacter: (petId: string) => void;
  /** 会话 handler（Task 1；可选，缺省不注册会话通道） */
  sessionHandlers?: SessionServiceHandlers;
}

function senderWindow(surface: IpcSurface, deps: PetIpcDependencies): BrowserWindow | null {
  return surface === 'pet' ? deps.getPetWindow() : deps.getPanelWindow();
}

/**
 * 校验 sender 属于某个（些）surface 的期望窗口；多 surface 通道逐个尝试，
 * 全部失败抛最后一个校验错误。
 */
function validateSender(
  event: IpcSenderEvent,
  deps: PetIpcDependencies,
  surface: IpcSurface | IpcSurface[],
): BrowserWindow {
  const surfaces = Array.isArray(surface) ? surface : [surface];
  let lastError: unknown = null;
  for (const s of surfaces) {
    try {
      return validateIpcSender(event, senderWindow(s, deps), s);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('[IPC] 发送窗口不被允许');
}

/** 注册一个受 allowlist + sender 校验保护的 invoke 通道 */
function registerInvoke(
  deps: PetIpcDependencies,
  channel: string,
  surface: IpcSurface | IpcSurface[],
  handler: (win: BrowserWindow, payload: unknown) => unknown,
): void {
  if (!ALLOWED.has(channel)) {
    throw new Error(`[IPC] 通道 "${channel}" 不在 allowlist 中`);
  }
  ipcMain.handle(channel, (event, payload) => {
    const win = validateSender(event, deps, surface);
    return handler(win, payload);
  });
}

/** 注册一个受 allowlist + sender 校验保护的 on（send）通道 */
function registerOn(
  deps: PetIpcDependencies,
  channel: string,
  surface: IpcSurface | IpcSurface[],
  handler: (win: BrowserWindow, payload: unknown) => void,
): void {
  if (!ALLOWED.has(channel)) {
    throw new Error(`[IPC] 通道 "${channel}" 不在 allowlist 中`);
  }
  ipcMain.on(channel, (event, payload) => {
    const win = validateSender(event, deps, surface);
    handler(win, payload);
  });
}

/** 注册会话 IPC（Task 1 基线；仅面板窗可调用；失败统一返回 { error } 信封） */
function registerSessionIpc(deps: PetIpcDependencies, handlers: SessionServiceHandlers): void {
  const register = (channel: string, fn: (payload: unknown) => Promise<unknown>) => {
    if (!ALLOWED.has(channel)) {
      throw new Error(`[IPC] 通道 "${channel}" 不在 allowlist 中`);
    }
    ipcMain.handle(channel, (event, payload) => {
      try {
        // sender 与 payload 校验都进 { error } 信封（会话通道的既有契约）
        validateIpcSender(event, deps.getPanelWindow(), 'panel');
        return fn(payload);
      } catch (error) {
        return { error: (error as Error).message };
      }
    });
  };
  register('session:init', () => handlers.init());
  register('session:login', (p) => handlers.login(parseIpcPayload(SessionLoginPayloadSchema, p)));
  register('session:register', (p) =>
    handlers.register(parseIpcPayload(SessionRegisterPayloadSchema, p)),
  );
  register('session:refresh', () => handlers.refresh());
  register('session:revoke', () => handlers.revoke());
}

/**
 * 注册全部 IPC 通道（Task 7：全部通道带 schema + sender 校验）。
 * 推送通道 pet:runtime:snapshot / pet:visual-command / deeplink:payload 只由 main
 * 内部 webContents.send，不在这里注册 renderer→main handler。
 */
export function registerIpcAllowlist(deps: PetIpcDependencies): void {
  const { runtime, drag, profile, getDisplays } = deps;

  // ---- 基础通道 ----
  registerInvoke(deps, 'app:version', ['pet', 'panel'], () => deps.appVersion);
  registerInvoke(deps, 'app:getApiBase', ['pet', 'panel'], () => apiBaseUrl());
  // 8.2 开机自启（留存指标）：仅设置页（panel）读写
  registerInvoke(deps, 'app:get-auto-launch', 'panel', () => deps.autoLaunch.get());
  registerOn(deps, 'app:set-auto-launch', 'panel', (_win, payload) => {
    const { enabled } = parseIpcPayload(BooleanSettingSchema, payload);
    deps.autoLaunch.set(enabled);
  });

  registerOn(deps, 'window:setIgnoreMouseEvents', 'pet', (win, payload) => {
    const { enabled } = parseIpcPayload(BooleanSettingSchema, payload);
    win.setIgnoreMouseEvents(enabled, { forward: true });
  });
  registerOn(deps, 'window:minimize', 'pet', (win) => {
    win.minimize();
  });
  registerOn(deps, 'window:hide', 'pet', (win) => {
    win.hide();
  });

  // ---- 会话（9.8）：仅面板窗可调用 ----
  if (deps.sessionHandlers) registerSessionIpc(deps, deps.sessionHandlers);

  // ---- 桌宠运行时（7.x）：runtime:get 两窗皆可；动作/交互仅 pet ----
  registerInvoke(deps, 'pet:runtime:get', ['pet', 'panel'], () => runtime.snapshot);
  registerInvoke(deps, 'pet:request-action', 'pet', (_win, payload) =>
    runtime.requestAction(parseIpcPayload(PetActionRequestSchema, payload)),
  );
  registerOn(deps, 'pet:interaction', 'pet', (_win, payload) =>
    runtime.handleInteraction(parseIpcPayload(PetInteractionSchema, payload)),
  );
  registerOn(deps, 'pet:chat-event', ['pet', 'panel'], (_win, payload) =>
    runtime.handleChat(parseIpcPayload(PetChatEventSchema, payload)),
  );
  registerOn(deps, 'pet:social-event', ['pet', 'panel'], (_win, payload) =>
    runtime.handleSocialEvent(parseIpcPayload(PetSocialEventSchema, payload)),
  );
  // 桌宠大小：设置页滑块（send）与查询（invoke）
  registerOn(deps, 'pet:set-size', ['pet', 'panel'], (_win, payload) => {
    const { scale } = parseIpcPayload(PetSetSizeSchema, payload);
    deps.setPetScale(scale);
  });
  registerInvoke(deps, 'pet:get-size', 'panel', () => deps.getPetScale());
  // 勿扰：SAO 菜单（pet）与设置页（panel）共入口；Main 端 syncDnd 统一
  // runtime / 档案 / 托盘（快照广播由 runtime emit 驱动）
  registerOn(deps, 'pet:set-dnd', ['pet', 'panel'], (_win, payload) => {
    const { enabled } = parseIpcPayload(BooleanSettingSchema, payload);
    deps.setDnd(enabled);
  });
  // 在线状态：面板实时连接状态上报（断线时运行时给"网络不在，我先陪你"气泡）
  registerOn(deps, 'pet:set-online', 'panel', (_win, payload) => {
    const { enabled } = parseIpcPayload(BooleanSettingSchema, payload);
    runtime.setOnline(enabled);
  });
  // 穿透：同上，设置页需要反射与切换（关闭穿透即恢复交互）
  registerOn(deps, 'pet:set-pass-through', ['pet', 'panel'], (_win, payload) => {
    const { enabled } = parseIpcPayload(BooleanSettingSchema, payload);
    deps.setPassThrough(enabled);
  });
  // 隐藏/显示桌宠（SAO 菜单快捷项；与托盘 hide/show 同源入口）
  registerOn(deps, 'pet:set-hidden', 'pet', (_win, payload) => {
    const { enabled } = parseIpcPayload(BooleanSettingSchema, payload);
    if (enabled) deps.hidePet();
    else deps.showPet();
  });
  registerOn(deps, 'pet:show-context-menu', 'pet', () => deps.showContextMenu());
  // 面板 → 桌宠气泡（记忆"已记住"/确认提示；复用 PetVisualCommandSchema.bubble 契约）
  registerOn(deps, 'pet:show-bubble', ['pet', 'panel'], (_win, payload) => {
    const cmd = parseIpcPayload(PetVisualCommandSchema, payload);
    if (cmd.type === 'bubble' && cmd.text !== null && cmd.text !== '') {
      runtime.showBubble(cmd.text);
    }
  });

  // ---- 拖动（8.5）：仅 pet ----
  registerOn(deps, 'pet:drag-start', 'pet', (win, payload) =>
    drag.start(win, parseIpcPayload(PetDragPointSchema, payload)),
  );
  registerOn(deps, 'pet:drag-move', 'pet', (win, payload) =>
    drag.move(win, parseIpcPayload(PetDragPointSchema, payload), getDisplays()),
  );
  registerOn(deps, 'pet:drag-end', 'pet', () => drag.end());

  // ---- 面板（8.2）：面板窗调用；桌宠窗双击/动作也可打开（pet-experience 双击开聊天） ----
  registerOn(deps, 'panel:open', ['pet', 'panel'], (_win, payload) =>
    deps.openPanel(parseIpcPayload(PanelOpenSchema, payload)),
  );
  registerOn(deps, 'panel:close', 'panel', () => deps.closePanel());
  registerInvoke(deps, 'panel:navigate', 'panel', (_win, payload) => {
    const view = parseIpcPayload(PanelOpenSchema, payload);
    deps.getPanelWindow()?.webContents.send('panel:navigate', view);
    return view;
  });
  // C1：深链 payload 拉取（面板挂载后消费；推送可能早于组件订阅，见 index.ts openPanel）
  registerInvoke(deps, 'deeplink:consume-pending', 'panel', () => deps.consumeDeepLinkPayload());

  // ---- 档案（Task 4）：读取两窗皆可；写入仅 panel ----
  registerInvoke(deps, 'pet-profile:get', ['pet', 'panel'], () => profile.load());
  registerInvoke(deps, 'pet-profile:set', 'panel', (_win, payload) => {
    const next = parseIpcPayload(PetProfileSchema, payload);
    profile.save(next);
    // 推送给桌宠窗：气泡开关/减弱动态等即时生效（否则只在挂载时读一次）
    deps.getPetWindow()?.webContents.send('pet:profile-changed', next);
    return next;
  });

  // ---- 角色皮肤切换：校验 petId 枚举 → 保存 profile → 重载桌宠窗（仅 panel）----
  registerInvoke(deps, 'pet:set-character', 'panel', (_win, payload) => {
    const petId = parseIpcPayload(PetIdSchema, payload);
    const next = { ...profile.load(), petId };
    profile.save(next);
    deps.reloadPetWithCharacter(petId);
    return petId;
  });

  // ---- 本地 BYOK 模型（OpenAI 兼容）：设置页读写视图；本地聊天经 Main 调用 ----
  registerInvoke(deps, 'local-llm:get', ['pet', 'panel'], () => deps.localLlm.view());
  registerInvoke(deps, 'local-llm:set', 'panel', (_win, payload) =>
    deps.localLlm.save(parseIpcPayload(LocalLlmConfigSchema, payload)),
  );
  registerInvoke(deps, 'local-llm:chat', 'panel', (_win, payload) =>
    deps.localLlm.chat(parseIpcPayload(LocalLlmChatRequestSchema, payload)),
  );

  // ---- PoC 专用：多屏信息（第 1–2 周窗口能力 PoC；第 3 周由 DisplayController 正式接入）----
  registerInvoke(deps, 'poc:getDisplays', 'pet', () => {
    return screen.getAllDisplays().map((d) => ({
      id: String(d.id),
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    }));
  });
}

/** 推送运行时快照到 pet（及可选 panel）窗口 —— Task 10 接线用 */
export function broadcastPetSnapshot(deps: PetIpcDependencies, snapshot: PetRuntimeSnapshot): void {
  deps.getPetWindow()?.webContents.send('pet:runtime:snapshot', snapshot);
  deps.getPanelWindow()?.webContents.send('pet:runtime:snapshot', snapshot);
}

/** 推送视觉指令到 pet 窗口 —— Task 10 接线用 */
export function sendPetVisual(deps: PetIpcDependencies, command: PetVisualCommand): void {
  deps.getPetWindow()?.webContents.send('pet:visual-command', command);
}
