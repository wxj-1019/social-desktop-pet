/**
 * 本地模式聊天（第 3–6 周 Alpha 本地降级）—— 规则引擎，不依赖后端。
 * 第 7–10 周 AI 接入后，本地模式仍作为断网兜底保留。
 *
 * Task 11：本地回复经 window.pet.petRuntime.chatEvent 推送
 * （start → done，source: local_chat）；动作由 Main petRuntime 驱动，
 * 不再在 renderer 用 setTimeout 模拟 CHATTING。window.pet 缺失时跳过事件。
 */
import { useEffect, useRef, useState } from 'react';

import {
  appendLocalMessage,
  loadLocalHistory,
  localReply,
  type ChatMessage,
} from '../lib/local-mode.js';

interface LocalChatProps {
  onLoginClick: () => void;
}

export function LocalChat({ onLoginClick }: LocalChatProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 启动恢复本地对话
  useEffect(() => {
    setHistory(loadLocalHistory());
  }, []);

  // 新消息滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [history]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    const reply = localReply(text);
    const userMsg: ChatMessage = { role: 'user', text, at: new Date().toISOString() };
    const petMsg: ChatMessage = { role: 'pet', text: reply, at: new Date().toISOString() };
    setHistory((prev) => appendLocalMessage(appendLocalMessage(prev, userMsg), petMsg));
    setInput('');
    // 本地回复 → Main petRuntime（start/done；CHATTING→IDLE 由 Main 状态机处理）
    window.pet?.petRuntime?.chatEvent({ phase: 'start', source: 'local_chat', text });
    window.pet?.petRuntime?.chatEvent({
      phase: 'done',
      source: 'local_chat',
      output: { dialogue: reply, emotion: 'warm', actionIntent: 'nod', intensity: 1 },
    });
  }

  return (
    <div className="local-chat">
      <div className="local-banner">
        🏠 本地模式 —— 数据只存在这台电脑；
        <button className="link-button" onClick={onLoginClick}>
          登录后解锁好友/礼物/云端记忆
        </button>
      </div>
      <ul className="chat-list">
        {history.length === 0 && (
          <li className="chat-empty">和我聊聊天吧～（本地模式：不用登录，先体验）</li>
        )}
        {history.map((m, i) => (
          <li key={i} className={`chat-msg ${m.role}`}>
            <span className="chat-bubble">{m.text}</span>
          </li>
        ))}
        <div ref={bottomRef} />
      </ul>
      <form className="chat-input-row" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="说点什么…（Enter 发送）"
          maxLength={200}
        />
        <button type="submit" disabled={!input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}
