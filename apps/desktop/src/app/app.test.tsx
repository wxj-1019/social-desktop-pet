/**
 * AppPanel 单测 —— I1 修复：订阅 panel.onNavigate 映射 view → phase/tab。
 * - 'login' → signed_out phase（登录页）
 * - 'chat' / 'friends' → 已登录时切换 tab
 * - 卸载时取消订阅
 * 深链 NEED_SIGN_IN 横幅（既有 onDeepLink 消费）保持可用。
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PanelOpen } from '@pet/protocol';

import { api } from '../lib/api/client.js';

import { AppPanel } from './app.js';

const ACTIVE_PROFILE = {
  phase: 'ACTIVE',
  accessToken: 'tok-1',
  profile: { userId: 'u1', nickname: 'Alice', deviceId: 'dev-1' },
};
const SIGNED_OUT_RESULT = { phase: 'SIGNED_OUT', accessToken: null, profile: null };

function installFakePet(initResult: unknown): {
  navigate: (view: PanelOpen['view']) => void;
  onNavigateOff: ReturnType<typeof vi.fn>;
} {
  let onNavigateCb: ((nav: PanelOpen) => void) | null = null;
  const onNavigateOff = vi.fn();
  (window as unknown as { pet: unknown }).pet = {
    getApiBase: vi.fn().mockResolvedValue('http://127.0.0.1:8787'),
    session: {
      init: vi.fn().mockResolvedValue(initResult),
      login: vi.fn(),
      register: vi.fn(),
      refresh: vi.fn(),
      revoke: vi.fn(),
    },
    onDeepLink: vi.fn(() => vi.fn()),
    consumeDeepLinkPayload: vi.fn().mockResolvedValue(null),
    petProfile: {
      get: vi.fn().mockResolvedValue({
        version: 1,
        petId: 'star-isle',
        displayName: '星屿',
        reducedMotion: false,
        dnd: false,
        bubbleEnabled: true,
      }),
      set: vi.fn((p: unknown) => Promise.resolve(p)),
      onChanged: vi.fn(() => vi.fn()),
    },
    getPetScale: vi.fn().mockResolvedValue(1),
    localLlm: {
      getView: vi
        .fn()
        .mockResolvedValue({ enabled: false, baseUrl: '', model: '', hasApiKey: false }),
      save: vi.fn(),
      chat: vi.fn(),
    },
    panel: {
      open: vi.fn(),
      close: vi.fn(),
      navigate: vi.fn(),
      onNavigate: vi.fn((cb: (nav: PanelOpen) => void) => {
        onNavigateCb = cb;
        return onNavigateOff;
      }),
      consumePendingView: vi.fn().mockResolvedValue(null),
    },
  };
  return {
    navigate: (view) => onNavigateCb?.({ view }),
    onNavigateOff,
  };
}

beforeEach(() => {
  vi.spyOn(api, 'friends').mockResolvedValue([]);
  vi.spyOn(api, 'sync').mockResolvedValue({ events: [], nextInboxSeq: 0, hasMore: false });
  vi.spyOn(api, 'chatHistory').mockResolvedValue([]);
  vi.spyOn(api, 'memories').mockResolvedValue([]);
  vi.spyOn(api, 'memorySummary').mockResolvedValue({ pending: [], recentlySaved: [] });
  // jsdom 未实现元素滚动 API（ChatPanel 挂载时调用）
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  // jsdom 无 WebSocket → 透出 Node undici 真实连接（连到本机后端报跨 realm 错）；
  // 好友页 RealtimeClient 用 stub 连接类替代（不建立真实连接）
  vi.stubGlobal(
    'WebSocket',
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 0;
      onopen: unknown = null;
      onmessage: unknown = null;
      onclose: unknown = null;
      onerror: unknown = null;
      send(): void {}
      close(): void {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as { pet?: unknown }).pet;
});

describe('AppPanel · panel.onNavigate 消费（I1）', () => {
  it('已登录：panel:navigate chat → 切到聊天 tab；navigate friends → 回到好友页', async () => {
    const fake = installFakePet(ACTIVE_PROFILE);
    render(<AppPanel />);
    await act(async () => {}); // 冲刷 session.init

    // 默认好友 tab
    expect(await screen.findByRole('button', { name: '邀请好友' })).not.toBeNull();

    act(() => fake.navigate('chat'));
    expect(screen.getByPlaceholderText(/说点什么/)).not.toBeNull();

    act(() => fake.navigate('friends'));
    expect(screen.getByRole('button', { name: '邀请好友' })).not.toBeNull();
  });

  it('panel:navigate login → signed_out（登录页）', async () => {
    const fake = installFakePet(ACTIVE_PROFILE);
    render(<AppPanel />);
    await act(async () => {});
    await screen.findByRole('button', { name: '邀请好友' });

    act(() => fake.navigate('login'));
    expect(screen.getByRole('heading', { name: '欢迎回来' })).not.toBeNull();
    expect(document.querySelector('.app-tabs')).toBeNull();
    expect(document.querySelector('.login-page')).not.toBeNull();
  });

  it('未登录：panel:navigate 切入本地模式并定位 tab（不再静默丢弃）', async () => {
    const fake = installFakePet(SIGNED_OUT_RESULT);
    render(<AppPanel />);
    await act(async () => {});
    expect(document.querySelector('.login-page')).not.toBeNull();

    // chat → 本地模式聊天页
    act(() => fake.navigate('chat'));
    expect(document.querySelector('.login-page')).toBeNull();
    expect(screen.getByPlaceholderText(/说点什么/)).not.toBeNull();

    // friends → 云端功能登录引导（有明确出口而非静默）
    act(() => fake.navigate('friends'));
    expect(screen.getByRole('heading', { name: /好友需要登录后使用/ })).not.toBeNull();

    // settings → 本地模式设置页可达（等待 profile 读取后渲染）
    act(() => fake.navigate('settings'));
    expect(await screen.findByRole('heading', { name: '设置' })).not.toBeNull();

    // model → 本地模式模型页可达（BYOK 输入框同屏可见）
    act(() => fake.navigate('model'));
    expect(await screen.findByRole('heading', { name: '模型' })).not.toBeNull();
    expect(screen.getByLabelText('本地模型 API Key')).not.toBeNull();
  });

  it('卸载时取消 onNavigate 订阅', async () => {
    const fake = installFakePet(ACTIVE_PROFILE);
    const view = render(<AppPanel />);
    await act(async () => {});

    view.unmount();
    expect(fake.onNavigateOff).toHaveBeenCalledTimes(1);
  });

  it('第四个 tab「记忆」：点击渲染记忆中心（11.3 入口）', async () => {
    installFakePet(ACTIVE_PROFILE);
    render(<AppPanel />);
    await act(async () => {});
    await screen.findByRole('button', { name: '邀请好友' });

    fireEvent.click(screen.getByRole('tab', { name: '记忆' }));
    expect(await screen.findByText(/星屿记住的0件小事/)).not.toBeNull();
    expect(api.memories).toHaveBeenCalled();
  });

  it('角色 tab：渲染角色选择页并可返回（回归：onBack 引用未定义变量曾致整页崩溃）', async () => {
    installFakePet(ACTIVE_PROFILE);
    render(<AppPanel />);
    await act(async () => {});
    await screen.findByRole('button', { name: '邀请好友' });

    fireEvent.click(screen.getByRole('tab', { name: '角色' }));
    expect(await screen.findByTestId('character-select')).not.toBeNull();
    expect(screen.getByRole('radio', { name: /星屿/ })).not.toBeNull();
    expect(screen.getByRole('radio', { name: /CodeNoNo/ })).not.toBeNull();
    expect(screen.getByRole('radio', { name: /奶盖/ })).not.toBeNull();

    // 返回按钮回好友页（修复前 onClick={onBack} 渲染时引用未定义变量 → ReferenceError → 整页卸载）
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('button', { name: '邀请好友' })).not.toBeNull();
  });
});
