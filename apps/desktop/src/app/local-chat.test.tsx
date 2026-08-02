/**
 * LocalChat（本地模式聊天）—— Task 11：本地回复 → chatEvent start/done 联动。
 * 不再在 renderer 模拟 CHATTING（Main petRuntime 处理），window.pet 缺失可降级。
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
