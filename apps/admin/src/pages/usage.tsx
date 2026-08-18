import { useEffect, useState } from 'react';

import { adminApi, type UsageRow } from '../api.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

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
    </div>
  );
}

export function UsagePage() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [data, setData] = useState<{
    summary: { requests: number; tokens: number };
    items: UsageRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .usage(from, to)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>运行与用量</h2>
          <p className="page-desc">按日聚合的聊天请求与 token 估算（单用户用量见用户详情）</p>
        </div>
      </div>
      <div className="toolbar">
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
      {!error && !data && <p className="muted">加载中…</p>}
      {data && (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-card">
              <div className="stat-value">{data.summary.requests}</div>
              <div className="stat-label">区间请求总数</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.summary.tokens}</div>
              <div className="stat-label">区间 token 估算</div>
            </div>
          </div>
          <TrendChart items={data.items} />
          <div className="table-panel" style={{ marginTop: 20 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>请求数</th>
                  <th>token 估算</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.usageDate}>
                    <td>{r.usageDate}</td>
                    <td>{r.requests}</td>
                    <td>{r.tokens}</td>
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
