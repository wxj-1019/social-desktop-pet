/**
 * Inbox /sync 游标管理 —— 对应设计稿 9.5 / 9.6。
 * 客户端发现序列缺口时调用 /sync?afterInboxSeq=<n>，循环直到追上最新。
 */
export interface InboxCursorState {
  lastInboxSeq: number;
  syncing: boolean;
}

/** 发现缺口时拉取（第 11-14 周接真实 fetch） */
export async function syncAfter(
  baseUrl: string,
  afterSeq: number,
  pageSize = 200,
): Promise<{ items: Array<{ inboxSeq: number }>; nextInboxSeq: number; hasMore: boolean }> {
  void baseUrl;
  void pageSize;
  // TODO(第11-14周): GET /sync?afterInboxSeq=afterSeq，循环分页
  return { items: [], nextInboxSeq: afterSeq, hasMore: false };
}
