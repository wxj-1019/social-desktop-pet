/**
 * 记忆中心 —— 11.3 v1：查看/修改/删除/来源。
 *
 * - 列表：owner 的 active 记忆（值 + 分类/敏感度标签 + 日期 + 来源类型）
 * - 每张卡：展开"来源"看原文、内联"修改"（10.5 纠正链）、"删除"（置失效不物理删除）
 * - 顶部"待确认"区复用 MemoryConfirmCard（D-3 存量确认队列）
 */
import { Brain, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { MemoryConfirmation, MemoryListItem } from '@pet/protocol';

import { api } from '../lib/api/client.js';

import { MemoryConfirmCard } from './memory-confirm-card.js';

const CATEGORY_LABELS: Record<MemoryListItem['category'], string> = {
  preference: '偏好',
  commitment: '约定',
  event: '事件',
  fact: '事实',
  bond: '羁绊',
};

const SENSITIVITY_LABELS: Record<MemoryListItem['sensitivity'], string> = {
  low: '普通',
  medium: '较敏感',
  high: '敏感',
};

const SOURCE_LABELS: Record<MemoryListItem['sourceType'], string> = {
  user_stated: '你说过',
  user_confirmed: '你确认过',
  system_event: '系统记录',
  inferred: '推断',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function MemoriesPage() {
  const [memories, setMemories] = useState<MemoryListItem[]>([]);
  const [pending, setPending] = useState<MemoryConfirmation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [list, summary] = await Promise.all([api.memories(), api.memorySummary()]);
      setMemories(list);
      setPending(summary.pending);
      setError(null);
    } catch {
      setError('记忆加载失败');
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  /** 确认卡"记住"（确认后新记忆进入列表） */
  async function confirm(confirmationId: string, value?: string) {
    try {
      await api.confirmMemory(confirmationId, value);
      setPending((prev) => prev.filter((c) => c.confirmationId !== confirmationId));
      void load();
    } catch {
      setError('确认失败，请重试');
    }
  }

  async function reject(confirmationId: string) {
    try {
      await api.rejectMemory(confirmationId);
      setPending((prev) => prev.filter((c) => c.confirmationId !== confirmationId));
    } catch {
      setError('操作失败，请重试');
    }
  }

  return (
    <main className="memories-page" aria-label="记忆中心">
      <div className="view-heading">
        <div className="view-heading__identity">
          <span className="view-heading__avatar" aria-hidden="true">
            <Brain size={18} />
          </span>
          <div>
            <p className="eyebrow">记忆中心</p>
            <h2>星屿记住的{memories.length}件小事</h2>
          </div>
        </div>
      </div>

      {error && (
        <p className="notice notice--warning" role="status">
          {error}
        </p>
      )}

      {!loaded && (
        <div className="friends-state" role="status">
          <span className="soft-loader" aria-hidden="true" />
          <p>正在加载记忆…</p>
        </div>
      )}

      {loaded && pending.length > 0 && (
        <section className="memory-confirm-area" aria-label="待你确认的记忆">
          <p className="memory-confirm-area__title">星屿想记住这些，你愿意吗？</p>
          {pending.map((confirmation) => (
            <MemoryConfirmCard
              key={confirmation.confirmationId}
              confirmation={confirmation}
              onConfirm={confirm}
              onReject={reject}
            />
          ))}
        </section>
      )}

      {loaded && memories.length === 0 && !error && (
        <div className="friends-state">
          <strong>还没有记忆</strong>
          <p>和星屿聊聊，她会记住你喜欢的事。</p>
        </div>
      )}

      {memories.length > 0 && (
        <ul className="memory-list">
          {memories.map((memory) => (
            <MemoryItem
              key={memory.memoryId}
              memory={memory}
              onChanged={() => void load()}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function MemoryItem({
  memory,
  onChanged,
  onError,
}: {
  memory: MemoryListItem;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.value);
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 删除确认（二次点击防误删：置失效不可见，纠正链恢复只覆盖被纠正的旧条） */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save() {
    const value = draft.trim();
    if (value.length === 0) return;
    setBusy(true);
    try {
      await api.editMemory(memory.memoryId, value);
      setEditing(false);
      onChanged();
    } catch {
      onError('保存失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  /** 二次确认：第一次点击进入确认态（按钮文案变"确认删除？"），2s 未操作自动复位 */
  async function remove() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 2000);
      return;
    }
    setBusy(true);
    try {
      await api.invalidateMemory(memory.memoryId);
      onChanged();
    } catch {
      onError('删除失败，请重试');
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="memory-item">
      <div className="memory-item__meta">
        <span className="memory-confirm-card__tag">{CATEGORY_LABELS[memory.category]}</span>
        <span className="memory-confirm-card__tag">{SENSITIVITY_LABELS[memory.sensitivity]}</span>
        <span className="memory-item__source">{SOURCE_LABELS[memory.sourceType]}</span>
        <span className="memory-item__date">{formatDate(memory.createdAt)}</span>
      </div>

      {editing ? (
        <textarea
          className="memory-confirm-card__edit"
          value={draft}
          maxLength={2000}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="修改记忆内容"
        />
      ) : (
        <p className="memory-item__value">{memory.value}</p>
      )}

      {showSource && memory.sourceTexts.length > 0 && (
        <blockquote className="memory-item__source-texts">
          {memory.sourceTexts.map((text, i) => (
            <p key={i}>「{text}」</p>
          ))}
        </blockquote>
      )}

      <div className="memory-item__actions">
        {editing ? (
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || draft.trim().length === 0}
              onClick={() => void save()}
            >
              保存
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setDraft(memory.value);
                setEditing(false);
              }}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} aria-hidden="true" />
              修改
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              aria-expanded={showSource}
              onClick={() => setShowSource((s) => !s)}
            >
              <ChevronDown size={13} aria-hidden="true" />
              来源
            </button>
            <button
              type="button"
              className={
                confirmingDelete
                  ? 'secondary-button memory-item__danger memory-item__danger--confirm'
                  : 'secondary-button memory-item__danger'
              }
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 size={13} aria-hidden="true" />
              {confirmingDelete ? '确认删除？' : '删除'}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
