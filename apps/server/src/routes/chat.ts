/**
 * chat 路由 —— 10.1 chat-flow 图经 SSE 流式执行（graph engineering 落地）。
 *
 * POST /chat { message, threadId? }
 *   → 鉴权 → 构造 ChatFlowState → buildChatFlow().invoke(emit)
 *   → 节点事件（node_start/token/node_end）逐帧 SSE 推流 → done 事件收尾
 *
 * SSE 事件格式（data 为 JSON）：
 *   event: node_start | token | node_end | done | error
 * 客户端解析器见 apps/desktop/src/lib/api/sse.ts（fetch + ReadableStream，
 * 不用 EventSource——后者无法带 Authorization header）。
 */
import { buildChatFlow } from '@pet/ai-graph';
import { initialChatFlowState } from '@pet/ai-graph';
import type { GraphEvent } from '@pet/ai-graph';
import type { LlmClient } from '@pet/ai-graph';
import { type Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { JwtService } from '../auth/jwt.js';

import type { BusinessVariables } from './business.js';
import { requireAuth } from './business.js';

export interface ChatDeps {
  jwt: JwtService;
  llm?: LlmClient;
}

/** 图实例缓存（compile 一次，全进程复用；llm 注入一次） */
let compiledGraph: ReturnType<typeof buildChatFlow> | null = null;
function getGraph(llm?: LlmClient): ReturnType<typeof buildChatFlow> {
  compiledGraph ??= buildChatFlow({ llm });
  return compiledGraph;
}

export function registerChatRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: ChatDeps,
): void {
  const auth: MiddlewareHandler<{ Variables: BusinessVariables }> = requireAuth(deps.jwt);

  app.post('/chat', auth, async (c) => {
    const userId = c.get('userId');
    const deviceId = c.get('deviceId');
    const { message, threadId } = (await c.req.json()) as { message?: string; threadId?: string };

    if (typeof message !== 'string' || message.length === 0) {
      return c.json({ error: '缺少 message' }, 400);
    }
    if (message.length > 2000) {
      return c.json({ error: 'message 过长（≤2000）' }, 400);
    }
    const id = typeof threadId === 'string' && threadId.length > 0 ? threadId : crypto.randomUUID();

    const initialState = initialChatFlowState({
      threadId: id,
      userId,
      deviceId,
      userMessage: message,
      scenario: 'private_chat',
    });

    return streamSSE(c, async (stream) => {
      // 节点事件 → SSE 帧（writeSSE 内部队列化，保证顺序）
      const emit = (e: GraphEvent): void => {
        void stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      };
      try {
        const finalState = await getGraph(deps.llm).invoke(initialState, { threadId: id, emit });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            dialogue: finalState.modelOutput?.dialogue ?? '',
            emotion: finalState.modelOutput?.emotion ?? 'neutral',
            actionIntent: finalState.modelOutput?.actionIntent ?? 'idle',
          }),
        });
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: (e as Error).message }),
        });
      }
    });
  });
}
