// invite Edge Function —— 6.3 好友邀请 token（一次性，7 天失效，服务端只存哈希）
// deno-lint-ignore-file no-explicit-any

import { jsonError, requireAuth } from '../_shared/client.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonError(405, 'Method Not Allowed');
  try {
    const auth = await requireAuth(req);
    // TODO(第11-14周): 生成 token / 校验接受 / 创建好友关系+羁绊+首次见面事件
    void auth;
    return new Response(JSON.stringify({ status: '(scaffold)' }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return jsonError(401, (e as Error).message);
  }
});
