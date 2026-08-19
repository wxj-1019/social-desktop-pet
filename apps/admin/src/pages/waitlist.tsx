import { useCallback, useEffect, useRef, useState } from 'react';

import { adminApi, type WaitlistRow } from '../api.js';
import { downloadCsv } from '../csv.js';
import { Pagination } from '../pagination.js';

const PAGE_SIZE = 50;

/** 搜索防抖：输入停止 300ms 后才触发查询 */
function useDebounced(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** waitlist 状态 → 中文徽章（视觉语义：pending 待定灰 / invited 强调 / joined 成功 / expired 危险） */
const STATUS_PILLS: Record<string, [string, string]> = {
  pending: ['待邀请', 'pill muted'],
  invited: ['已邀请', 'pill'],
  joined: ['已加入', 'pill ok'],
  expired: ['已过期', 'pill danger'],
};

function StatusPill({ status }: { status: string }) {
  const [label, cls] = STATUS_PILLS[status] ?? [status, 'pill muted'];
  return <span className={cls}>{label}</span>;
}

/** 邀请邮件投递结果（0016 追踪）：运营据此判断该人工跟进谁 */
const MAIL_PILLS: Record<string, [string, string]> = {
  sent: ['已送达', 'pill ok'],
  failed: ['发送失败', 'pill danger'],
  skipped: ['未配置', 'pill muted'],
  pending: ['发送中', 'pill'],
};

function MailPill({ status }: { status: string }) {
  const [label, cls] = MAIL_PILLS[status] ?? ['未发送', 'pill muted'];
  return <span className={cls}>{label}</span>;
}

export function WaitlistPage() {
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounced(keyword);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: WaitlistRow[]; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 行级 busy：防止快速双击重复发放/过期
  const [busyId, setBusyId] = useState<string | null>(null);

  // 响应序号防护：快速输入/翻页触发多次请求时，旧响应晚到不再覆盖新结果
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
    if (status) params.status = status;
    if (debouncedKeyword.trim()) params.q = debouncedKeyword.trim();
    adminApi
      .waitlist(params)
      .then((d) => {
        if (seq === loadSeq.current) setData(d);
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e.message);
      });
  }, [status, debouncedKeyword, page]);

  useEffect(load, [load]);

  const invite = async (row: WaitlistRow) => {
    if (busyId) return;
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.inviteWaitlist(row.id);
      setNotice(result.code ? `已邀请 ${row.email}，兑换码 ${result.code}` : `已邀请 ${row.email}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const expire = async (row: WaitlistRow) => {
    if (busyId) return;
    if (!window.confirm(`确认将 ${row.email} 的邀请标记为过期？`)) return;
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      await adminApi.expireWaitlist(row.id);
      setNotice(`已过期：${row.email}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = () => {
    const rows = data?.items ?? [];
    downloadCsv(
      `waitlist-${new Date().toISOString().slice(0, 10)}.csv`,
      ['邮箱', '状态', '邮件', '报名时间', '邀请时间', '邀请到期', '兑换时间'],
      rows.map((r) => [
        r.email,
        STATUS_PILLS[r.status]?.[0] ?? r.status,
        MAIL_PILLS[r.inviteMailStatus]?.[0] ?? '未发送',
        r.createdAt.slice(0, 10),
        r.invitedAt ? r.invitedAt.slice(0, 10) : '',
        r.inviteExpiresAt ? r.inviteExpiresAt.slice(0, 10) : '',
        r.claimedAt ? r.claimedAt.slice(0, 10) : '',
      ]),
    );
  };

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>运营邀请</h2>
          <p className="page-desc">等待名单报名、邀请发放与兑换进度</p>
        </div>
        <button onClick={exportCsv} disabled={!data || data.items.length === 0}>
          导出 CSV
        </button>
      </div>
      <div className="toolbar">
        <input
          placeholder="搜索邮箱"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1); // 筛选变化回到第 1 页
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          <option value="pending">待邀请</option>
          <option value="invited">已邀请</option>
          <option value="joined">已加入</option>
          <option value="expired">已过期</option>
        </select>
      </div>
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
      {!error && !data && <p className="muted">加载中…</p>}
      <div className="table-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>状态</th>
              <th>邮件</th>
              <th>报名时间</th>
              <th>邀请时间</th>
              <th>邀请到期</th>
              <th>兑换时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => {
              const rowBusy = busyId === row.id;
              return (
                <tr key={row.id}>
                  <td className="cell-strong">{row.email}</td>
                  <td>
                    <StatusPill status={row.status} />
                  </td>
                  <td>
                    {row.status === 'invited' ? <MailPill status={row.inviteMailStatus} /> : '—'}
                  </td>
                  <td>{row.createdAt.slice(0, 10)}</td>
                  <td>{row.invitedAt ? row.invitedAt.slice(0, 10) : '—'}</td>
                  <td>{row.inviteExpiresAt ? row.inviteExpiresAt.slice(0, 10) : '—'}</td>
                  <td>{row.claimedAt ? row.claimedAt.slice(0, 10) : '—'}</td>
                  <td>
                    {row.status === 'pending' && (
                      <button
                        onClick={() => void invite(row)}
                        disabled={rowBusy || busyId !== null}
                      >
                        {rowBusy ? '发放中…' : '发放邀请'}
                      </button>
                    )}
                    {row.status === 'invited' && (
                      <button
                        onClick={() => void expire(row)}
                        disabled={rowBusy || busyId !== null}
                      >
                        {rowBusy ? '处理中…' : '标记过期'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && data.items.length === 0 && <p className="muted">暂无数据</p>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onChange={setPage} />
    </section>
  );
}
