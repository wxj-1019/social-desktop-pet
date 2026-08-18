import { useCallback, useEffect, useState } from 'react';

import { adminApi } from '../api.js';

interface Overview {
  totalUsers: number;
  onlineDevices: number;
  totalDevices: number;
  chatRequestsToday: number;
  chatRequests7d: number;
  signups7d: number;
  suspendedUsers: number;
  pendingInvites: number;
}

interface Card {
  label: string;
  value: number;
  /** 需要关注时跳转的目标视图（异常项一键到位） */
  go?: 'users' | 'waitlist';
}

export function OverviewPage({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    adminApi
      .overview()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(load, [load]);

  if (error)
    return (
      <p className="page-error" role="alert">
        加载失败：{error}
      </p>
    );
  if (!data) return <p className="muted">加载中…</p>;

  const cards: Card[] = [
    { label: '注册用户', value: data.totalUsers },
    { label: '近 7 天注册', value: data.signups7d },
    { label: '在线设备（5 分钟内）', value: data.onlineDevices },
    { label: '设备总数', value: data.totalDevices },
    { label: '今日聊天请求', value: data.chatRequestsToday },
    { label: '近 7 天聊天请求', value: data.chatRequests7d },
    { label: '已暂停账号', value: data.suspendedUsers, go: 'users' },
    { label: '待处理邀请', value: data.pendingInvites, go: 'waitlist' },
  ];
  return (
    <section className="page overview">
      <div className="page-head">
        <div>
          <h2>总览</h2>
          <p className="page-desc">平台关键运营指标一览；已暂停账号与待处理邀请可点击直达</p>
        </div>
        <button onClick={load} disabled={refreshing}>
          {refreshing ? '刷新中…' : '刷新'}
        </button>
      </div>
      <div className="stat-grid">
        {cards.map((card) => {
          const clickable = card.go && onNavigate;
          return (
            <div
              className={clickable ? 'stat-card clickable' : 'stat-card'}
              key={card.label}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => onNavigate(card.go!) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === 'Enter') onNavigate(card.go!);
                    }
                  : undefined
              }
            >
              <div className="stat-value">{card.value}</div>
              <div className="stat-label">{card.label}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
