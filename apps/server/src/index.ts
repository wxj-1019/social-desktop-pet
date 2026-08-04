/**
 * 服务入口 —— 自建后端（D-13）：Hono HTTP + WebSocket + 启动迁移检查。
 *
 * 对应 9.1 推荐栈：Postgres（pg）+ 自建 Auth（jose）+ 自建 Realtime（ws）。
 * AI Gateway 同进程部署（跑 @pet/ai-graph chat-flow，第 7–10 周接线）。
 */
import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type pg from 'pg';

import { createOpenAiCompatibleClient, llmConfigFromEnv } from './ai/llm.js';
import { JwtService } from './auth/jwt.js';
import { SessionManager, type SessionStore } from './auth/session.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { PgDevicesStore, PgSessionStore, PgUsersStore } from './db/stores.js';
import { PgMemoryExtractStore } from './lib/memory-store.js';
import { RealtimeServer } from './realtime/ws.js';
import { createAuthRouter, type AuthDeps } from './routes/auth.js';
import { createBusinessRouter, type BusinessDeps } from './routes/business.js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（参考 .env.example）`);
  return v;
}

export interface AppDeps {
  pool: pg.Pool;
  jwt: JwtService;
  sessions: SessionManager;
  store: SessionStore;
  users: AuthDeps['users'];
  devices: AuthDeps['devices'];
  realtime: RealtimeServer;
  /** 模型客户端（10.1；无则 chat 降级骨架回复） */
  llm?: BusinessDeps['llm'];
  /** 记忆存储（10.6；无则跳过异步记忆抽取与确认数据层） */
  memoryStore?: BusinessDeps['memoryStore'];
  /** 本地 e2e 专用：注册测试数据重置端点（仅 PET_DEV_RESET=true 时开启，生产无此端点） */
  devReset?: boolean;
}

export function buildApp(deps: AppDeps) {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true, onlineUsers: deps.realtime.onlineUsers }));

  if (deps.devReset) {
    // e2e 自愈：清空配额计数与收件箱（gift 每日 3 次会被反复 e2e 耗尽，12.7 成本保护；
    // user_inbox 残留会让历史事件在登录挂载时被重放，污染"送礼→星屿反应"断言）。
    // 端点仅本地开发开启——生产环境不设 PET_DEV_RESET，攻击面为零。
    app.post('/__dev/reset-test-data', async (c) => {
      await deps.pool.query('delete from gift_events');
      await deps.pool.query('delete from chat_usage');
      await deps.pool.query('delete from user_inbox');
      // 记忆表（10.6）：确认队列/审计/已存记忆，供 memory e2e 反复执行
      await deps.pool.query('delete from memory_confirmations');
      await deps.pool.query('delete from memory_audit_log');
      await deps.pool.query('delete from private_memories');
      return c.json({ ok: true });
    });
  }

  const auth = createAuthRouter(deps);
  app.route('/auth', auth);

  const business = createBusinessRouter({
    pool: deps.pool,
    jwt: deps.jwt,
    realtime: deps.realtime,
    llm: deps.llm,
    memoryStore: deps.memoryStore,
  });
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

  // ---- 模型客户端（10.1；密钥只存服务端环境变量 8.3；未配置则 chat 降级骨架）----
  const llmConfig = llmConfigFromEnv();
  if (llmConfig) {
    console.info(`[server] AI 模型已启用：${llmConfig.model}（${llmConfig.baseUrl}）`);
  }
  const llm = llmConfig ? createOpenAiCompatibleClient(llmConfig) : undefined;

  // ---- 记忆存储（10.6 落库/检索/审计；RLS 纵深防御在 store 事务内 set claims）----
  const memoryStore = new PgMemoryExtractStore(pool);

  const app = buildApp({
    pool,
    jwt,
    sessions,
    store,
    users,
    devices,
    realtime,
    llm,
    memoryStore,
    devReset: process.env['PET_DEV_RESET'] === 'true',
  });

  const port = Number(process.env['PORT'] ?? 8787);
  const server = serve({ fetch: app.fetch, port });

  realtime.attach(server);

  console.info(`[server] listening on :${port} (ws: /realtime)`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    console.error('[server] 启动失败：', (e as Error).message);
    process.exit(1);
  });
}
