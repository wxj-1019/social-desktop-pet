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
import { buildChatFlow, initialChatFlowState } from '@pet/ai-graph';
import type { GraphEvent, LlmClient } from '@pet/ai-graph';
import { LIMITS } from '@pet/config';
import { type Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';

import type { BusinessVariables } from './business.js';
import { requireAuth } from './business.js';

export interface ChatDeps {
  jwt: JwtService;
  pool: pg.Pool;
  llm?: LlmClient;
}

/** 图实例缓存（compile 一次，全进程复用；llm 注入一次） */
let compiledGraph: ReturnType<typeof buildChatFlow> | null = null;
function getGraph(llm?: LlmClient): ReturnType<typeof buildChatFlow> {
  compiledGraph ??= buildChatFlow({ llm });
  return compiledGraph;
}

// ---- 12.7 成本保护：速率/并发（内存态，单实例够用；多实例升级 Redis）----
/** 每设备 60s 滑动窗口请求时间戳 */
const rateWindows = new Map<string, number[]>();
/** 每设备进行中的并发流式请求数 */
const inFlight = new Map<string, number>();

/** 速率限制：超限返回剩余等待秒数，否则记录并放行 */
export function checkRateLimit(
  deviceId: string,
  maxPerMinute: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const window = (rateWindows.get(deviceId) ?? []).filter((t) => now - t < 60_000);
  if (window.length >= maxPerMinute) {
    const oldest = window[0] ?? now;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)),
    };
  }
  window.push(now);
  rateWindows.set(deviceId, window);
  return { allowed: true, retryAfterSec: 0 };
}

/** 并发限制：进入/退出计数 */
export function enterConcurrency(deviceId: string, max: number): boolean {
  const current = inFlight.get(deviceId) ?? 0;
  if (current >= max) return false;
  inFlight.set(deviceId, current + 1);
  return true;
}
export function leaveConcurrency(deviceId: string): void {
  const current = inFlight.get(deviceId) ?? 1;
  if (current <= 1) inFlight.delete(deviceId);
  else inFlight.set(deviceId, current - 1);
}

/** 12.7：每日预算记账（chat_usage 表；token 估算 = 字符数/4） */
async function checkAndRecordDailyUsage(
  pool: pg.Pool,
  userId: string,
  message: string,
  outputChars: number,
  dailyLimit: number,
): Promise<'ok' | 'daily_limit'> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `insert into chat_usage (user_id, usage_date, request_count, token_estimate)
       values ($1, current_date, 1, $2)
       on conflict (user_id, usage_date)
       do update set
         request_count = chat_usage.request_count + 1,
         token_estimate = chat_usage.token_estimate + excluded.token_estimate
       returning request_count`,
      [userId, Math.ceil((message.length + outputChars) / 4)],
    );
    await client.query('commit');
    return Number(rows[0]?.request_count ?? 1) > dailyLimit ? 'daily_limit' : 'ok';
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
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

    // 12.7 速率限制（每设备 60s 窗口）
    const rate = checkRateLimit(deviceId, LIMITS.chatRateLimitPerMinute);
    if (!rate.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: rate.retryAfterSec }, 429);
    }
    // 12.7 并发限制（每设备同时 ≤2 个流式请求）
    if (!enterConcurrency(deviceId, LIMITS.concurrencyPerDevice)) {
      return c.json({ error: 'concurrency_limit' }, 429);
    }
    // 12.7 每日预算（chat_usage 记账；超限拒绝）
    const usage = await checkAndRecordDailyUsage(
      deps.pool,
      userId,
      message,
      0,
      LIMITS.dailyChatRequestsPerUser,
    );
    if (usage === 'daily_limit') {
      leaveConcurrency(deviceId);
      return c.json({ error: 'daily_limit' }, 429);
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
        const dialogue = finalState.modelOutput?.dialogue ?? '';
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            dialogue,
            emotion: finalState.modelOutput?.emotion ?? 'neutral',
            actionIntent: finalState.modelOutput?.actionIntent ?? 'idle',
          }),
        });
        // 对话历史落库（10.x：user 消息 + assistant 回复；保留期 11.4）
        await saveChatMessages(deps.pool, userId, id, message, dialogue);
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: (e as Error).message }),
        });
      } finally {
        leaveConcurrency(deviceId); // 12.7 并发槽位释放（成功/失败都释放）
      }
    });
  });

  // 对话历史（10.x）：最近 N 条，按时间正序返回
  app.get('/chat/history', auth, async (c) => {
    const userId = c.get('userId');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const { rows } = await deps.pool.query(
      `select role, content, created_at
       from (
         select role, content, created_at
         from chat_messages
         where user_id = $1
         order by created_at desc
         limit $2
       ) recent
       order by created_at asc`,
      [userId, limit],
    );
    return c.json({
      messages: rows.map((r) => ({
        role: String(r.role),
        content: String(r.content),
        at: (r.created_at as Date).toISOString(),
      })),
    });
  });
}

/** 对话落库（user 消息 + assistant 回复；失败不阻塞响应） */
async function saveChatMessages(
  pool: pg.Pool,
  userId: string,
  threadId: string,
  userMessage: string,
  reply: string,
): Promise<void> {
  try {
    await pool.query(
      `insert into chat_messages (user_id, thread_id, role, content) values
       ($1, $2, 'user', $3), ($1, $2, 'assistant', $4)`,
      [userId, threadId, userMessage, reply],
    );
  } catch {
    /* 历史落库失败不阻塞对话 */
  }
}
