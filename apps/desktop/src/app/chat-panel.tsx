/**
 * 聊天面板（云端）—— 10.1 chat-flow SSE 流式对话。
 * 登录后可用；本地模式走 local-chat（规则引擎）。
 *
 * Task 11（本地/云端聊天驱动星屿动作）：
 * - 云端消息经 window.pet.petRuntime.chatEvent 推送：
 *   start（cloud_ai）→ update（100ms 节流，累计文本 slice(-160)）→ done（完整 ModelOutput）
 * - done 帧带完整 ModelOutput，气泡追加完整对话文本
 * - 云失败 / 网络异常 → 本地兜底（local_chat done + 非阻塞提示），不递归重试云
 * - window.pet 缺失（纯 web）→ 跳过 chatEvent，聊天降级本地仍可用
 * - 不再直接调用 renderer 状态机（删除 usePetStateMachine）
 *
 * 健壮性（2026-08-02 修复）：
 * - 消息带 id：onToken 按 id 定位占位，防历史异步加载与发送竞态导致 token 拼错
 * - 历史加载完成前禁用发送（加载失败也放开）
 * - 网络/模型异常 try/catch 兜底，streaming 永不卡死
 */
import type { ModelOutput } from '@pet/protocol';
import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api/client.js';
import { localReply } from '../lib/local-mode.js';

interface ChatEntry {
  id: string;
  role: 'user' | 'pet';
  text: string;
}

/** update chatEvent 节流窗口（100ms） */
const UPDATE_THROTTLE_MS = 100;

export function ChatPanel() {
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
          ...msgs.map(
            (m) =>
              ({
                id: crypto.randomUUID(),
                role: m.role === 'user' ? 'user' : 'pet',
                text: m.content,
              }) satisfies ChatEntry,
          ),
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

    // Task 11：云端聊天开始 → Main petRuntime 进入说话状态
    window.pet?.petRuntime?.chatEvent({ phase: 'start', source: 'cloud_ai', text });

    let cumulative = '';
    let lastUpdate = Number.NEGATIVE_INFINITY;
    /** 累计 token 并按 100ms 节流推送 update chatEvent */
    const pushUpdate = (token: string) => {
      cumulative += token;
      const now = Date.now();
      if (now - lastUpdate >= UPDATE_THROTTLE_MS) {
        lastUpdate = now;
        window.pet?.petRuntime?.chatEvent({
          phase: 'update',
          source: 'cloud_ai',
          text: cumulative.slice(-160),
        });
      }
    };

    /** 云失败/异常 → 本地兜底：本地回复气泡 + local_chat done 事件（不递归重试云） */
    const fallbackToLocal = () => {
      const reply = localReply(text);
      setEntries((prev) =>
        prev.map((entry) => (entry.id === petId ? { ...entry, text: reply } : entry)),
      );
      window.pet?.petRuntime?.chatEvent({
        phase: 'done',
        source: 'local_chat',
        output: { dialogue: reply, emotion: 'warm', actionIntent: 'nod', intensity: 1 },
      });
      setError('云端暂不可用，已切换本地回应');
      setStreaming(false);
    };

    try {
      await api.chatStream(
        text,
        {
          onToken: (token) => {
            pushUpdate(token);
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === petId ? { ...entry, text: entry.text + token } : entry,
              ),
            );
          },
          onDone: (output: ModelOutput) => {
            // 气泡展示完整对话文本（token 流可能被截断/遗漏，以 done 帧为准）
            setEntries((prev) =>
              prev.map((entry) =>
                entry.id === petId ? { ...entry, text: output.dialogue } : entry,
              ),
            );
            window.pet?.petRuntime?.chatEvent({ phase: 'done', source: 'cloud_ai', output });
            setStreaming(false);
          },
          onError: () => {
            fallbackToLocal();
          },
        },
        'local-thread',
      );
    } catch {
      // 网络异常（如模型供应商超时）不能卡死 UI——本地兜底
      fallbackToLocal();
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
