// @vitest-environment jsdom
import type { PetRuntimeSnapshot } from '@pet/protocol';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('usePetRuntime · 窗口重建状态恢复', () => {
  it('hydrates the initial visual motion and expression from the runtime snapshot', async () => {
    installRuntimeSnapshot({ state: 'SLEEPING', online: true, dnd: false, hidden: false });
    const { result } = renderHook(() => usePetRuntime());

    await waitFor(() => expect(result.current.snapshot?.state).toBe('SLEEPING'));
    expect(result.current.visualState.motion).toBe('sleep');
    expect(result.current.visualState.expression).toBe('neutral');
  });
});
