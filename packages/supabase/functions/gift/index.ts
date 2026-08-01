// gift Edge Function —— 9.4 免费点心事件（白名单内，每日配额，事务+幂等）
// deno-lint-ignore-file no-explicit-any

import { jsonError, requireAuth } from '../_shared/client.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonError(405, 'Method Not Allowed');
  try {
    const auth = await requireAuth(req);
    // TODO(第11-14周): 验证活动设备/好友/拉黑/每日配额/幂等键 → 事务写 gift_events + 双方 inbox → Realtime 通知
    void auth;
    return new Response(JSON.stringify({ status: '(scaffold)' }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return jsonError(401, (e as Error).message);
  }
});
