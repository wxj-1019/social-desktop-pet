// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PetRuntimeSnapshot } from '@pet/protocol';

import { usePetRuntime } from './use-pet-runtime.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'pet');
});

function installRuntimeSnapshot(snapshot: PetRuntimeSnapshot): void {
  Object.defineProperty(window, 'pet', {
    configurable: true,
    value: {
      petRuntime: {
        getSnapshot: vi.fn(async () => snapshot),
        onSnapshot: vi.fn(() => vi.fn()),
        onVisualCommand: vi.fn(() => vi.fn()),
      },
      petProfile: {
        get: vi.fn(async () => ({
          version: 1,
          petId: 'star-isle',
          displayName: '星屿',
          reducedMotion: false,
          dnd: false,
          bubbleEnabled: true,
        })),
      },
    },
  });
}

describe('usePetRuntime · 气泡自动消失（7.4 短驻留）', () => {
  it('气泡文本在 5s 无更新后自动清除', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePetRuntime());

    act(() => result.current.applyCommand({ type: 'bubble', text: '你好呀' }));
    expect(result.current.bubbleText).toBe('你好呀');

    act(() => vi.advanceTimersByTime(4999));
    expect(result.current.bubbleText).toBe('你好呀');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.bubbleText).toBeNull();
  });

  it('新气泡刷新计时；text:null 立即清除且不再复活', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePetRuntime());

    act(() => result.current.applyCommand({ type: 'bubble', text: '第一句' }));
    act(() => vi.advanceTimersByTime(4000));
    act(() => result.current.applyCommand({ type: 'bubble', text: '第二句' }));
    act(() => vi.advanceTimersByTime(4000));
    // 第一句的计时已被第二句刷新，不应被清除
    expect(result.current.bubbleText).toBe('第二句');

    act(() => result.current.applyCommand({ type: 'bubble', text: null }));
    expect(result.current.bubbleText).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.bubbleText).toBeNull();
  });
});

describe('usePetRuntime · 首日引导气泡（操作引导 + 价值钩子）', () => {
  it('按序播放 5 条提示并只标记一次 onboarded', async () => {
    vi.useFakeTimers();
    localStorage.removeItem('pet:onboarded');
    installRuntimeSnapshot({
      state: 'IDLE',
      online: true,
      dnd: false,
      hidden: false,
      passThrough: false,
    });
    const { result } = renderHook(() => usePetRuntime());

    // 让 petProfile.get 的微任务链落地（挂起引导气泡定时器）
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.profile).not.toBeNull();
    expect(localStorage.getItem('pet:onboarded')).toBe('1');

    const hints = [
      '你好呀，我是星屿！可以摸摸我的头～',
      '拖我可以移动，右键有菜单哦',
      '双击我可以打开聊天面板',
      '和我聊聊吧，你告诉我的小事我都会记住',
      '登录后我还能去你好友的电脑串门，带着我们的记忆',
    ];
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.bubbleText).toBe(hints[0]);
    for (const hint of hints.slice(1)) {
      act(() => vi.advanceTimersByTime(2_500));
      expect(result.current.bubbleText).toBe(hint);
    }
  });

  it('已 onboarded 的存量用户不再重复播放引导', async () => {
    vi.useFakeTimers();
    localStorage.setItem('pet:onboarded', '1');
    installRuntimeSnapshot({
      state: 'IDLE',
      online: true,
      dnd: false,
      hidden: false,
      passThrough: false,
    });
    const { result } = renderHook(() => usePetRuntime());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.profile).not.toBeNull();
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.bubbleText).toBeNull();
  });
});

describe('usePetRuntime · 窗口重建状态恢复', () => {
  it('hydrates the initial visual motion and expression from the runtime snapshot', async () => {
    installRuntimeSnapshot({
      state: 'SLEEPING',
      online: true,
      dnd: false,
      hidden: false,
      passThrough: false,
    });
    const { result } = renderHook(() => usePetRuntime());

    await waitFor(() => expect(result.current.snapshot?.state).toBe('SLEEPING'));
    expect(result.current.visualState.motion).toBe('sleep');
    expect(result.current.visualState.expression).toBe('neutral');
  });
});
