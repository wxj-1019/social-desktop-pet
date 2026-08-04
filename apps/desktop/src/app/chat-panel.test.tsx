/**
 * ChatPanel（云端聊天）—— Task 11：SSE done 完整 ModelOutput + chatEvent 联动。
 * - start/done chatEvent 序列（source: cloud_ai）
 * - onToken 100ms 节流发 update chatEvent
 * - 云失败/异常 → 本地兜底（source: local_chat）+ 非阻塞提示
 * - window.pet 缺失（纯 web）→ 聊天仍可用
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api/client.js';

import { ChatPanel } from './chat-panel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.spyOn(api, 'chatHistory').mockResolvedValue([]);
  // jsdom 未实现元素滚动 API
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});

function installFakePet(): ReturnType<typeof vi.fn> {
  const chatEvent = vi.fn();
  (window as unknown as { pet: unknown }).pet = {
    petRuntime: { chatEvent },
  };
  return chatEvent;
}

/** 输入文本 → 等历史加载 → 点发送 → 冲掉 send 内微任务 */
async function typeAndSend(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(/说点什么/), { target: { value: text } });
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await act(async () => {});
}

describe('ChatPanel（云端聊天 → chatEvent 联动）', () => {
  it('发送后按序发出 start / done chatEvent，气泡显示完整 ModelOutput.dialogue', async () => {
    const chatEvent = installFakePet();
    vi.spyOn(api, 'chatStream').mockImplementation(async (_msg, handlers) => {
      handlers.onToken('你');
      handlers.onToken('好');
      handlers.onDone({ dialogue: '你好呀！', emotion: 'warm', actionIntent: 'nod', intensity: 3 });
    });

    render(<ChatPanel />);
    await typeAndSend('你好');

    expect(chatEvent).toHaveBeenCalledWith({ phase: 'start', source: 'cloud_ai', text: '你好' });
    expect(chatEvent).toHaveBeenCalledWith({
      phase: 'done',
      source: 'cloud_ai',
      output: { dialogue: '你好呀！', emotion: 'warm', actionIntent: 'nod', intensity: 3 },
    });
    expect(screen.getByText('你好呀！')).not.toBeNull();
  });

  it('onToken 每 100ms 节流发 update chatEvent（累计文本 .slice(-160)）', async () => {
    const chatEvent = installFakePet();
    vi.useFakeTimers();
    vi.spyOn(api, 'chatStream').mockImplementation(async (_msg, handlers) => {
      handlers.onToken('你');
      handlers.onToken('好'); // 100ms 内第二次 token → 跳过
      vi.advanceTimersByTime(100);
      handlers.onToken('呀');
      handlers.onDone({ dialogue: '你好呀！', emotion: 'warm', actionIntent: 'nod', intensity: 3 });
    });

    render(<ChatPanel />);
    await typeAndSend('你好');

    const updates = chatEvent.mock.calls.filter(
      (args) => (args[0] as { phase: string }).phase === 'update',
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[0]).toEqual([{ phase: 'update', source: 'cloud_ai', text: '你' }]);
    expect(updates[updates.length - 1]).toEqual([
      { phase: 'update', source: 'cloud_ai', text: '你好呀' },
    ]);
  });

  it('云 onError → 本地兜底 done 事件 + 非阻塞提示，气泡显示本地回复', async () => {
    const chatEvent = installFakePet();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(api, 'chatStream').mockImplementation(async (_msg, handlers) => {
      handlers.onError?.('上游超时');
    });

    render(<ChatPanel />);
    await typeAndSend('你好');

    expect(chatEvent).toHaveBeenCalledWith({ phase: 'start', source: 'cloud_ai', text: '你好' });
    expect(chatEvent).toHaveBeenCalledWith({
      phase: 'done',
      source: 'local_chat',
      output: {
        dialogue: '你好呀！今天过得怎么样？',
        emotion: 'warm',
        actionIntent: 'nod',
        intensity: 1,
      },
    });
    // 不递归重试云：done 事件只来自 local_chat
    const doneEvents = chatEvent.mock.calls.filter(
      (args) => (args[0] as { phase: string }).phase === 'done',
    );
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]?.[0]).toMatchObject({ source: 'local_chat' });
    expect(screen.getByText('云端暂不可用，已切换本地回应')).not.toBeNull();
    expect(screen.getByText('你好呀！今天过得怎么样？')).not.toBeNull();
  });

  it('chatStream 抛异常（网络断开）→ 同样本地兜底', async () => {
    const chatEvent = installFakePet();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(api, 'chatStream').mockRejectedValue(new Error('网络断开'));

    render(<ChatPanel />);
    await typeAndSend('你好');

    expect(chatEvent).toHaveBeenCalledWith({
      phase: 'done',
      source: 'local_chat',
      output: {
        dialogue: '你好呀！今天过得怎么样？',
        emotion: 'warm',
        actionIntent: 'nod',
        intensity: 1,
      },
    });
    expect(screen.getByText('云端暂不可用，已切换本地回应')).not.toBeNull();
  });

  it('流式回复期间头部头像进入说话态，完成后恢复', async () => {
    installFakePet();
    let releaseStream!: () => void;
    vi.spyOn(api, 'chatStream').mockImplementation(async (_msg, handlers) => {
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });
      handlers.onDone({ dialogue: '答完了', emotion: 'warm', actionIntent: 'nod', intensity: 1 });
    });

    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/说点什么/), { target: { value: '你好' } });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await act(async () => {});

    const avatar = document.querySelector('.character-presence__avatar .star-isle');
    expect(avatar?.getAttribute('data-speaking')).toBe('true');

    releaseStream();
    await act(async () => {});
    expect(avatar?.getAttribute('data-speaking')).toBe('false');
  });

  it('window.pet 缺失（纯 web）→ 跳过 chatEvent，聊天仍可用', async () => {
    delete (window as unknown as { pet?: unknown }).pet;
    vi.spyOn(api, 'chatStream').mockImplementation(async (_msg, handlers) => {
      handlers.onDone({
        dialogue: '没有 Electron 也能聊',
        emotion: 'warm',
        actionIntent: 'nod',
        intensity: 2,
      });
    });

    render(<ChatPanel />);
    await typeAndSend('你好');

    expect(screen.getByText('没有 Electron 也能聊')).not.toBeNull();
  });

  it('流式中点击"停止回复"→ onAbort（不本地兜底、不弹错误），按钮恢复发送', async () => {
    installFakePet();
    vi.spyOn(api, 'chatStream').mockImplementation(async (_msg, handlers, _threadId, signal) => {
      // 模拟真实流式：挂起直到外部 signal 中止 → onAbort
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => {
          handlers.onAbort?.();
          resolve();
        });
      });
    });

    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText(/说点什么/), { target: { value: '你好' } });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await act(async () => {});

    // 流式中：发送按钮变为停止按钮
    const stop = screen.getByRole('button', { name: '停止回复' });
    expect(stop).not.toBeNull();
    fireEvent.click(stop);
    await act(async () => {});

    // 停止后：无本地兜底（无 fallback done 事件、无错误提示），按钮恢复发送
    expect(screen.queryByText('云端暂不可用，已切换本地回应')).toBeNull();
    expect(screen.getByRole('button', { name: '发送' })).not.toBeNull();
    expect(screen.getByRole('textbox', { name: '给星屿发消息' })).not.toBeNull();
  });

  it('多行输入：Enter 发送、Shift+Enter 换行不发送', async () => {
    installFakePet();
    vi.spyOn(api, 'chatStream').mockImplementation(async (_msg, handlers) => {
      handlers.onDone({ dialogue: '收到', emotion: 'warm', actionIntent: 'nod', intensity: 1 });
    });

    render(<ChatPanel />);
    const input = screen.getByRole('textbox', { name: '给星屿发消息' }) as HTMLTextAreaElement;

    // Shift+Enter：不发送，文本保留换行
    fireEvent.change(input, { target: { value: '第一行' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await act(async () => {});
    expect(screen.getByRole('button', { name: '发送' })).not.toBeNull();
    expect(input.value).toBe('第一行');

    // Enter：发送并清空输入
    fireEvent.change(input, { target: { value: '第二行' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {});
    expect(input.value).toBe('');
  });
});
