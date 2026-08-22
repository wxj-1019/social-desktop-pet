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
import { type Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import type pg from 'pg';

import type {
  GraphEvent,
  LlmClient,
  MemoryExtractStore,
  MemoryRetrievalStore,
  OutputModerator,
} from '@pet/ai-graph';
import { buildChatFlow, initialChatFlowState } from '@pet/ai-graph';
import { DEFAULT_FEATURE_FLAGS, LIMITS } from '@pet/config';

import type { JwtService } from '../auth/jwt.js';
import { runMemoryExtract } from '../lib/run-memory-extract.js';

import type { BusinessVariables } from './business.js';
import { requireAuth } from './business.js';

export interface ChatDeps {
  jwt: JwtService;
  pool: pg.Pool;
  llm?: LlmClient;
  /** 记忆存储（10.6；无则跳过异步记忆抽取） */
  memoryStore?: MemoryExtractStore;
  /** 记忆检索存储（10.7；与 memoryStore 通常同一实例，无则跳过检索） */
  retrievalStore?: MemoryRetrievalStore;
  /** 输出审核 provider（12.5 免费 Moderation；无则图内规则版 PII/敏感细节拦截） */
  outputModerator?: OutputModerator;
}

/** 图实例缓存（compile 一次，全进程复用；llm/retrievalStore/outputModerator 注入一次） */
let compiledGraph: ReturnType<typeof buildChatFlow> | null = null;
function getGraph(
  llm?: LlmClient,
  retrievalStore?: MemoryRetrievalStore,
  outputModerator?: OutputModerator,
): ReturnType<typeof buildChatFlow> {
  compiledGraph ??= buildChatFlow({ llm, retrievalStore, outputModerator });
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

/**
 * V-13 多轮上下文：取该 thread 最近几轮（user+assistant，正序，不含当前消息——
 * 当前消息由调用方追加），供分类器判定情绪恶化趋势。
 */
const RECENT_TURNS_LIMIT = 6;

async function loadRecentTurns(
  pool: pg.Pool,
  userId: string,
  threadId: string,
  currentMessage: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const { rows } = await pool.query(
      `select role, content from chat_messages
       where user_id = $1 and thread_id = $2
       order by created_at desc
       limit $3`,
      [userId, threadId, RECENT_TURNS_LIMIT],
    );
    const turns = rows.reverse().map((r) => ({
      role: String(r.role) === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(r.content),
    }));
    turns.push({ role: 'user', content: currentMessage });
    return turns;
  } catch {
    return [{ role: 'user', content: currentMessage }];
  }
}

/** 12.7：每日预算记账（chat_usage 表；token 估算 = 字符数/4）。
 *  双条件成本保护：request_count 超 dailyChatRequestsPerUser（保守请求上限）
 *  或 token_estimate 超 dailyTokenBudgetPerUser（12.7 真实 token 预算，此前只记账不比对） */
async function checkAndRecordDailyUsage(
  pool: pg.Pool,
  userId: string,
  message: string,
  outputChars: number,
  model = '',
): Promise<'ok' | 'daily_limit' | 'token_budget_exceeded'> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const tokenEstimate = Math.ceil((message.length + outputChars) / 4);
    const { rows } = await client.query(
      `insert into chat_usage (user_id, usage_date, request_count, token_estimate, model)
       values ($1, current_date, 1, $2, $3)
       on conflict (user_id, usage_date)
       do update set
         request_count = chat_usage.request_count + 1,
         token_estimate = chat_usage.token_estimate + excluded.token_estimate,
         model = excluded.model
       returning request_count, token_estimate`,
      [userId, tokenEstimate, model],
    );
    await client.query('commit');
    const requestCount = Number(rows[0]?.request_count ?? 1);
    const totalTokens = Number(rows[0]?.token_estimate ?? tokenEstimate);
    if (requestCount > LIMITS.dailyChatRequestsPerUser) return 'daily_limit';
    if (totalTokens > LIMITS.dailyTokenBudgetPerUser) return 'token_budget_exceeded';
    return 'ok';
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** 12.7 观测：事后事件计数（limit_hits=命中 429 预算拒绝；fail_count=图执行抛错）。
 *  行已由 checkAndRecordDailyUsage 保证存在；fire-and-forget 由调用方决定 */
async function recordUsageEvent(
  pool: pg.Pool,
  userId: string,
  kind: 'limit_hit' | 'fail',
): Promise<void> {
  const column = kind === 'limit_hit' ? 'limit_hits' : 'fail_count';
  await pool.query(
    `update chat_usage set ${column} = ${column} + 1
     where user_id = $1 and usage_date = current_date`,
    [userId],
  );
}

export function registerChatRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: ChatDeps,
): void {
  const auth: MiddlewareHandler<{ Variables: BusinessVariables }> = requireAuth(
    deps.jwt,
    deps.pool,
  );

  app.post('/chat', auth, async (c) => {
    const userId = c.get('userId');
    const deviceId = c.get('deviceId');
    const { message, threadId } = (await c.req.json()) as { message?: string; threadId?: string };

    if (typeof message !== 'string' || message.length === 0) {
      return c.json({ error: '缺少 message' }, 400);
    }
    if (message.length > LIMITS.chatMessageMaxChars) {
      return c.json({ error: `message 过长（≤${LIMITS.chatMessageMaxChars}）` }, 400);
    }

    // 12.7 AI Kill Switch（运维兜底：AI_ENABLED=false 或默认开关关闭 → 直接 503，
    // 不调模型不流式；此前 feature flag 从未接入路由层）
    if (process.env['AI_ENABLED'] === 'false' || !DEFAULT_FEATURE_FLAGS.aiEnabled) {
      return c.json({ error: 'ai_disabled' }, 503);
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
    // 12.7 每日预算（chat_usage 记账；请求数或 token 预算任一超限拒绝）
    const usage = await checkAndRecordDailyUsage(deps.pool, userId, message, 0, deps.llm?.model);
    if (usage === 'daily_limit' || usage === 'token_budget_exceeded') {
      // 12.7 观测：命中预算拒绝计入 limit_hits（request_count 已含本请求，成功数可拆分）
      void recordUsageEvent(deps.pool, userId, 'limit_hit').catch(() => undefined);
      leaveConcurrency(deviceId);
      return c.json({ error: usage }, 429);
    }

    const id = typeof threadId === 'string' && threadId.length > 0 ? threadId : crypto.randomUUID();

    // V-13 多轮上下文判定：注入最近几轮（user+assistant，正序，含当前轮）
    const recentTurns = await loadRecentTurns(deps.pool, userId, id, message);

    const initialState = initialChatFlowState({
      threadId: id,
      userId,
      deviceId,
      userMessage: message,
      scenario: 'private_chat',
      recentTurns,
    });

    console.info(`[chat] 进入流式：user=${userId.slice(0, 8)} msg=${message.slice(0, 20)}`);
    return streamSSE(c, async (stream) => {
      // SSE 保活：15s 注释帧防反代/网关空闲断连（Caddy/Nginx 默认空闲超时会切断长流；
      // 注释帧不产生客户端事件，parseSseChunks 天然忽略）
      const keepAlive = globalThis.setInterval(() => {
        void stream.write(': keep-alive\n\n').catch(() => undefined);
      }, 15_000);
      // 节点事件 → SSE 帧（writeSSE 内部队列化，保证顺序）
      const emit = (e: GraphEvent): void => {
        void stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      };
      try {
        const finalState = await getGraph(
          deps.llm,
          deps.retrievalStore,
          deps.outputModerator,
        ).invoke(initialState, {
          threadId: id,
          emit,
        });
        // 终稿文案：approve 路径 responseText=通过审核的回复；阻断路径=通用降级
        // 文案（11.2 泄漏拦截）；危机路径=11.8 固定协议。流式 token 由审核后的
        // stream_reply 节点发出（11.2 先审后发），done 帧与落库同样以 responseText 为准。
        const dialogue = finalState.responseText ?? finalState.modelOutput?.dialogue ?? '';
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            dialogue,
            emotion:
              finalState.modelOutput?.emotion ?? (finalState.crisisLevel ? 'concerned' : 'neutral'),
            actionIntent: finalState.modelOutput?.actionIntent ?? 'idle',
            intensity: finalState.modelOutput?.intensity ?? 1,
          }),
        });
        // 对话历史落库（10.x：user 消息 + assistant 回复；保留期 11.4）
        await saveChatMessages(deps.pool, userId, id, message, dialogue);

        // 10.6 异步记忆抽取（fire-and-forget：不阻塞已流式的回复；失败仅记日志）
        if (finalState.memoryExtractTriggered && deps.memoryStore) {
          void runMemoryExtract({
            pool: deps.pool,
            userId,
            threadId: id,
            store: deps.memoryStore,
            llm: deps.llm,
          }).catch((e) => {
            console.warn('[memory] 抽取失败：', (e as Error).message);
          });
        }
      } catch (e) {
        // 12.7 观测：图执行抛错计入 fail_count（fire-and-forget，不影响 error 帧下发）
        void recordUsageEvent(deps.pool, userId, 'fail').catch(() => undefined);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: (e as Error).message }),
        });
      } finally {
        clearInterval(keepAlive);
        leaveConcurrency(deviceId); // 12.7 并发槽位释放（成功/失败都释放）
      }
    });
  });

  // 对话历史（10.x）：最近 N 条，按时间正序返回
  app.get('/chat/history', auth, async (c) => {
    const userId = c.get('userId');
    // 畸形/负数 limit（?limit=abc/-5）钳制为合法范围，避免 NaN 直传 SQL 报 500
    const raw = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(Math.trunc(raw), 200)) : 50;
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
