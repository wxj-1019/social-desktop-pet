import { useCallback, useEffect, useRef, useState } from 'react';

import { adminApi } from '../api.js';

type ResourceType = 'chat' | 'private_memory' | 'bond_memory';

interface ChatSummaryRow {
  messageId: string;
  role: string;
  createdAt: string;
  summary: string;
}

interface MemorySummaryRow {
  memoryId: string;
  category: string;
  sensitivity: string;
  createdAt: string;
  summary: string;
}

/** 原文表格单元格格式化：ISO 时间 → 可读、对象 → JSON、空值 → 占位 */
function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 19).replace('T', ' ');
  return s;
}

/**
 * 敏感数据页 —— 两段式工作流（设计 §6 聊天与记忆）：
 * 1. 默认只加载服务端脱敏摘要（PII 掩码 + 截断），用于定位记录；
 * 2. 查看原文必须填写理由 + 明确日期范围，签发 5 分钟一次性授权，
 *    读取后立即失效（授权倒计时仅在读取窗口内展示，不落任何持久化）。
 */
export function SensitivePage() {
  // ---- 阶段一：脱敏摘要 ----
  const [userId, setUserId] = useState('');
  const [resourceType, setResourceType] = useState<ResourceType>('chat');
  const [summaryFrom, setSummaryFrom] = useState('');
  const [summaryTo, setSummaryTo] = useState('');
  const [chatRows, setChatRows] = useState<ChatSummaryRow[] | null>(null);
  const [memoryRows, setMemoryRows] = useState<MemorySummaryRow[] | null>(null);
  const [loadingSummaries, setLoadingSummaries] = useState(false);

  // ---- 阶段二：一次性授权读原文 ----
  const [reason, setReason] = useState('');
  // 起始日期默认今天（运营排查多为当日问题；to 缺省同起始日）
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState('');
  const [grant, setGrant] = useState<{
    grantId: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [remainSec, setRemainSec] = useState<number | null>(null);
  const [content, setContent] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grantFormRef = useRef<HTMLFormElement>(null);

  const summariesLoaded = chatRows !== null || memoryRows !== null;

  // bond_memory 无脱敏摘要端点：选中时把视线引导到下方授权表单
  useEffect(() => {
    if (resourceType === 'bond_memory') {
      grantFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [resourceType]);

  const loadSummaries = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setContent(null);
    setChatRows(null);
    setMemoryRows(null);
    setLoadingSummaries(true);
    try {
      if (resourceType === 'chat') {
        const result = await adminApi.chatSummary(userId, {
          from: summaryFrom || undefined,
          to: summaryTo || undefined,
        });
        setChatRows(result.items);
      } else if (resourceType === 'private_memory') {
        const result = await adminApi.memoriesSummary(userId);
        setMemoryRows(result.items);
      }
      // bond_memory 无脱敏摘要端点：仅支持经一次性授权查看原文
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingSummaries(false);
    }
  };

  const requestGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setContent(null);
    try {
      const g = await adminApi.createSensitiveAccess({
        targetUserId: userId,
        resourceType,
        reason,
        scope: { from, to: to || undefined },
      });
      setGrant(g);
      const result = await adminApi.sensitiveContent(g.grantId, g.token);
      setContent(result.items);
      setGrant(null); // 读取后立即丢弃（授权已单次消费）
      setNotice('已按授权读取一次；本次授权已失效。');
    } catch (err) {
      setError((err as Error).message);
      setGrant(null);
      setContent(null);
    } finally {
      setBusy(false);
    }
  };

  // 授权倒计时（仅在读取窗口内展示；每秒刷新，授权清除即停止）
  const tick = useCallback(() => {
    if (!grant) return;
    setRemainSec(
      Math.max(0, Math.round((new Date(grant.expiresAt).getTime() - Date.now()) / 1000)),
    );
  }, [grant]);
  useEffect(() => {
    if (!grant) {
      setRemainSec(null);
      return;
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [grant, tick]);

  // 服务端签发 5 分钟一次性授权（与后端 TTL 一致）
  const GRANT_TTL_SEC = 300;
  const grantPct =
    remainSec === null ? 100 : Math.max(0, Math.min(100, (remainSec / GRANT_TTL_SEC) * 100));

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>聊天与记忆（敏感数据）</h2>
          <p className="page-desc">
            默认只显示脱敏摘要（PII 已掩码 + 截断）。查看原文必须填写理由与日期范围，系统签发 5
            分钟一次性授权，读取后立即失效并记入审计。
          </p>
        </div>
      </div>

      <form className="grant-form" onSubmit={(e) => void loadSummaries(e)}>
        <label>
          用户 userId
          <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
        </label>
        <label>
          资源类型
          <select
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value as ResourceType)}
          >
            <option value="chat">聊天记录</option>
            <option value="private_memory">私人记忆</option>
            <option value="bond_memory">羁绊记忆</option>
          </select>
        </label>
        <label>
          起始日期（可选）
          <input
            type="date"
            value={summaryFrom}
            onChange={(e) => setSummaryFrom(e.target.value)}
            aria-label="摘要起始日期"
          />
        </label>
        <label>
          截止日期（可选）
          <input
            type="date"
            value={summaryTo}
            onChange={(e) => setSummaryTo(e.target.value)}
            aria-label="摘要截止日期"
          />
        </label>
        <button type="submit" disabled={loadingSummaries}>
          {loadingSummaries ? '加载中…' : '加载脱敏摘要'}
        </button>
      </form>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="page-notice" role="status">
          {notice}
        </p>
      )}

      {resourceType === 'bond_memory' && (
        <p className="page-notice">
          羁绊记忆不提供脱敏摘要；已滚动到下方授权表单，直接申请一次性授权即可。
        </p>
      )}

      {/* 摘要加载骨架屏（替代"看似冻结"的空白区） */}
      {loadingSummaries && (
        <div className="table-skeleton" aria-hidden="true">
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
          <div className="table-skeleton-row" />
        </div>
      )}

      {chatRows && (
        <>
          <h3>聊天摘要（脱敏，最近 50 条）</h3>
          <div className="table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>角色</th>
                  <th>摘要（脱敏）</th>
                </tr>
              </thead>
              <tbody>
                {chatRows.map((r) => (
                  <tr key={r.messageId}>
                    <td>{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                    <td>{r.role}</td>
                    <td>{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {chatRows.length === 0 && <p className="muted">暂无数据</p>}
        </>
      )}

      {memoryRows && (
        <>
          <h3>记忆摘要（脱敏，最近 50 条）</h3>
          <div className="table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>分类</th>
                  <th>敏感度</th>
                  <th>摘要（脱敏）</th>
                </tr>
              </thead>
              <tbody>
                {memoryRows.map((r) => (
                  <tr key={r.memoryId}>
                    <td>{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                    <td>{r.category}</td>
                    <td>{r.sensitivity}</td>
                    <td>{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {memoryRows.length === 0 && <p className="muted">暂无数据</p>}
        </>
      )}

      <h3>查看原文（一次性授权）</h3>
      <form className="grant-form" onSubmit={(e) => void requestGrant(e)} ref={grantFormRef}>
        <label>
          查看理由（≥5 字，写入审计）
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
            required
          />
        </label>
        <label>
          起始日期（含当天，必填；授权范围）
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
            aria-label="起始日期"
          />
        </label>
        <label>
          截止日期（可选，含当天；缺省同起始日；跨度上限 31 天）
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="截止日期"
          />
        </label>
        <button
          type="submit"
          disabled={busy || (!summariesLoaded && resourceType !== 'bond_memory')}
        >
          {busy ? '处理中…' : '申请授权并查看'}
        </button>
      </form>

      {grant && (
        <div className="grant-timer" role="status">
          <div className="grant-timer-track">
            <div className="grant-timer-fill" style={{ width: `${grantPct}%` }} />
          </div>
          <p>
            授权有效至 {grant.expiresAt}（剩余 {remainSec ?? '—'} 秒），正在读取…
          </p>
        </div>
      )}
      {grant && remainSec === 0 && (
        <p className="page-error" role="alert">
          授权已过期，请重新申请。
        </p>
      )}
      {content && (
        <div className="table-panel">
          <table className="data-table">
            <thead>
              <tr>
                {Object.keys(content[0] ?? {}).map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((v, j) => (
                    <td key={j} className="cell-word">
                      {formatCellValue(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
