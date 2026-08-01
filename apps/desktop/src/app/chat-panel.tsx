/**
 * 聊天面板（云端）—— 10.1 chat-flow SSE 流式对话。
 * 登录后可用；本地模式走 local-chat（规则引擎）。
 * 联动：对话期间桌宠进入 CHATTING（口型动作），结束回 IDLE（7.1 状态机）。
 *
 * 健壮性（2026-08-02 修复）：
 * - 消息带 id：onToken 按 id 定位占位，防历史异步加载与发送竞态导致 token 拼错
 * - 历史加载完成前禁用发送（加载失败也放开）
 * - 网络/模型异常 try/catch 兜底，streaming 永不卡死
 */
import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api/client.js';
import type { PetStateController } from '../pet/use-pet-state-machine.js';

interface ChatEntry {
  id: string;
  role: 'user' | 'pet';
  text: string;
}

interface ChatPanelProps {
  pet: PetStateController;
}

export function ChatPanel({ pet }: ChatPanelProps) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // 挂载时恢复对话历史（10.x：服务端持久化，跨设备可续）
  useEffect(() => {
    void (async () => {
      try {
        const msgs = await api.chatHistory();
        setEntries((prev) => [
          ...msgs.map((m) => ({
            id: crypto.randomUUID(),
            role: m.role === 'user' ? 'user' : 'pet',
            text: m.content,
          })),
          ...prev, // 若发送已抢先发生（历史加载慢），新消息保持在历史之后
        ]);
      } catch {
        /* 历史加载失败不阻塞（新对话） */
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, []);

  // 新消息滚动到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming || !historyLoaded) return;
    setInput('');
    setError(null);
    setStreaming(true);
    const petId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', text },
      { id: petId, role: 'pet', text: '' },
    ]);
    pet.transition('CHATTING', 'chat_start');

    try {
      await api.chatStream(
        text,
        {
          onToken: (t) => {
            setEntries((prev) =>
              prev.map((e) => (e.id === petId ? { ...e, text: e.text + t } : e)),
            );
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
    } catch (e) {
      // 网络异常（如模型供应商超时）不能卡死 UI——恢复输入与桌宠状态
      setError((e as Error).message);
      setStreaming(false);
      pet.transition('IDLE', 'chat_error');
    }
  }

  return (
    <div className="chat-panel">
      <ul className="chat-list" ref={listRef}>
        {entries.length === 0 && (
          <li className="chat-empty">
            和桌宠聊聊天吧～（DeepSeek 已接入，第 7–10 周完善人格与记忆）
          </li>
        )}
        {entries.map((m) => (
          <li key={m.id} className={`chat-msg ${m.role}`}>
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
        <button type="submit" disabled={!input.trim() || streaming || !historyLoaded}>
          {streaming ? '…' : '发送'}
        </button>
      </form>
    </div>
  );
}
