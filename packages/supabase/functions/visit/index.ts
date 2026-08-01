// visit Edge Function —— 6.5 异步拜访（权限按好友关系单独设置，默认每天最多 3 次）
// deno-lint-ignore-file no-explicit-any

import { jsonError, requireAuth } from '../_shared/client.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonError(405, 'Method Not Allowed');
  try {
    const auth = await requireAuth(req);
    // TODO(第11-14周): 验证关系与权限 → 出发动画事件 → 在线即时/离线 inbox
    void auth;
    return new Response(JSON.stringify({ status: '(scaffold)' }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return jsonError(401, (e as Error).message);
  }
});
