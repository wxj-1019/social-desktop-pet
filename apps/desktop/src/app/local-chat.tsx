/**
 * 本地模式聊天 —— 规则引擎兜底 + 可选本地 BYOK 模型（OpenAI 兼容）。
 * 配置并启用本地模型（设置页）后走真实 LLM（Main 侧调用，密钥不出主进程）；
 * 未配置/调用失败自动回退规则引擎，本地模式永远可用。
 *
 * Task 11：本地回复经 window.pet.petRuntime.chatEvent 推送
 * （start → done，source: local_chat）；动作由 Main petRuntime 驱动。
 */
import { Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { LocalLlmConfigView } from '@pet/protocol';

import {
  appendLocalMessage,
  loadLocalHistory,
  localReply,
  type ChatMessage,
} from '../lib/local-mode.js';
import { CharacterVisual } from '../pet/character-visual.js';

interface LocalChatProps {
  onLoginClick: () => void;
}

/** BYOK 模型的系统提示词：本地小宠物人格，短句、无身份承诺（10.4） */
const LLM_SYSTEM_PROMPT =
  '你是用户的桌面小宠物"星屿"，温暖、好奇、话少。用中文回复，一次不超过两句话（60字以内），' +
  '语气轻松可爱，可以适度用颜文字。不讨论敏感话题，不扮演真实人类，不说自己是大模型。';

/** 送入 LLM 的最近历史条数（含本轮） */
const LLM_HISTORY_WINDOW = 16;

export function LocalChat({ onLoginClick }: LocalChatProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [llmView, setLlmView] = useState<LocalLlmConfigView | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 启动恢复本地对话 + 查询本地模型配置（enabled && hasApiKey 才走 LLM）
  useEffect(() => {
    setHistory(loadLocalHistory());
    void window.pet?.localLlm?.getView().then((view) => setLlmView(view));
  }, []);

  // 新消息滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [history, pending]);

  const llmReady = llmView?.enabled === true && llmView.hasApiKey === true;

  function emitDone(reply: string) {
    window.pet?.petRuntime?.chatEvent({
      phase: 'done',
      source: 'local_chat',
      output: { dialogue: reply, emotion: 'warm', actionIntent: 'nod', intensity: 1 },
    });
  }

  /** LLM 路径：历史映射为 OpenAI messages → Main 侧调用；失败回退规则引擎 */
  async function replyViaLlm(text: string, prior: ChatMessage[]): Promise<string> {
    const messages = [
      { role: 'system' as const, content: LLM_SYSTEM_PROMPT },
      ...prior.slice(-LLM_HISTORY_WINDOW).map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      })),
      { role: 'user' as const, content: text },
    ];
    const result = await window.pet?.localLlm?.chat({ messages });
    if (result && 'reply' in result && result.reply) return result.reply;
    return localReply(text);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    const userMsg: ChatMessage = { role: 'user', text, at: new Date().toISOString() };
    const withUser = appendLocalMessage(history, userMsg);
    setHistory(withUser);
    setInput('');
    // 本地回复 → Main petRuntime（start；CHATTING→IDLE 由 Main 状态机处理）
    window.pet?.petRuntime?.chatEvent({ phase: 'start', source: 'local_chat', text });

    if (!llmReady) {
      const reply = localReply(text);
      const petMsg: ChatMessage = { role: 'pet', text: reply, at: new Date().toISOString() };
      setHistory(appendLocalMessage(withUser, petMsg));
      emitDone(reply);
      return;
    }

    setPending(true);
    void replyViaLlm(text, withUser)
      .then((reply) => {
        const petMsg: ChatMessage = { role: 'pet', text: reply, at: new Date().toISOString() };
        setHistory((prev) => appendLocalMessage(prev, petMsg));
        emitDone(reply);
      })
      .finally(() => setPending(false));
  }

  return (
    <main className="local-chat" aria-label="本地聊天">
      <ul className="chat-list" role="log" aria-label="对话记录">
        {history.length === 0 && (
          <li className="chat-empty">
            <span className="chat-empty__character" aria-hidden="true">
              <CharacterVisual />
            </span>
            <strong>先从一句你好开始吧</strong>
            <p>这些对话只会留在这台电脑里。</p>
          </li>
        )}
        {history.map((message, index) => (
          <li key={index} className={`chat-msg ${message.role}`}>
            {message.role === 'pet' && (
              <span className="chat-msg__avatar" aria-hidden="true">
                <CharacterVisual />
              </span>
            )}
            <span className="chat-bubble">{message.text}</span>
          </li>
        ))}
        {pending && (
          <li className="chat-msg pet" aria-live="polite">
            <span className="chat-msg__avatar" aria-hidden="true">
              <CharacterVisual />
            </span>
            <span className="chat-bubble chat-bubble--typing">…</span>
          </li>
        )}
        <div ref={bottomRef} />
      </ul>
      <button className="local-login-prompt" onClick={onLoginClick}>
        <Sparkles size={13} style={{ marginRight: 6 }} aria-hidden="true" />
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
