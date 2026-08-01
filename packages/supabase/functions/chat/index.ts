// chat Edge Function —— 加载 chat-flow 图并执行（SSE 流式）
// 对应设计稿 10.1 + packages/ai-graph
// deno-lint-ignore-file no-explicit-any

import { requireAuth, jsonError } from '../_shared/client.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonError(405, 'Method Not Allowed');

  try {
    const auth = await requireAuth(req);
    const body = await req.json();
    const { message, scenario, bondId } = body ?? {};

    if (typeof message !== 'string' || message.length === 0) {
      return jsonError(400, '缺少 message');
    }

    // TODO(第7-10周): 引入 @pet/ai-graph buildChatFlow() 并以 SSE 推流 token
    //   const graph = buildChatFlow();
    //   const result = await graph.invoke(initialState, { threadId, emit: (e) => controller.enqueue(...) });
    // 共享包经 import_map.json 解析到源码，config.toml 已开启 bundle=true（审查修复 #4）
    // 框架阶段返回占位
    void auth;
    void scenario;
    void bondId;

    return new Response(
      JSON.stringify({
        dialogue: '(scaffold: chat flow not yet wired)',
        actionIntent: 'idle',
        threadId: crypto.randomUUID(),
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  } catch (e) {
    return jsonError(401, (e as Error).message);
  }
});
