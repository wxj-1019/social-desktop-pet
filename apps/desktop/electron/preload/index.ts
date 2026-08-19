/**
 * Preload —— 8.3 只暴露最小、版本化的 API。
 * contextBridge 隔离，不把 require/Node 能力暴露给渲染进程。
 * Task 7：新增 petRuntime / panel / petProfile 命名空间，类型全部来自 @pet/protocol；
 * 所有 subscribe 返回 void cleanup；session / deepLink 等既有 API 保持不变。
 */
import { contextBridge, ipcRenderer } from 'electron';

import type {
  LocalLlmChatRequest,
  LocalLlmConfig,
  LocalLlmConfigView,
  PanelOpen,
  PetActionDecision,
  PetActionRequest,
  PetChatEvent,
  PetDragPoint,
  PetInteraction,
  PetId,
  PetProfile,
  PetRuntimeSnapshot,
  PetSocialEvent,
  PetVisualCommand,
} from '@pet/protocol';

import type { SessionIpcResult } from '../main/session-service.js';

export type SessionIpcError = { error: string };
export type SessionResult = SessionIpcResult | SessionIpcError;

const api = {
  version: '0.0.0',
  platform: process.platform,
  /** 8.4 整窗穿透切换 */
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.send('window:setIgnoreMouseEvents', { enabled: ignore }),
  minimize: () => ipcRenderer.send('window:minimize'),
  hide: () => ipcRenderer.send('window:hide'),
  /** 6.3 Deep Link payload（登录后恢复邀请流程）；返回取消订阅函数 */
  onDeepLink: (cb: (payload: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: string) => cb(payload);
    ipcRenderer.on('deeplink:payload', listener);
    return () => {
      ipcRenderer.removeListener('deeplink:payload', listener);
    };
  },
  /** 6.3 拉取主进程尚未被推送消费的深链 payload（拉取即清除）——面板挂载时序兜底（C1） */
  consumeDeepLinkPayload: () =>
    ipcRenderer.invoke('deeplink:consume-pending') as Promise<string | null>,
  /** 8.2 开机自启（Windows 登录项；仅打包版生效，dev 恒 false） */
  autoLaunch: {
    get: () => ipcRenderer.invoke('app:get-auto-launch') as Promise<boolean>,
    set: (enabled: boolean) => ipcRenderer.send('app:set-auto-launch', { enabled }),
  },
  /** 自建后端地址（D-13）：API client 基址 */
  getApiBase: () => ipcRenderer.invoke('app:getApiBase') as Promise<string>,
  /** 桌宠大小：调节（滑块/档位）与查询 */
  setPetScale: (scale: number) => ipcRenderer.send('pet:set-size', { scale }),
  getPetScale: () => ipcRenderer.invoke('pet:get-size') as Promise<number>,
  /** 9.8 会话：启动恢复 / 登录 / 注册 / 刷新 / 登出（refresh token 留在主进程 safeStorage） */
  session: {
    init: () => ipcRenderer.invoke('session:init') as Promise<SessionResult>,
    login: (payload: { email: string; password: string; deviceId: string }) =>
      ipcRenderer.invoke('session:login', payload) as Promise<SessionResult>,
    register: (payload: { email: string; password: string; deviceId: string; nickname: string }) =>
      ipcRenderer.invoke('session:register', payload) as Promise<SessionResult>,
    refresh: () => ipcRenderer.invoke('session:refresh') as Promise<SessionResult>,
    revoke: () => ipcRenderer.invoke('session:revoke') as Promise<SessionResult>,
  },
  /** PoC 专用：读取多屏信息（第 1–2 周窗口能力 PoC；第 3 周由 DisplayController 正式接入） */
  getDisplays: () => ipcRenderer.invoke('poc:getDisplays') as Promise<unknown>,
  /** 7.x 桌宠运行时：快照查询/订阅、视觉指令订阅、交互与动作输入 */
  petRuntime: {
    getSnapshot: () => ipcRenderer.invoke('pet:runtime:get') as Promise<PetRuntimeSnapshot>,
    onSnapshot: (cb: (snapshot: PetRuntimeSnapshot) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, snapshot: PetRuntimeSnapshot) =>
        cb(snapshot);
      ipcRenderer.on('pet:runtime:snapshot', listener);
      return () => {
        ipcRenderer.removeListener('pet:runtime:snapshot', listener);
      };
    },
    onVisualCommand: (cb: (command: PetVisualCommand) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, command: PetVisualCommand) => cb(command);
      ipcRenderer.on('pet:visual-command', listener);
      return () => {
        ipcRenderer.removeListener('pet:visual-command', listener);
      };
    },
    interaction: (interaction: PetInteraction) => ipcRenderer.send('pet:interaction', interaction),
    requestAction: (request: PetActionRequest) =>
      ipcRenderer.invoke('pet:request-action', request) as Promise<PetActionDecision>,
    chatEvent: (event: PetChatEvent) => ipcRenderer.send('pet:chat-event', event),
    socialEvent: (event: PetSocialEvent) => ipcRenderer.send('pet:social-event', event),
    dragStart: (point: PetDragPoint) => ipcRenderer.send('pet:drag-start', point),
    dragMove: (point: PetDragPoint) => ipcRenderer.send('pet:drag-move', point),
    dragEnd: () => ipcRenderer.send('pet:drag-end'),
    setDnd: (enabled: boolean) => ipcRenderer.send('pet:set-dnd', { enabled }),
    /** 在线状态上报（面板 WS 连接状态；断线时桌宠给出人格化提示） */
    setOnline: (online: boolean) => ipcRenderer.send('pet:set-online', { enabled: online }),
    setPassThrough: (enabled: boolean) => ipcRenderer.send('pet:set-pass-through', { enabled }),
    /** 隐藏/显示桌宠（与托盘同源入口；隐藏后经托盘"显示"或 SAO 恢复） */
    setHidden: (hidden: boolean) => ipcRenderer.send('pet:set-hidden', { enabled: hidden }),
    showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
    /** 环形菜单画布：菜单展开时请求 Main 把桌宠窗临时扩到 ≥240×260 基准
     *  （右下锚定，桌宠屏幕位置不动）——任何桌宠大小档位下菜单完整可见 */
    setMenuCanvas: (expanded: boolean) => ipcRenderer.send('pet:set-menu-canvas', { expanded }),
    /** 面板 → 桌宠一次性气泡（记忆"已记住"等提示；走 main 侧 showBubble） */
    showBubble: (text: string) =>
      ipcRenderer.send('pet:show-bubble', { type: 'bubble', text } satisfies PetVisualCommand),
  },
  /** 8.2 面板：打开/关闭/导航（navigate 结果广播回 onNavigate） */
  panel: {
    open: (view: PanelOpen) => ipcRenderer.send('panel:open', view),
    close: () => ipcRenderer.send('panel:close'),
    navigate: (view: PanelOpen) => ipcRenderer.invoke('panel:navigate', view) as Promise<PanelOpen>,
    onNavigate: (cb: (view: PanelOpen) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, view: PanelOpen) => cb(view);
      ipcRenderer.on('panel:navigate', listener);
      return () => {
        ipcRenderer.removeListener('panel:navigate', listener);
      };
    },
  },
  /** 4.x 档案：读取 / 保存（set 返回保存后的新档案） */
  petProfile: {
    get: () => ipcRenderer.invoke('pet-profile:get') as Promise<PetProfile>,
    set: (profile: PetProfile) =>
      ipcRenderer.invoke('pet-profile:set', profile) as Promise<PetProfile>,
    /** 档案变更推送（main→pet：设置页写入后气泡/减弱动态即时生效） */
    onChanged: (cb: (profile: PetProfile) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, profile: PetProfile) => cb(profile);
      ipcRenderer.on('pet:profile-changed', listener);
      return () => {
        ipcRenderer.removeListener('pet:profile-changed', listener);
      };
    },
    /** 切换角色皮肤（保存 petId + 重载桌宠窗；返回切换后的 petId） */
    setCharacter: (petId: PetId) =>
      ipcRenderer.invoke('pet:set-character', petId) as Promise<PetId>,
  },
  /** 本地 BYOK 模型（OpenAI 兼容）：密钥只存 Main，视图不含密钥 */
  localLlm: {
    getView: () => ipcRenderer.invoke('local-llm:get') as Promise<LocalLlmConfigView>,
    save: (config: LocalLlmConfig) =>
      ipcRenderer.invoke('local-llm:set', config) as Promise<LocalLlmConfigView>,
    chat: (request: LocalLlmChatRequest) =>
      ipcRenderer.invoke('local-llm:chat', request) as Promise<
        { reply: string } | { error: string }
      >,
  },
} as const;

contextBridge.exposeInMainWorld('pet', api);

export type PetApi = typeof api;
