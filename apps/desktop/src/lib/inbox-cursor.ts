/**
 * Inbox /sync 游标管理 —— 对应设计稿 9.5 / 9.6。
 * 客户端发现序列缺口（断线 72h+ / inbox.delivered 序号不连续）时调用
 * /sync?afterInboxSeq=<n> 循环分页，直到追上最新（hasMore=false）。
 * 首次调用传 null：服务端从 device_cursors 恢复上次游标（P1-6 重启增量同步）。
 */
import { api, type SyncEvent } from './api/client.js';

export interface SyncPageResult {
  items: SyncEvent[];
  nextInboxSeq: number;
}

/**
 * 9.5 慢路径补齐：从 afterSeq 起循环拉取，直到服务端 hasMore=false。
 * - afterSeq 为 null 时第一页不传游标（服务端恢复 device_cursors，重启后不重放历史）
 * - 服务端单页上限 SYNC_PAGE_LIMIT=200（客户端不可调）
 * - 页数上限防失控：20 页 = 4000 条一次追平；超出则下次轮询/增量继续
 * - 抛错由调用方兜底（实时连接或下一次轮询会继续补齐）
 */
const MAX_PAGES = 20;

export async function syncAfter(afterSeq: number | null): Promise<SyncPageResult> {
  let cursor = afterSeq;
  const items: SyncEvent[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await api.sync(cursor);
    items.push(...result.events);
    cursor = result.nextInboxSeq;
    if (!result.hasMore) break;
  }
  return { items, nextInboxSeq: cursor };
}
