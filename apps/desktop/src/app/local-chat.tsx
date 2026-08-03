/**
 * 本地模式聊天（第 3–6 周 Alpha 本地降级）—— 规则引擎，不依赖后端。
 * 第 7–10 周 AI 接入后，本地模式仍作为断网兜底保留。
 *
 * Task 11：本地回复经 window.pet.petRuntime.chatEvent 推送
 * （start → done，source: local_chat）；动作由 Main petRuntime 驱动，
 * 不再在 renderer 用 setTimeout 模拟 CHATTING。window.pet 缺失时跳过事件。
 */
import { HardDrive, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  appendLocalMessage,
  loadLocalHistory,
  localReply,
  type ChatMessage,
} from '../lib/local-mode.js';
import { StarIsleVisual } from '../pet/star-isle-visual.js';

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
    <main className="local-chat" aria-labelledby="local-chat-title">
      <div className="chat-heading chat-heading--character">
        <div className="character-presence">
          <div className="character-presence__avatar" aria-hidden="true">
            <StarIsleVisual variant="head" />
          </div>
          <div className="character-presence__copy">
            <h2 id="local-chat-title">星屿</h2>
            <p>不联网也能陪你</p>
          </div>
        </div>
        <span className="status-chip">
          <HardDrive size={13} aria-hidden="true" />
          仅此设备
        </span>
      </div>
      <ul className="chat-list" aria-live="polite">
        {history.length === 0 && (
          <li className="chat-empty">
            <span className="chat-empty__character" aria-hidden="true">
              <StarIsleVisual />
            </span>
            <strong>先从一句你好开始吧</strong>
            <p>这些对话只会留在这台电脑里。</p>
          </li>
        )}
        {history.map((message, index) => (
          <li key={index} className={`chat-msg ${message.role}`}>
            {message.role === 'pet' && (
              <span className="chat-msg__avatar" aria-hidden="true">
                <StarIsleVisual variant="head" />
              </span>
            )}
            <span className="chat-bubble">{message.text}</span>
          </li>
        ))}
        <div ref={bottomRef} />
      </ul>
      <button className="local-login-prompt" onClick={onLoginClick}>
        登录后解锁好友与云端记忆
      </button>
      <form className="chat-input-row" onSubmit={send}>
        <label className="sr-only" htmlFor="local-chat-input">
          给星屿发消息
        </label>
        <input
          id="local-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="说点什么…（Enter 发送）"
          maxLength={200}
        />
        <button type="submit" aria-label="发送" title="发送" disabled={!input.trim()}>
          <Send size={17} aria-hidden="true" />
        </button>
      </form>
    </main>
  );
}
