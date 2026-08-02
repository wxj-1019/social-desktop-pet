/**
 * panel-delivery 单测 —— C1 修复的时序竞态核心：
 * 面板首次懒创建时渲染进程尚未订阅 IPC，立即 send 会丢消息；
 * 规则：isLoading() → 等一次 did-finish-load 再发；已加载 → 立即发。
 */
import { describe, expect, it, vi } from 'vitest';

import { deliverPanelMessage, type PanelMessageTarget } from './panel-delivery.js';

function makeTarget(): {
  target: PanelMessageTarget;
  wc: {
    isLoading: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
} {
  const wc = {
    isLoading: vi.fn().mockReturnValue(false),
    once: vi.fn(),
    send: vi.fn(),
  };
  return { target: { webContents: wc }, wc };
}

function didFinishLoadCall(wc: { once: ReturnType<typeof vi.fn> }): () => void {
  const call = wc.once.mock.calls.find(([event]) => event === 'did-finish-load');
  expect(call, '应监听一次 did-finish-load').toBeTruthy();
  return call![1] as () => void;
}

describe('deliverPanelMessage（panel 消息投递 + 加载竞态）', () => {
  it('panel 已加载：立即发送 panel:navigate 与 deeplink:payload', () => {
    const { target, wc } = makeTarget();
    deliverPanelMessage(target, 'friends', 'raw-token-abc');
    expect(wc.once).not.toHaveBeenCalled();
    expect(wc.send).toHaveBeenCalledTimes(2);
    expect(wc.send).toHaveBeenNthCalledWith(1, 'panel:navigate', { view: 'friends' });
    expect(wc.send).toHaveBeenNthCalledWith(2, 'deeplink:payload', 'raw-token-abc');
  });

  it('panel 加载中：不立即发送，did-finish-load 后再补发两者', () => {
    const { target, wc } = makeTarget();
    wc.isLoading.mockReturnValue(true);
    deliverPanelMessage(target, 'login', 'NEED_SIGN_IN');
    expect(wc.send).not.toHaveBeenCalled();

    const fire = didFinishLoadCall(wc);
    fire();
    expect(wc.send).toHaveBeenCalledTimes(2);
    expect(wc.send).toHaveBeenNthCalledWith(1, 'panel:navigate', { view: 'login' });
    expect(wc.send).toHaveBeenNthCalledWith(2, 'deeplink:payload', 'NEED_SIGN_IN');
  });

  it('无深链 payload 时只投递 panel:navigate（立即 / 加载后两种）', () => {
    const loaded = makeTarget();
    deliverPanelMessage(loaded.target, 'chat');
    expect(loaded.wc.send).toHaveBeenCalledTimes(1);
    expect(loaded.wc.send).toHaveBeenCalledWith('panel:navigate', { view: 'chat' });

    const loading = makeTarget();
    loading.wc.isLoading.mockReturnValue(true);
    deliverPanelMessage(loading.target, 'chat');
    expect(loading.wc.send).not.toHaveBeenCalled();
    didFinishLoadCall(loading.wc)();
    expect(loading.wc.send).toHaveBeenCalledTimes(1);
    expect(loading.wc.send).toHaveBeenCalledWith('panel:navigate', { view: 'chat' });
  });
});
