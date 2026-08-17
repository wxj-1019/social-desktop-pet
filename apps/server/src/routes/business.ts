/**
 * 业务路由 —— 挂载 invite/gift/visit/sync 真实实现（9.3–9.6/6.3）+ chat（10.1 SSE）。
 * 统一结构：鉴权 → 校验 → 事务 → Inbox → WS 通知（9.4 可靠写入流程）。
 */
import type {
  LlmClient,
  MemoryExtractStore,
  MemoryRetrievalStore,
  OutputModerator,
} from '@pet/ai-graph';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { RealtimeServer } from '../realtime/ws.js';

import { registerChatRoutes } from './chat.js';
import { registerGiftRoutes } from './gift.js';
import { registerInviteRoutes } from './invite.js';
import { registerMemoriesRoutes } from './memories.js';
import { registerQueryRoutes } from './queries.js';
import { registerSyncRoutes } from './sync.js';
import { registerVisitRoutes } from './visit.js';

export interface BusinessDeps {
  pool: pg.Pool;
  jwt: JwtService;
  realtime: RealtimeServer;
  /** 模型客户端（10.1；无则 chat 降级骨架回复） */
  llm?: LlmClient;
  /** 记忆存储（10.6；无则跳过异步记忆抽取与确认路由的数据层） */
  memoryStore?: MemoryExtractStore;
  /** 记忆检索存储（10.7；与 memoryStore 通常同一实例，无则 chat 跳过检索） */
  retrievalStore?: MemoryRetrievalStore;
  /** 输出审核 provider（12.5 免费 Moderation；无则图内规则版兜底） */
  outputModerator?: OutputModerator;
}

/** 鉴权注入的上下文变量 */
export interface BusinessVariables {
  userId: string;
  deviceId: string;
}

/** 鉴权中间件：Bearer access token → 注入 userId/deviceId；
 *  传入 pool 时同时做 9.8 撤销双保险（active_display_device_id 应用层校验，
 *  旧设备被停用后拒绝全部云端功能；null/undefined 放行，有值不匹配 → 403）。 */
export function requireAuth(
  jwt: JwtService,
  pool?: pg.Pool,
): MiddlewareHandler<{ Variables: BusinessVariables }> {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      const payload = await jwt.verify(token);
      // 9.8 撤销双保险（应用层校验；与 RLS 策略 auth.uid 兜底互补）
      if (pool) {
        const { rows } = await pool.query(
          'select active_display_device_id from profiles where user_id = $1',
          [payload.sub],
        );
        const activeDevice = rows[0]?.active_display_device_id;
        if (
          activeDevice !== undefined &&
          activeDevice !== null &&
          String(activeDevice) !== payload.deviceId
        ) {
          return c.json({ error: 'device_revoked' }, 403);
        }
      }
      c.set('userId', payload.sub);
      c.set('deviceId', payload.deviceId);
      return next();
    } catch {
      return c.json({ error: 'unauthorized' }, 401);
    }
  };
}

export function createBusinessRouter(deps: BusinessDeps): Hono<{ Variables: BusinessVariables }> {
  const app = new Hono<{ Variables: BusinessVariables }>();

  // 10.1：chat-flow 图经 SSE 流式执行（graph engineering；第 7–10 周换真实模型节点）
  registerChatRoutes(app, deps);

  // 10.6 / D-3：记忆确认队列（summary/confirm/reject/invalidate）
  registerMemoriesRoutes(app, deps);

  // 9.4 gift（幂等 + 配额 + 双 inbox + WS 通知）
  registerGiftRoutes(app, deps);
  // 6.3 邀请（创建 + 接受）
  registerInviteRoutes(app, deps);
  // 拜访（9.8 设备校验点）
  registerVisitRoutes(app, deps);
  // 9.5 /sync 慢路径补齐
  registerSyncRoutes(app, deps);
  // 查询（/me /friends）
  registerQueryRoutes(app, deps);

  return app;
}
