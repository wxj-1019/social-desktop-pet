/**
 * 业务路由 —— 挂载 invite/gift/visit/sync 真实实现（9.3–9.6/6.3）+ chat（10.1 SSE）。
 * 统一结构：鉴权 → 校验 → 事务 → Inbox → WS 通知（9.4 可靠写入流程）。
 */
import type { LlmClient, MemoryExtractStore } from '@pet/ai-graph';
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
}

/** 鉴权注入的上下文变量 */
export interface BusinessVariables {
  userId: string;
  deviceId: string;
}

/** 鉴权中间件：Bearer access token → 注入 userId/deviceId */
export function requireAuth(jwt: JwtService): MiddlewareHandler<{ Variables: BusinessVariables }> {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      const payload = await jwt.verify(token);
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
