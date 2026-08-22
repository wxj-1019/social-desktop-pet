/**
 * 指标采集与暴露 —— Prometheus 文本格式（零依赖，P0-3 观测地基延伸）。
 *
 * - pet_http_requests_total{method,path,status}：请求计数（path 折叠到第一段控制基数）
 * - pet_http_request_duration_ms{path}：耗时 count/sum（无直方图的简化版）
 * - pet_ws_online_users / pet_db_pool_*：运行时快照（render 时读取）
 * - process_*：Node 基础指标（uptime/RSS）
 *
 * 暴露策略：/metrics 由 index.ts 挂载；默认仅回环可达（PET_BIND_HOST 默认 127.0.0.1），
 * 对外部署时用 METRICS_TOKEN 开启 Bearer 校验（未设置则不校验，内网语义）。
 */
import type pg from 'pg';

import type { RealtimeServer } from '../realtime/ws.js';

/** path 折叠到第一段（/memories/:id → /memories），控制指标基数 */
function pathLabel(path: string): string {
  const first = path.split('/')[1] ?? 'root';
  return first.length === 0 ? 'root' : `/${first}`;
}

const requestCounts = new Map<string, number>();
const requestDurations = new Map<string, { count: number; sum: number }>();

/** 访问日志中间件同处调用（一次遍历两份输出） */
export function recordRequest(
  path: string,
  method: string,
  status: number,
  durationMs: number,
): void {
  const label = pathLabel(path);
  const key = `method="${method}",path="${label}",status="${String(status)}"`;
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  const dkey = `path="${label}"`;
  const d = requestDurations.get(dkey) ?? { count: 0, sum: 0 };
  d.count += 1;
  d.sum += durationMs;
  requestDurations.set(dkey, d);
}

/** 渲染 Prometheus 文本格式（exposition format v0.0.4） */
export function renderMetrics(deps: { pool: pg.Pool; realtime: RealtimeServer }): string {
  const lines: string[] = [];

  lines.push('# HELP pet_http_requests_total HTTP requests processed.');
  lines.push('# TYPE pet_http_requests_total counter');
  for (const [key, value] of [...requestCounts.entries()].sort()) {
    lines.push(`pet_http_requests_total{${key}} ${value}`);
  }

  lines.push('# HELP pet_http_request_duration_ms HTTP request duration (count/sum, ms).');
  lines.push('# TYPE pet_http_request_duration_ms summary');
  for (const [key, value] of [...requestDurations.entries()].sort()) {
    lines.push(`pet_http_request_duration_ms{${key},quantile="count"} ${value.count}`);
    lines.push(`pet_http_request_duration_ms{${key},quantile="sum"} ${Math.round(value.sum)}`);
  }

  lines.push('# HELP pet_ws_online_users Current authenticated WS connections (by user).');
  lines.push('# TYPE pet_ws_online_users gauge');
  lines.push(`pet_ws_online_users ${deps.realtime.onlineUsers}`);

  lines.push('# HELP pet_db_pool_connections Postgres pool connections by state.');
  lines.push('# TYPE pet_db_pool_connections gauge');
  lines.push(`pet_db_pool_connections{state="total"} ${deps.pool.totalCount}`);
  lines.push(`pet_db_pool_connections{state="idle"} ${deps.pool.idleCount}`);
  lines.push(`pet_db_pool_connections{state="waiting"} ${deps.pool.waitingCount}`);

  lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${Math.round(process.uptime())}`);

  lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
  lines.push('# TYPE process_resident_memory_bytes gauge');
  lines.push(`process_resident_memory_bytes ${process.memoryUsage().rss}`);

  return `${lines.join('\n')}\n`;
}
