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
import { Send, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { MemoryConfirmation, ModelOutput, SavedMemoryBrief } from '@pet/protocol';

import { api } from '../lib/api/client.js';
import { localReply } from '../lib/local-mode.js';
import { CharacterVisual, useCurrentCharacter } from '../pet/character-visual.js';
import { DEFAULT_VISUAL_STATE } from '../pet/pet-renderer.js';

import { MemoryConfirmCard } from './memory-confirm-card.js';

interface ChatEntry {
  id: string;
  role: 'user' | 'pet';
  text: string;
}

/** update chatEvent 节流窗口（100ms） */
const UPDATE_THROTTLE_MS = 100;

/** 异步记忆抽取完成前的轮询：最多 4 次 × 2s（图内一次 LLM 调用约 2–4s） */
const MEMORY_POLL_ATTEMPTS = 4;
const MEMORY_POLL_INTERVAL_MS = 2_000;
/** "已记住"提示展示窗口（含撤销入口） */
const SAVED_NOTICE_MS = 6_000;

/** 提示文本截断长度（气泡/通知不刷屏） */
function shorten(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ChatPanel() {
  const { config } = useCurrentCharacter();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<MemoryConfirmation[]>([]);
  const [savedNotice, setSavedNotice] = useState<SavedMemoryBrief | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  /** 已提示过的自动保存（差分去重：同一条只提示一次） */
  const seenSavedIdsRef = useRef<Set<string>>(new Set());
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<boolean>(false);
  /** 流式中止控制器（"停止回复"按钮） */
  const abortRef = useRef<AbortController | null>(null);

  /** "已记住"通知（4s 自动消失，含撤销入口）+ 桌宠气泡 */
  function showSavedNotice(saved: SavedMemoryBrief) {
    setSavedNotice(saved);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedNotice(null), SAVED_NOTICE_MS);
    window.pet?.petRuntime?.showBubble(`已记住：${shorten(saved.value, 24)}`);
  }

  /** 拉取记忆摘要：待确认卡 + 差分最近自动保存（notifyNewSaved=false 时不弹提示） */
  async function refreshMemory(notifyNewSaved: boolean) {
    try {
      const summary = await api.memorySummary();
      setPendingConfirmations(summary.pending);
      if (notifyNewSaved) {
        for (const saved of summary.recentlySaved) {
          if (seenSavedIdsRef.current.has(saved.memoryId)) continue;
          seenSavedIdsRef.current.add(saved.memoryId);
          showSavedNotice(saved);
        }
      }
    } catch {
      /* 未登录/网络异常：记忆提示静默 */
    }
  }

  /** 聊天完成后异步轮询（等待服务端 memory-extract 图跑完） */
  async function pollMemoryAfterChat() {
    for (let attempt = 0; attempt < MEMORY_POLL_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, MEMORY_POLL_INTERVAL_MS));
      if (pollAbortRef.current) return;
      await refreshMemory(true);
    }
  }

  /** 确认卡"记住"（可带修改值） */
  async function confirmMemory(confirmationId: string, value?: string) {
    try {
      await api.confirmMemory(confirmationId, value);
      setPendingConfirmations((prev) => prev.filter((c) => c.confirmationId !== confirmationId));
      window.pet?.petRuntime?.showBubble('记住啦～');
    } catch {
      setError('记忆确认失败，请重试');
    }
  }

  /** 确认卡"仅本次聊天" */
  async function rejectMemory(confirmationId: string) {
    try {
      await api.rejectMemory(confirmationId);
      setPendingConfirmations((prev) => prev.filter((c) => c.confirmationId !== confirmationId));
      window.pet?.petRuntime?.showBubble('好，这次不记');
    } catch {
      setError('操作失败，请重试');
    }
  }

  /** "已记住"撤销（D-3：10.5 置失效不删除） */
  async function undoSaved(memoryId: string) {
    try {
      await api.invalidateMemory(memoryId);
    } catch {
      /* 撤销失败保持现状即可 */
    }
    seenSavedIdsRef.current.delete(memoryId);
    setSavedNotice(null);
  }

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
    // 存量待确认（登录后；不弹"已记住"提示）
    void refreshMemory(false);
    pollAbortRef.current = false;
    return () => {
      pollAbortRef.current = true;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // 历史加载完成 → 定位到最新消息（scrollTo 守卫只在用户已贴底时自动滚，
  // 打开面板时 scrollTop=0 不会触发——这里显式滚一次）
  useEffect(() => {
    if (!historyLoaded) return;
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
  }, [historyLoaded]);

  // 新消息滚动到底部（只在用户已在底部时自动滚动，不抢用户上滚查看历史；
  // 流式时用 'auto' 避免 smooth 动画每 token 重启）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
    }
  }, [entries, streaming]);

  /** 中止当前流式回复（保留已生成文本；不触发本地兜底） */
  function stopStreaming() {
    abortRef.current?.abort();
  }

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

    const controller = new AbortController();
    abortRef.current = controller;
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
            // 10.6：异步记忆抽取在服务端进行，轮询等结果（确认卡 / "已记住"提示）
            void pollMemoryAfterChat();
          },
          onError: () => {
            fallbackToLocal();
          },
          // 用户主动停止：保留已生成文本，静默结束（不兜底、不弹错误）
          onAbort: () => {
            setStreaming(false);
            if (petId) {
              setEntries((prev) =>
                prev.map((entry) =>
                  entry.id === petId && entry.text === '' ? { ...entry, text: '…' } : entry,
                ),
              );
            }
          },
        },
        'local-thread',
        controller.signal,
      );
    } catch {
      // 网络异常（如模型供应商超时）不能卡死 UI——本地兜底
      fallbackToLocal();
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <main className="chat-panel" aria-label="云端聊天">
      <div className="chat-heading chat-heading--compact">
        <div className="character-presence">
          <div className="character-presence__avatar" aria-hidden="true">
            <CharacterVisual state={{ ...DEFAULT_VISUAL_STATE, speaking: streaming }} />
          </div>
          <span className="character-presence__status">
            {streaming ? `${config.petName}正在思考与回复…` : `${config.petName}在身边`}
          </span>
        </div>
        <span className="status-chip status-chip--ai">
          <Sparkles size={11} aria-hidden="true" />
          AI 生成
        </span>
      </div>
      <ul className="chat-list" ref={listRef} role="log" aria-label="对话记录">
        {!historyLoaded && (
          <li className="chat-empty" aria-hidden="true">
            <span className="soft-loader" />
          </li>
        )}
        {historyLoaded && entries.length === 0 && (
          <li className="chat-empty">
            <span className="chat-empty__character" aria-hidden="true">
              <CharacterVisual />
            </span>
            <strong>想和我聊什么？</strong>
            <p>今天的小事、突然冒出的想法，都可以告诉我。</p>
          </li>
        )}
        {entries.map((message) => (
          <li key={message.id} className={`chat-msg ${message.role}`}>
            {message.role === 'pet' && (
              <span className="chat-msg__avatar" aria-hidden="true">
                <CharacterVisual />
              </span>
            )}
            <span className="chat-bubble">
              {message.text || (
                <span className="typing-dots" aria-label={`${config.petName}正在回复`}>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="notice notice--warning" role="status">
          {error}
        </p>
      )}
      {savedNotice && (
        <p className="notice notice--success" role="status">
          已记住：{shorten(savedNotice.value)}
          <button
            type="button"
            className="notice__action"
            onClick={() => void undoSaved(savedNotice.memoryId)}
          >
            撤销
          </button>
        </p>
      )}
      {pendingConfirmations.length > 0 && (
        <section className="memory-confirm-area" aria-label="星屿想记住这些">
          <p className="memory-confirm-area__title">星屿想记住这些，你愿意吗？</p>
          {pendingConfirmations.map((confirmation) => (
            <MemoryConfirmCard
              key={confirmation.confirmationId}
              confirmation={confirmation}
              onConfirm={confirmMemory}
              onReject={rejectMemory}
            />
          ))}
        </section>
      )}
      <form className="chat-input-row" onSubmit={send}>
        <label className="sr-only" htmlFor="cloud-chat-input">
          给星屿发消息
        </label>
        <textarea
          id="cloud-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter 发送 / Shift+Enter 换行（多行输入）
            if (event.key === 'Enter' && !event.shiftKey && !streaming) {
              event.preventDefault();
              void send(event);
            }
          }}
          placeholder={streaming ? '星屿正在回复…' : '说点什么…（Enter 发送）'}
          maxLength={2000}
          rows={1}
          disabled={streaming || !historyLoaded}
        />
        {streaming ? (
          <button type="button" aria-label="停止回复" title="停止回复" onClick={stopStreaming}>
            <Square size={15} aria-hidden="true" fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="发送"
            title="发送"
            disabled={!input.trim() || !historyLoaded}
          >
            <Send size={17} aria-hidden="true" />
          </button>
        )}
      </form>
    </main>
  );
}
