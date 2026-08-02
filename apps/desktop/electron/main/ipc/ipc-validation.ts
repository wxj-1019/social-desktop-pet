/**
 * IPC 校验 —— 8.3 的 sender 身份与 payload 输入校验（纯逻辑，可单测）。
 *
 * validateIpcSender：主 frame + 期望窗口 + 受信任渲染 URL（生产 file renderer 或
 * dev ELECTRON_RENDERER_URL origin）+ surface 匹配，全部通过才放行；subframe /
 * 窗口不匹配 / 非渲染入口 URL / surface 不符一律拒绝。
 * parseIpcPayload：跨进程 payload 全部经 @pet/protocol zod schema 校验，
 * 失败抛稳定错误（IpcPayloadError）。
 */
import { BrowserWindow } from 'electron';
import type { WebContents, WebFrameMain } from 'electron';
import type { ZodType } from 'zod';

/** 渲染表面：桌宠窗 / 面板窗 */
export type IpcSurface = 'pet' | 'panel';

/** validateIpcSender 所需的最小 event 形态（IpcMainEvent / IpcMainInvokeEvent 均满足） */
export interface IpcSenderEvent {
  sender: WebContents;
  senderFrame: WebFrameMain | null;
}

/** sender 校验失败（稳定错误） */
export class IpcSenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcSenderError';
  }
}

/** payload schema 校验失败（稳定错误） */
export class IpcPayloadError extends TypeError {
  constructor(message = 'IPC payload 校验失败') {
    super(message);
    this.name = 'IpcPayloadError';
  }
}

/** 生产渲染入口文件名（pathname 以 /renderer/index.html 结尾） */
const PROD_RENDERER_PATH = '/renderer/index.html';

/** 渲染入口 URL 校验：生产 file:（pathname 以 /renderer/index.html 结尾）或 dev origin */
export function isRendererUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const isProd = url.protocol === 'file:' && url.pathname.endsWith(PROD_RENDERER_PATH);
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const isDev =
    rendererUrl !== undefined && rendererUrl !== '' && url.origin === new URL(rendererUrl).origin;
  return isProd || isDev;
}

/**
 * 校验 IPC 发送者身份并返回对应 BrowserWindow。
 * 通过条件：主 frame 且来自期望窗口、URL 是受信任渲染入口、surface 与通道一致。
 */
export function validateIpcSender(
  event: IpcSenderEvent,
  expectedWindow: BrowserWindow | null,
  surface: IpcSurface,
): BrowserWindow {
  // 1. 仅主 frame（subframe iframe 一律拒绝）
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) {
    throw new IpcSenderError('IPC 仅允许主 frame 调用');
  }
  // 2. 窗口身份必须与期望窗口一致
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== expectedWindow) {
    throw new IpcSenderError('IPC 发送窗口不匹配');
  }
  // 3. URL 必须是受信任的渲染入口
  if (!isRendererUrl(frame.url)) {
    throw new IpcSenderError('IPC 发送 URL 不在允许范围');
  }
  // 4. surface 必须与通道一致（?surface=pet|panel）
  let url: URL;
  try {
    url = new URL(frame.url);
  } catch {
    throw new IpcSenderError('IPC 发送 URL 非法');
  }
  if (url.searchParams.get('surface') !== surface) {
    throw new IpcSenderError('IPC 发送 surface 不匹配');
  }
  return win;
}

/** 跨进程 payload schema 校验；失败抛稳定错误 */
export function parseIpcPayload<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new IpcPayloadError();
  }
  return parsed.data;
}
