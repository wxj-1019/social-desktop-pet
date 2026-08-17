import { useEffect, useState } from 'react';

import { adminApi } from '../api.js';

interface Overview {
  totalUsers: number;
  onlineDevices: number;
  chatRequestsToday: number;
  pendingInvites: number;
}

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .overview()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error)
    return (
      <p className="page-error" role="alert">
        加载失败：{error}
      </p>
    );
  if (!data) return <p className="muted">加载中…</p>;

  const cards: Array<[string, number]> = [
    ['注册用户', data.totalUsers],
    ['在线设备（5 分钟内）', data.onlineDevices],
    ['今日聊天请求', data.chatRequestsToday],
    ['待处理邀请', data.pendingInvites],
  ];
  return (
    <section className="overview">
      <h2>总览</h2>
      <div className="stat-grid">
        {cards.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
