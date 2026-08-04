/**
 * Preload —— 8.3 只暴露最小、版本化的 API。
 * contextBridge 隔离，不把 require/Node 能力暴露给渲染进程。
 * Task 7：新增 petRuntime / panel / petProfile 命名空间，类型全部来自 @pet/protocol；
 * 所有 subscribe 返回 void cleanup；session / deepLink 等既有 API 保持不变。
 */
import type {
  PanelOpen,
  PetActionDecision,
  PetActionRequest,
  PetChatEvent,
  PetDragPoint,
  PetInteraction,
  PetProfile,
  PetRuntimeSnapshot,
  PetSocialEvent,
  PetVisualCommand,
} from '@pet/protocol';
import { contextBridge, ipcRenderer } from 'electron';

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
    setPassThrough: (enabled: boolean) => ipcRenderer.send('pet:set-pass-through', { enabled }),
    showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
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
  },
} as const;

contextBridge.exposeInMainWorld('pet', api);

export type PetApi = typeof api;
