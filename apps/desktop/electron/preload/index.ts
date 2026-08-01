/**
 * Preload —— 8.3 只暴露最小、版本化的 API。
 * contextBridge 隔离，不把 require/Node 能力暴露给渲染进程。
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  version: '0.0.0',
  platform: process.platform,
  /** 8.4 整窗穿透切换 */
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.send('window:setIgnoreMouseEvents', ignore),
  minimize: () => ipcRenderer.send('window:minimize'),
  hide: () => ipcRenderer.send('window:hide'),
  /** 6.3 Deep Link payload（登录后恢复邀请流程）；返回取消订阅函数 */
  onDeepLink: (cb: (payload: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: string) => cb(payload);
    ipcRenderer.on('deeplink:payload', listener);
    return () => ipcRenderer.removeListener('deeplink:payload', listener);
  },
  /** 自建后端地址（D-13）：API client 基址 */
  getApiBase: () => ipcRenderer.invoke('app:getApiBase') as Promise<string>,
  /** 9.8 会话：启动恢复 / 登录 / 注册 / 刷新 / 登出（refresh token 留在主进程 safeStorage） */
  session: {
    init: () => ipcRenderer.invoke('session:init') as Promise<unknown>,
    login: (payload: { email: string; password: string; deviceId: string }) =>
      ipcRenderer.invoke('session:login', payload) as Promise<unknown>,
    register: (payload: { email: string; password: string; deviceId: string; nickname: string }) =>
      ipcRenderer.invoke('session:register', payload) as Promise<unknown>,
    refresh: () => ipcRenderer.invoke('session:refresh') as Promise<unknown>,
    revoke: () => ipcRenderer.invoke('session:revoke') as Promise<unknown>,
  },
  /** PoC 专用：读取多屏信息（第 1–2 周窗口能力 PoC；第 3 周由 DisplayController 正式接入） */
  getDisplays: () => ipcRenderer.invoke('poc:getDisplays') as Promise<unknown>,
} as const;

contextBridge.exposeInMainWorld('pet', api);

export type PetApi = typeof api;
