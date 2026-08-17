/**
 * LocalChat（本地模式聊天）—— Task 11：本地回复 → chatEvent start/done 联动。
 * 不再在 renderer 模拟 CHATTING（Main petRuntime 处理），window.pet 缺失可降级。
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalChat } from './local-chat.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  // jsdom 未实现元素滚动 API
  Element.prototype.scrollIntoView = vi.fn();
});

function installFakePet(): ReturnType<typeof vi.fn> {
  const chatEvent = vi.fn();
  (window as unknown as { pet: unknown }).pet = {
    petRuntime: { chatEvent },
  };
  return chatEvent;
}

function installFakeLlmPet(reply: string): {
  chatEvent: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
} {
  const chatEvent = vi.fn();
  const chat = vi.fn(async () => ({ reply }));
  (window as unknown as { pet: unknown }).pet = {
    petRuntime: { chatEvent },
    localLlm: {
      getView: vi.fn(async () => ({
        enabled: true,
        baseUrl: 'https://llm.example.com/v1',
        model: 'test-model',
        hasApiKey: true,
      })),
      chat,
    },
  };
  return { chatEvent, chat };
}

describe('LocalChat（本地聊天 → chatEvent 联动）', () => {
  it('发送后发出 start/done chatEvent（source: local_chat）并渲染本地回复', () => {
    const chatEvent = installFakePet();
    render(<LocalChat onLoginClick={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/说点什么/), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(chatEvent).toHaveBeenCalledWith({ phase: 'start', source: 'local_chat', text: '你好' });
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
    expect(screen.getByText('你好呀！今天过得怎么样？')).not.toBeNull();
  });

  it('window.pet 缺失（纯 web）→ 跳过 chatEvent，聊天仍可用', () => {
    delete (window as unknown as { pet?: unknown }).pet;
    render(<LocalChat onLoginClick={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/说点什么/), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(screen.getByText('你好呀！今天过得怎么样？')).not.toBeNull();
  });

  it('配置了本地模型 → 走 LLM 回复（带 system 提示与历史），失败回退规则引擎', async () => {
    const { chatEvent, chat } = installFakeLlmPet('LLM 的温暖回复');
    render(<LocalChat onLoginClick={vi.fn()} />);
    // 等配置视图加载完成（getView 异步），确保走 LLM 分支
    await act(async () => {});

    fireEvent.change(screen.getByPlaceholderText(/说点什么/), { target: { value: '今天好累' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('LLM 的温暖回复')).not.toBeNull();
    expect(chat).toHaveBeenCalledTimes(1);
    const payload = chat.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.messages[0]!.role).toBe('system');
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: '今天好累' });
    expect(chatEvent).toHaveBeenCalledWith({
      phase: 'done',
      source: 'local_chat',
      output: expect.objectContaining({ dialogue: 'LLM 的温暖回复' }),
    });

    // LLM 报错 → 回退规则引擎回复
    chat.mockResolvedValueOnce({ error: 'network_error' });
    fireEvent.change(screen.getByPlaceholderText(/说点什么/), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('你好呀！今天过得怎么样？')).not.toBeNull();
  });
});
