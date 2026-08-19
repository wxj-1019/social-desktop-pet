import { useEffect, useState } from 'react';

import { adminApi, type UsageRow } from '../api.js';
import { downloadCsv } from '../csv.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

const DATE_PRESETS: Array<{ label: string; days: number }> = [
  { label: '近 7 天', days: 7 },
  { label: '近 14 天', days: 14 },
  { label: '近 30 天', days: 30 },
];

/** 请求量趋势（纯 SVG 柱状图，零依赖；悬停显示当日明细） */
function TrendChart({ items }: { items: UsageRow[] }) {
  const days = [...items].reverse().slice(-14); // 时间升序，最多 14 天
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map((d) => d.requests));
  const W = 640;
  const H = 140;
  const bw = W / days.length;
  return (
    <div className="table-panel chart-panel">
      <svg viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label="近几日请求量趋势">
        <defs>
          <linearGradient id="usage-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9d90fa" />
            <stop offset="100%" stopColor="#6c5ce7" />
          </linearGradient>
        </defs>
        {days.map((d, i) => {
          const bh = Math.max(2, Math.round((d.requests / max) * H));
          return (
            <g key={d.usageDate}>
              <rect
                x={Math.round(i * bw + bw * 0.15)}
                y={H - bh}
                width={Math.max(4, Math.round(bw * 0.7))}
                height={bh}
                rx={5}
                className="chart-bar"
                fill="url(#usage-grad)"
              >
                <title>{`${d.usageDate}：${d.requests} 次请求 / ${d.tokens} token`}</title>
              </rect>
              {days.length <= 10 && (
                <text
                  x={Math.round(i * bw + bw / 2)}
                  y={H + 16}
                  textAnchor="middle"
                  className="chart-label"
                >
                  {d.usageDate.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: '#7c6cf0' }} />
          请求量
        </span>
      </div>
    </div>
  );
}

export function UsagePage() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [data, setData] = useState<{
    summary: { requests: number; tokens: number; fails: number; limitHits: number };
    items: UsageRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 区间变化时刷新模型列表（模型下拉数据源）
  useEffect(() => {
    let cancelled = false;
    adminApi
      .usageModels(from, to)
      .then((r) => {
        if (!cancelled) setModels(r.models);
      })
      .catch(() => undefined); // 模型列表失败不阻塞主查询
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .usage(from, to, model)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, model]);

  const applyPreset = (days: number) => {
    setFrom(daysAgo(days));
    setTo(today());
  };

  const exportCsv = () => {
    const rows = data?.items ?? [];
    downloadCsv(
      `usage-${from}-${to}.csv`,
      ['日期', '请求数', 'token 估算', '失败', '限流'],
      rows.map((r) => [r.usageDate, r.requests, r.tokens, r.fails, r.limitHits]),
    );
  };

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>运行与用量</h2>
          <p className="page-desc">按日聚合的聊天请求与 token 估算（单用户用量见用户详情）</p>
        </div>
        <button onClick={exportCsv} disabled={!data || data.items.length === 0}>
          导出 CSV
        </button>
      </div>
      <div className="toolbar">
        {DATE_PRESETS.map((p) => (
          <button key={p.label} onClick={() => applyPreset(p.days)} disabled={loading}>
            {p.label}
          </button>
        ))}
        <label>
          从{' '}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          到{' '}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={loading}
          />
        </label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label="模型筛选"
          disabled={loading}
        >
          <option value="">全部模型</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {loading && <span className="muted">加载中…</span>}
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!error && !data && !loading && <p className="muted">加载中…</p>}
      {data && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-value">{data.summary.requests.toLocaleString('zh-CN')}</div>
              <div className="stat-label">区间请求总数</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.summary.tokens.toLocaleString('zh-CN')}</div>
              <div className="stat-label">区间 token 估算</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {data.summary.requests > 0
                  ? `${((data.summary.fails / data.summary.requests) * 100).toFixed(1)}%`
                  : '0%'}
              </div>
              <div className="stat-label">
                失败率（失败 {data.summary.fails.toLocaleString('zh-CN')} / 限流{' '}
                {data.summary.limitHits.toLocaleString('zh-CN')}）
              </div>
            </div>
          </div>
          <TrendChart items={data.items} />
          <div className="table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>请求数</th>
                  <th>token 估算</th>
                  <th>失败</th>
                  <th>限流</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.usageDate}>
                    <td>{r.usageDate}</td>
                    <td>{r.requests.toLocaleString('zh-CN')}</td>
                    <td>{r.tokens.toLocaleString('zh-CN')}</td>
                    <td>{r.fails > 0 ? <span className="pill danger">{r.fails}</span> : 0}</td>
                    <td>
                      {r.limitHits > 0 ? <span className="pill muted">{r.limitHits}</span> : 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.items.length === 0 && <p className="muted">暂无数据</p>}
        </>
      )}
    </section>
  );
}
