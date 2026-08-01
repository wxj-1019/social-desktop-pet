/**
 * 聊天面板（云端）—— 10.1 chat-flow SSE 流式对话。
 * 登录后可用；本地模式走 local-chat（规则引擎）。
 */
import { useState } from 'react';

import { api } from '../lib/api/client.js';

interface ChatEntry {
  role: 'user' | 'pet';
  text: string;
}

export function ChatPanel() {
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
        onDone: () => setStreaming(false),
        onError: (m) => {
          setError(m);
          setStreaming(false);
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
