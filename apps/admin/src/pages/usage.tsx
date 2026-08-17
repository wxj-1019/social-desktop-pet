import { useEffect, useState } from 'react';

import { adminApi, type UsageRow } from '../api.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

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
      <h2>运行与用量</h2>
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
      {data && (
        <>
          <p className="muted">
            区间合计：{data.summary.requests} 次请求 / {data.summary.tokens} token 估算
          </p>
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
        </>
      )}
    </section>
  );
}
