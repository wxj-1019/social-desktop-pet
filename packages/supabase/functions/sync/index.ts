// sync Edge Function —— Reliable Inbox 补偿（9.6 / 9.5 慢路径）
// GET /sync?afterInboxSeq=<n>  分页拉取缺失事件
// deno-lint-ignore-file no-explicit-any

import { requireAuth, jsonError } from '../_shared/client.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return jsonError(405, 'Method Not Allowed');
  try {
    const auth = await requireAuth(req);
    const url = new URL(req.url);
    const after = Number.parseInt(url.searchParams.get('afterInboxSeq') ?? '0', 10);

    if (!Number.isFinite(after) || after < 0) return jsonError(400, 'afterInboxSeq 非法');

    // TODO(第11-14周): 从 user_inbox 拉取 inbox_seq > after 的事件，单次最多 N 条（9.5 分页）
    //   B 类短期事件过期后推进游标不返回内容
    // 框架阶段返回空
    void auth;
    return new Response(JSON.stringify({ items: [], nextInboxSeq: after, hasMore: false }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return jsonError(401, (e as Error).message);
  }
});
