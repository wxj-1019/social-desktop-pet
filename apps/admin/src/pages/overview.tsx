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
  chatFailsToday: number;
  limitHitsToday: number;
  chatFails7d: number;
  limitHits7d: number;
  giftsToday: number;
  visitsToday: number;
}

interface TrendPoint {
  hour: string;
  messages: number;
}

/* ── 色彩定义（与 CSS --cat-* 一致） ── */

const SPARK_COLORS: Record<string, { stroke: string; fill: string }> = {
  violet: { stroke: '#7c6cf0', fill: 'rgba(124,108,240,0.12)' },
  blue: { stroke: '#4a8fe7', fill: 'rgba(74,143,231,0.12)' },
  green: { stroke: '#22a06b', fill: 'rgba(34,160,107,0.12)' },
  amber: { stroke: '#e5950e', fill: 'rgba(229,149,14,0.12)' },
};

type CardColor = keyof typeof SPARK_COLORS;

/* ── 迷你趋势图（<50px 高的 SVG 面积图；只用真实数据） ── */

function Sparkline({ points, color }: { points: number[]; color: CardColor }) {
  if (points.length < 2) return null;
  const W = 180;
  const H = 40;
  const max = Math.max(1, ...points);
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - (v / max) * (H - 2);
    return `${x},${y}`;
  });
  const line = coords.join(' ');
  const area = `0,${H} ${line} ${W},${H}`;
  const c = SPARK_COLORS[color] ?? { stroke: '#7c6cf0', fill: 'rgba(124,108,240,0.12)' };
  return (
    <div className="sparkline">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={area} fill={c.fill} />
        <polyline
          points={line}
          fill="none"
          stroke={c.stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.7"
        />
      </svg>
    </div>
  );
}

/* ── 统计卡定义 ── */

interface CardDef {
  label: string;
  value: number;
  color: CardColor;
  /** 仅当有真实时间序列数据时才携带（不做假趋势图） */
  sparkData?: number[];
  trend?: string;
  go?: 'users' | 'waitlist';
}

/** 24 时段小时消息趋势（小时粒度柱状图，每 3 小时一个刻度标签） */
function HourlyTrend({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.messages));
  const W = 720;
  const H = 130;
  const bw = W / points.length;
  return (
    <div className="table-panel chart-panel">
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label="近 24 小时聊天消息趋势">
        <defs>
          <linearGradient id="hourly-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9d90fa" />
            <stop offset="100%" stopColor="#6c5ce7" />
          </linearGradient>
        </defs>
        {points.map((p, i) => {
          const bh = Math.max(2, Math.round((p.messages / max) * H));
          const label = p.hour.slice(11, 13);
          return (
            <g key={p.hour}>
              <rect
                x={Math.round(i * bw + bw * 0.15)}
                y={H - bh}
                width={Math.max(3, Math.round(bw * 0.7))}
                height={bh}
                rx={4}
                className="chart-bar"
                fill="url(#hourly-grad)"
              >
                <title>{`${p.hour.slice(5, 16).replace('T', ' ')}：${p.messages} 条消息`}</title>
              </rect>
              {i % 3 === 0 && (
                <text
                  x={Math.round(i * bw + bw / 2)}
                  y={H + 16}
                  textAnchor="middle"
                  className="chart-label"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-dot" style={{ background: '#7c6cf0' }} />
          消息量
        </span>
      </div>
    </div>
  );
}

export function OverviewPage({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    Promise.all([adminApi.overview(), adminApi.overviewTrend().catch(() => ({ items: [] }))])
      .then(([d, t]) => {
        setData(d);
        setTrend(t.items);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(load, [load]);

  // 每 60 秒自动刷新一次（运营实时指标；页面卸载时清理）
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (error)
    return (
      <p className="page-error" role="alert">
        加载失败：{error}
      </p>
    );
  if (!data) return <p className="muted">加载中…</p>;

  // 今日失败率（%）；请求为 0 时视为 0，避免除零
  const requestsToday = data.chatRequestsToday ?? 0;
  const failsToday = data.chatFailsToday ?? 0;
  const failRate = requestsToday > 0 ? (failsToday / requestsToday) * 100 : 0;

  const hourlyPoints = trend?.map((p) => p.messages) ?? [];
  const peak = hourlyPoints.length > 0 ? Math.max(...hourlyPoints) : 0;

  const cards: CardDef[] = [
    { label: '注册用户', value: data.totalUsers, color: 'violet' },
    { label: '近 7 天注册', value: data.signups7d, color: 'violet' },
    { label: '在线设备（5 分钟内）', value: data.onlineDevices, color: 'blue' },
    { label: '设备总数', value: data.totalDevices, color: 'blue' },
    {
      label: '今日聊天请求',
      value: requestsToday,
      color: 'green',
      sparkData: hourlyPoints.length > 0 ? hourlyPoints : undefined,
      trend: peak > 0 ? `峰 ${peak}` : undefined,
    },
    { label: '近 7 天聊天请求', value: data.chatRequests7d, color: 'green' },
    { label: '今日礼物', value: data.giftsToday ?? 0, color: 'violet' },
    { label: '今日拜访', value: data.visitsToday ?? 0, color: 'blue' },
    {
      label: '今日失败',
      value: failsToday,
      color: failRate > 5 ? 'amber' : 'green',
      trend: failsToday > 0 ? `${failRate.toFixed(1)}%` : undefined,
    },
    { label: '近 7 天限额命中', value: data.limitHits7d ?? 0, color: 'amber' },
    { label: '已暂停账号', value: data.suspendedUsers, color: 'amber', go: 'users' },
    { label: '待处理邀请', value: data.pendingInvites, color: 'amber', go: 'waitlist' },
  ];

  return (
    <section className="page overview">
      <div className="page-head">
        <div>
          <h2>总览</h2>
          <p className="page-desc">
            平台关键运营指标一览（每 60 秒自动刷新）；已暂停账号与待处理邀请可点击直达
          </p>
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
              className={`stat-card ${card.color}${clickable ? ' clickable' : ''}`}
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
              <div className="stat-row">
                <div>
                  <div className="stat-value">{card.value.toLocaleString('zh-CN')}</div>
                  <div className="stat-label">{card.label}</div>
                </div>
                {card.trend && <div className="stat-trend">{card.trend}</div>}
              </div>
              {card.sparkData && <Sparkline points={card.sparkData} color={card.color} />}
            </div>
          );
        })}
      </div>
      {trend && trend.length > 0 && (
        <>
          <h3>近 24 小时聊天消息</h3>
          <HourlyTrend points={trend} />
        </>
      )}
    </section>
  );
}
