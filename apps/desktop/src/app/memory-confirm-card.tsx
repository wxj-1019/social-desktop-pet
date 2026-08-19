/**
 * 记忆确认卡 —— D-3 分级确认的 HITL 收口（10.6）。
 * 敏感候选（health/finance/relationship/identity）经此卡由用户裁决：
 * 记住 / 仅本次聊天 / 修改（内联编辑后保存）。
 */
import { Pencil } from 'lucide-react';
import { useState } from 'react';

import type { MemoryConfirmation } from '@pet/protocol';

const CATEGORY_LABELS: Record<MemoryConfirmation['category'], string> = {
  preference: '偏好',
  commitment: '约定',
  event: '事件',
  fact: '事实',
  bond: '羁绊',
};

const SENSITIVITY_LABELS: Record<MemoryConfirmation['sensitivity'], string> = {
  low: '普通',
  medium: '较敏感',
  high: '敏感',
};

export interface MemoryConfirmCardProps {
  confirmation: MemoryConfirmation;
  onConfirm: (confirmationId: string, value?: string) => Promise<void>;
  onReject: (confirmationId: string) => Promise<void>;
}

export function MemoryConfirmCard({ confirmation, onConfirm, onReject }: MemoryConfirmCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(confirmation.value);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(confirmation.confirmationId, editing ? draft.trim() : undefined);
      setEditing(false); // 保存成功回到展示态（父组件随后会移除本卡）
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await onReject(confirmation.confirmationId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="memory-confirm-card">
      <div className="memory-confirm-card__meta">
        <span className="memory-confirm-card__tag">{CATEGORY_LABELS[confirmation.category]}</span>
        <span className="memory-confirm-card__tag">
          {SENSITIVITY_LABELS[confirmation.sensitivity]}
        </span>
      </div>

      {editing ? (
        <textarea
          className="memory-confirm-card__edit"
          value={draft}
          maxLength={2000}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="修改记忆内容"
        />
      ) : (
        <p className="memory-confirm-card__value">{confirmation.value}</p>
      )}

      <div className="memory-confirm-card__actions">
        {editing ? (
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || draft.trim().length === 0}
              onClick={() => void confirm()}
            >
              保存
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setDraft(confirmation.value);
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
              onClick={() => void confirm()}
            >
              记住
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void reject()}
            >
              仅本次聊天
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              title="修改后再记住"
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} aria-hidden="true" />
              修改
            </button>
          </>
        )}
      </div>
    </article>
  );
}
