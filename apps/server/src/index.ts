/**
 * 服务入口 —— 自建后端（D-13）：Hono HTTP + WebSocket + 启动迁移检查。
 *
 * 对应 9.1 推荐栈：Postgres（pg）+ 自建 Auth（jose）+ 自建 Realtime（ws）。
 * AI Gateway 同进程部署（跑 @pet/ai-graph chat-flow，第 7–10 周接线）。
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { JwtService } from './auth/jwt.js';
import { SessionManager, type SessionStore } from './auth/session.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { PgDevicesStore, PgSessionStore, PgUsersStore } from './db/stores.js';
import { RealtimeServer } from './realtime/ws.js';
import type { AuthDeps } from './routes/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createBusinessRouter } from './routes/business.js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（参考 .env.example）`);
  return v;
}

export interface AppDeps {
  jwt: JwtService;
  sessions: SessionManager;
  store: SessionStore;
  users: AuthDeps['users'];
  devices: AuthDeps['devices'];
  realtime: RealtimeServer;
}

export function buildApp(deps: AppDeps) {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true, onlineUsers: deps.realtime.onlineUsers }));

  const auth = createAuthRouter(deps);
  app.route('/auth', auth);

  const business = createBusinessRouter({ jwt: deps.jwt, realtime: deps.realtime });
  app.route('/', business);

  return app;
}

/** 启动（本地开发 / 生产共用一个入口） */
export async function main(): Promise<void> {
  const pool = createPool({ connectionString: env('DATABASE_URL') });

  // 启动迁移（幂等；失败则中止启动，避免跑在未迁移的 schema 上）
  const { applied } = await migrate(pool);
  if (applied.length > 0) console.info(`[server] migrations applied: ${applied.join(', ')}`);

  // ---- 自建 Auth（9.8）----
  const jwt = new JwtService({ secret: env('JWT_SECRET') });
  const store = new PgSessionStore(pool);
  const sessions = new SessionManager(store);
  const users = new PgUsersStore(pool);
  const devices = new PgDevicesStore(pool);

  // ---- 自建 Realtime（9.2/9.4）----
  const realtime = new RealtimeServer(jwt);

  const app = buildApp({ jwt, sessions, store, users, devices, realtime });

  const port = Number(process.env['PORT'] ?? 8787);
  const server = serve({ fetch: app.fetch, port });

  realtime.attach(server);

  console.info(`[server] listening on :${port} (ws: /realtime)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((e) => {
    console.error('[server] 启动失败：', (e as Error).message);
    process.exit(1);
  });
}
