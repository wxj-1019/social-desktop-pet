/**
 * Electron 安全基线 —— 对应设计稿 8.3。
 * nodeIntegration:false / contextIsolation:true / sandbox / 严格 CSP / IPC allowlist。
 */
export const SECURE_WEB_PREFS = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  // 严格 CSP（主 Renderer 只加载本地打包资源）
  additionalArguments: [] as string[],
};

/** 仅允许加载本地资源与同源内容 */
export const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  // 自建后端（D-13）：本机回环 API + WS（生产指向 HTTPS 域名时收紧为具体源）
  "connect-src 'self' https: wss: http://127.0.0.1:8787 ws://127.0.0.1:8787; " +
  "font-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self';";

/** 8.3 IPC allowlist：preload 只暴露最小、版本化 API */
export const IPC_ALLOWLIST = [
  'app:version',
  'app:getApiBase',
  'session:init',
  'session:login',
  'session:register',
  'session:refresh',
  'session:revoke',
  'window:setIgnoreMouseEvents', // 8.1 整窗穿透
  'window:minimize',
  'window:hide',
  'tray:toggle',
  'deeplink:payload',
  'storage:get',
  'storage:set',
] as const;
