import { useCallback, useEffect, useRef, useState } from 'react';

import { adminApi, type SocialDailyRow, type SocialEventRow } from '../api.js';
import { downloadCsv } from '../csv.js';
import { Pagination } from '../pagination.js';

const PAGE_SIZE = 50;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** 事件类型 → 中文徽章（礼物=品牌紫 / 拜访=成功绿 / 好友建立=警告琥珀） */
const TYPE_PILLS: Record<string, [string, string]> = {
  'gift.snack_sent': ['礼物', 'pill'],
  'visit.arrived': ['拜访', 'pill ok'],
  'friend.connected': ['好友建立', 'pill warn'],
};

function TypePill({ type }: { type: string }) {
  const [label, cls] = TYPE_PILLS[type] ?? [type, 'pill muted'];
  return <span className={cls}>{label}</span>;
}

/** payload 的简要描述（礼物→点心名；拜访→类型；好友→邀请方） */
function payloadSummary(row: SocialEventRow): string {
  const p = row.payload;
  switch (row.type) {
    case 'gift.snack_sent':
      return `点心：${String(p.snackId ?? '—')}`;
    case 'visit.arrived':
      return `类型：${String(p.type ?? '—')}`;
    case 'friend.connected':
      return `邀请方：${String(p.inviterId ?? '—').slice(0, 8)}…`;
    default:
      return '—';
  }
}

export function SocialPage() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [daily, setDaily] = useState<{
    summary: { gifts: number; visits: number; newFriends: number; activeUsers: number };
    items: SocialDailyRow[];
  } | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);

  const [type, setType] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<{ items: SocialEventRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- 日报（区间维度） ----
  useEffect(() => {
    let cancelled = false;
    setDailyLoading(true);
    adminApi
      .socialDaily(from, to)
      .then((d) => {
        if (!cancelled) setDaily(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDailyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // ---- 事件流（类型/关键词/日期筛选 + 分页） ----
  const loadSeq = useRef(0);
  const loadEvents = useCallback(() => {
    const seq = ++loadSeq.current;
    const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
    if (type) params.type = type;
    if (keyword.trim()) params.q = keyword.trim();
    if (from) params.from = from;
    if (to) params.to = to;
    adminApi
      .socialEvents(params)
      .then((d) => {
        if (seq === loadSeq.current) setEvents(d);
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e.message);
      });
  }, [page, type, keyword, from, to]);

  useEffect(loadEvents, [loadEvents]);

  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  const exportCsv = () => {
    const rows = events?.items ?? [];
    downloadCsv(
      `social-events-${new Date().toISOString().slice(0, 10)}.csv`,
      ['时间', '类型', '发起方', '接收方', '详情'],
      rows.map((r) => [
        r.createdAt.slice(0, 19).replace('T', ' '),
        TYPE_PILLS[r.type]?.[0] ?? r.type,
        r.fromEmail ?? '',
        r.toEmail ?? '',
        payloadSummary(r),
      ]),
    );
  };

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>社交互动</h2>
          <p className="page-desc">礼物、拜访与好友建立的互动事件流与按日聚合</p>
        </div>
        <button onClick={exportCsv} disabled={!events || events.items.length === 0}>
          导出 CSV
        </button>
      </div>

      {/* 区间日报统计卡 */}
      {daily && (
        <div className="stat-grid">
          <div className="stat-card violet">
            <div className="stat-row">
              <div>
                <div className="stat-value">{daily.summary.gifts.toLocaleString('zh-CN')}</div>
                <div className="stat-label">区间礼物</div>
              </div>
            </div>
          </div>
          <div className="stat-card green">
            <div className="stat-row">
              <div>
                <div className="stat-value">{daily.summary.visits.toLocaleString('zh-CN')}</div>
                <div className="stat-label">区间拜访</div>
              </div>
            </div>
          </div>
          <div className="stat-card blue">
            <div className="stat-row">
              <div>
                <div className="stat-value">{daily.summary.newFriends.toLocaleString('zh-CN')}</div>
                <div className="stat-label">区间新建好友</div>
              </div>
            </div>
          </div>
          <div className="stat-card amber">
            <div className="stat-row">
              <div>
                <div className="stat-value">
                  {daily.summary.activeUsers.toLocaleString('zh-CN')}
                </div>
                <div className="stat-label">区间互动活跃用户</div>
              </div>
            </div>
          </div>
        </div>
      )}
      {dailyLoading && !daily && <p className="muted">加载中…</p>}

      {/* 事件流 */}
      <h3>互动事件流</h3>
      <div className="toolbar">
        <select
          value={type}
          onChange={(e) => resetPage(setType)(e.target.value)}
          aria-label="事件类型筛选"
        >
          <option value="">全部类型</option>
          <option value="gift.snack_sent">礼物</option>
          <option value="visit.arrived">拜访</option>
          <option value="friend.connected">好友建立</option>
        </select>
        <input
          placeholder="搜索用户邮箱"
          value={keyword}
          onChange={(e) => resetPage(setKeyword)(e.target.value)}
        />
        <label>
          从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          到 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!error && !events && <p className="muted">加载中…</p>}
      <div className="table-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>发起方</th>
              <th>接收方</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {events?.items.map((r) => (
              <tr key={r.eventId}>
                <td className="mono">{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                <td>
                  <TypePill type={r.type} />
                </td>
                <td className="cell-strong">{r.fromEmail ?? '—'}</td>
                <td>{r.toEmail ?? '—'}</td>
                <td className="muted">{payloadSummary(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events && events.items.length === 0 && <p className="muted">暂无互动事件</p>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={events?.total ?? 0} onChange={setPage} />
    </section>
  );
}
