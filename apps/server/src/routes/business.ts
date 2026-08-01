/**
 * 业务路由骨架 —— 对应原 Edge Functions（gift/invite/visit/sync/chat）。
 * 第 3 周起逐个实现；当前返回占位（结构与 9.3/9.4 对齐：鉴权 → 校验 → 事务 → Inbox → 通知）。
 */
import { Hono } from 'hono';

import type { JwtService } from '../auth/jwt.js';
import type { RealtimeServer } from '../realtime/ws.js';

export interface BusinessDeps {
  jwt: JwtService;
  realtime: RealtimeServer;
}

/** 鉴权中间件：Bearer access token → 注入 userId/deviceId */
export function requireAuth(jwt: JwtService) {
  return async (
    c: {
      req: { header(name: string): string | undefined };
      set(key: string, v: unknown): void;
      json(body: unknown, status?: number): Response;
    },
    next: () => Promise<void>,
  ) => {
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

export function createBusinessRouter(deps: BusinessDeps): Hono {
  const app = new Hono();
  const auth = requireAuth(deps.jwt);

  // POST /chat —— 10.1：加载 chat-flow 图并执行（SSE 流式）
  // TODO(第 7–10 周): buildChatFlow().invoke(initialState, { threadId, emit }) 并 SSE 推流
  app.post('/chat', auth, async (c) => {
    const body = await c.req.json();
    void body;
    return c.json({ dialogue: '(scaffold: chat flow not yet wired)', actionIntent: 'idle' });
  });

  // POST /gift —— 9.4：礼物命令（幂等键 + 每日配额 + 事务写双方 Inbox）
  app.post('/gift', auth, async (c) => {
    return c.json({ error: '(scaffold) gift 未实现' }, 501);
  });

  // POST /invite —— 6.3：创建/接受邀请链接
  app.post('/invite', auth, async (c) => {
    return c.json({ error: '(scaffold) invite 未实现' }, 501);
  });

  // POST /visit —— 拜访命令（9.8 撤销双保险校验点）
  app.post('/visit', auth, async (c) => {
    return c.json({ error: '(scaffold) visit 未实现' }, 501);
  });

  // GET /sync?afterInboxSeq=n —— 9.5 慢路径补齐（A 类事件）
  app.get('/sync', auth, async (c) => {
    return c.json({ events: [], nextInboxSeq: null });
  });

  return app;
}
