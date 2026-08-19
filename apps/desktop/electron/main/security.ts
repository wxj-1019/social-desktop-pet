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
  // 自建后端（D-13）：本机回环 API + WS（生产 HTTPS 域名由 buildCsp 的
  // 网络层策略按 PET_API_BASE 动态收紧；此处 https: 为 meta 兜底通配）
  "connect-src 'self' https: http://127.0.0.1:8787 ws://127.0.0.1:8787; " +
  "font-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self';";

/**
 * 网络层 CSP（8.3 双保险：meta + 响应头策略取交集生效）。
 * connect-src 按 PET_API_BASE 动态生成精确源（不再放开任意 https/wss 主机）：
 *   本机 → 'self' http://127.0.0.1:8787 ws://127.0.0.1:8787
 *   生产 → 'self' https://api.example.com wss://api.example.com
 */
export function buildCsp(apiBase: string): string {
  const wsBase = apiBase.replace(/^http/, 'ws');
  const connectSrc = `'self' ${apiBase} ${wsBase}`;
  return (
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    `connect-src ${connectSrc}; ` +
    "font-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self';"
  );
}

/**
 * 8.3 IPC allowlist：preload 只暴露最小、版本化 API。
 * 原则：allowlist == 实际注册的通道（含 main→renderer 推送通道 pet:runtime:snapshot /
 * pet:visual-command / deeplink:payload）；未实现通道（tray:toggle / storage:*）不入列。
 */
export const IPC_ALLOWLIST = [
  'app:version',
  'app:getApiBase',
  'app:get-auto-launch', // 8.2 开机自启查询（设置页）
  'app:set-auto-launch', // 8.2 开机自启开关（设置页）
  'session:init',
  'session:login',
  'session:register',
  'session:refresh',
  'session:revoke',
  'window:setIgnoreMouseEvents', // 8.1 整窗穿透
  'window:minimize',
  'window:hide',
  'deeplink:payload', // main→renderer 推送（6.3 Deep Link）
  'deeplink:consume-pending', // 面板挂载后拉取深链 payload（C1 时序兜底）
  'poc:getDisplays', // PoC 专用：多屏信息（第 3 周由 DisplayController 正式接入）
  'pet:runtime:get', // 运行时快照（invoke）
  'pet:runtime:snapshot', // main→pet 推送
  'pet:visual-command', // main→pet 推送
  'pet:interaction', // 桌面触摸/点击交互
  'pet:request-action', // 动作请求（状态机审批）
  'pet:chat-event', // 聊天事件
  'pet:social-event', // 社交事件（好友送礼等）
  'pet:drag-start', // 拖动会话（8.5）
  'pet:drag-move',
  'pet:drag-end',
  'pet:set-dnd', // 勿扰开关
  'pet:set-online', // 在线状态上报（面板 WS 连接状态 → 运行时 OFFLINE/ONLINE）
  'pet:set-size', // 桌宠大小调节（设置页滑块）
  'pet:get-size', // 桌宠大小查询（设置页初始值）
  'pet:set-menu-canvas', // 环形菜单画布（菜单展开临时扩窗 ≥240×260 基准，右下锚定）
  'pet:set-pass-through', // 整窗穿透
  'pet:set-hidden', // 隐藏/显示桌宠（SAO 菜单）
  'pet:profile-changed', // main→pet 推送（设置页写档案后广播，气泡/减弱动态实时生效）
  'pet:show-context-menu', // 桌宠右键菜单
  'pet:show-bubble', // 面板 → 桌宠气泡（记忆"已记住"等提示）
  'panel:open', // 面板打开（8.2）
  'panel:close',
  'panel:navigate', // 面板内导航
  'pet-profile:get',
  'pet-profile:set',
  'pet:set-character', // 切换角色皮肤（保存 profile + 重载桌宠窗）
  'local-llm:get', // 本地 BYOK 模型配置视图（无密钥）
  'local-llm:set', // 保存本地模型配置（密钥 Main 侧加密落盘）
  'local-llm:chat', // 本地模式聊天 → OpenAI 兼容端点（Main 侧发起）
] as const;
