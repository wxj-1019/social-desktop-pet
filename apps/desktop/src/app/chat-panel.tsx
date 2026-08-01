/**
 * 聊天面板（云端）—— 10.1 chat-flow SSE 流式对话。
 * 登录后可用；本地模式走 local-chat（规则引擎）。
 * 联动：对话期间桌宠进入 CHATTING（口型动作），结束回 IDLE（7.1 状态机）。
 */
import { useState } from 'react';

import { api } from '../lib/api/client.js';
import type { PetStateController } from '../pet/use-pet-state-machine.js';

interface ChatEntry {
  role: 'user' | 'pet';
  text: string;
}

interface ChatPanelProps {
  pet: PetStateController;
}

export function ChatPanel({ pet }: ChatPanelProps) {
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);
    setStreaming(true);
    setHistory((prev) => [...prev, { role: 'user', text }]);
    // 占位条目：token 流式填充
    setHistory((prev) => [...prev, { role: 'pet', text: '' }]);
    pet.transition('CHATTING', 'chat_start');

    await api.chatStream(
      text,
      {
        onToken: (t) => {
          setHistory((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'pet') last.text += t;
            return next;
          });
        },
        onDone: () => {
          setStreaming(false);
          pet.transition('IDLE', 'chat_end');
        },
        onError: (m) => {
          setError(m);
          setStreaming(false);
          pet.transition('IDLE', 'chat_error');
        },
      },
      'local-thread',
    );
  }

  return (
    <div className="chat-panel">
      <ul className="chat-list">
        {history.length === 0 && (
          <li className="chat-empty">和桌宠聊聊天吧～（骨架回复，第 7–10 周接入真实模型）</li>
        )}
        {history.map((m, i) => (
          <li key={i} className={`chat-msg ${m.role}`}>
            <span className="chat-bubble">{m.text || '…'}</span>
          </li>
        ))}
      </ul>
      {error && <p className="notice">{error}</p>}
      <form className="chat-input-row" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="说点什么…（Enter 发送）"
          maxLength={2000}
          disabled={streaming}
        />
        <button type="submit" disabled={!input.trim() || streaming}>
          {streaming ? '…' : '发送'}
        </button>
      </form>
    </div>
  );
}
