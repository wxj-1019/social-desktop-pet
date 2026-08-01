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
  /** 6.3 Deep Link payload（登录后恢复邀请流程） */
  onDeepLink: (cb: (payload: string) => void) =>
    ipcRenderer.on('deeplink:payload', (_e, payload: string) => cb(payload)),
} as const;

contextBridge.exposeInMainWorld('pet', api);

export type PetApi = typeof api;
