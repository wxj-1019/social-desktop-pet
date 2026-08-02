/**
 * Panel 消息投递 —— C1 修复核心：深链 payload / 面板导航投递到 panel 渲染进程。
 *
 * 时序竞态（C1 审查）：面板首次懒创建时渲染进程尚未挂载 IPC 订阅，
 * 立即 webContents.send 会丢消息。规则：
 * - webContents 仍加载中（isLoading()）→ 等一次 did-finish-load 再发；
 * - 已加载 → 立即发。
 * panel:navigate 与可选的 deeplink:payload 一并投递（保持顺序）。
 */
import type { PanelOpen } from '@pet/protocol';

/** 最小 webContents 契约（单测注入 fake；生产即 Electron WebContents） */
export interface PanelMessageTarget {
  webContents: {
    isLoading(): boolean;
    once(event: 'did-finish-load', listener: () => void): void;
    send(channel: string, payload: unknown): void;
  };
}

export function deliverPanelMessage(
  handle: PanelMessageTarget,
  view: PanelOpen['view'],
  deeplinkPayload?: string,
): void {
  const wc = handle.webContents;
  const send = (): void => {
    wc.send('panel:navigate', { view } satisfies PanelOpen);
    if (deeplinkPayload !== undefined) wc.send('deeplink:payload', deeplinkPayload);
  };
  if (wc.isLoading()) {
    wc.once('did-finish-load', send);
  } else {
    send();
  }
}
