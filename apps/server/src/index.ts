/**
 * 服务入口 —— 自建后端（D-13）：Hono HTTP + WebSocket + 启动迁移检查。
 *
 * 对应 9.1 推荐栈：Postgres（pg）+ 自建 Auth（jose）+ 自建 Realtime（ws）。
 * AI Gateway 同进程部署（跑 @pet/ai-graph chat-flow，第 7–10 周接线）。
 */
import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type pg from 'pg';

import { createOpenAiCompatibleEmbeddingClient, embeddingConfigFromEnv } from './ai/embedding.js';
import { createOpenAiCompatibleClient, llmConfigFromEnv } from './ai/llm.js';
import { createOpenAiCompatibleModerator, moderationConfigFromEnv } from './ai/moderation.js';
import { AdminSessionManager } from './auth/admin-session.js';
import { JwtService } from './auth/jwt.js';
import { OtpService } from './auth/otp.js';
import { SessionManager, type SessionStore } from './auth/session.js';
import { PgAdminSessionStore, PgAdminUserStore } from './db/admin-stores.js';
import { migrate } from './db/migrate.js';
import { PgOtpStore } from './db/otp-store.js';
import { createPool } from './db/pool.js';
import { PgDevicesStore, PgSessionStore, PgUsersStore } from './db/stores.js';
import { createNoopMailProvider, createSmtpMailProvider, smtpConfigFromEnv } from './lib/mail.js';
import { PgMemoryExtractStore } from './lib/memory-store.js';
import { runRetentionSweep } from './lib/retention.js';
import { RealtimeServer } from './realtime/ws.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter, type AuthDeps } from './routes/auth.js';
import { createBusinessRouter, type BusinessDeps } from './routes/business.js';
import { registerWaitlistRoutes, WaitlistService, type WaitlistDeps } from './routes/waitlist.js';

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
  /** 记忆检索存储（10.7；与 memoryStore 同一实例） */
  retrievalStore?: BusinessDeps['retrievalStore'];
  /** 输出审核 provider（12.5 免费 Moderation；无则图内规则版兜底） */
  outputModerator?: BusinessDeps['outputModerator'];
  /** 13.2 邮箱 OTP 登录服务（未注入则 /auth/otp/* 返回 501） */
  otp?: AuthDeps['otp'];
  /** 13.2 事务邮件（waitlist 确认；SMTP 配置就绪发真实邮件，否则降级日志） */
  mail?: WaitlistDeps['mail'];
  /** 管理后台会话（/admin；admin_sessions 表 + AdminSessionManager） */
  adminSessions: AdminSessionManager;
  adminSessionStore: PgAdminSessionStore;
  adminUsers: PgAdminUserStore;
  /** 4.3 邀请状态机（auth 注册绑定与 admin 运营邀请共用同一实例） */
  waitlist: WaitlistService;
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
      // 聊天记录（10.x）：抽取窗口按 thread 取最近 N 条——历史残留（含危机句）
      // 会污染 memory e2e 的抽取/分类上下文，重置环境必须一并清空
      await deps.pool.query('delete from chat_messages');
      // 记忆表（10.6）：确认队列/审计/已存记忆，供 memory e2e 反复执行
      await deps.pool.query('delete from memory_confirmations');
      await deps.pool.query('delete from memory_audit_log');
      await deps.pool.query('delete from private_memories');
      return c.json({ ok: true });
    });
  }

  const auth = createAuthRouter({
    ...deps,
    // 4.3 邀请状态机：注册绑定（joined + claimed_by）；与 admin 共用同一实例
    waitlist: deps.waitlist,
  });
  app.route('/auth', auth);

  // 4.3 Waitlist：公开报名/兑换 + 运营邀请（WAITLIST_ADMIN_TOKEN 未配置时 invite 404）
  app.use('/waitlist', cors());
  registerWaitlistRoutes(app, {
    pool: deps.pool,
    mail: deps.mail,
    adminToken: process.env['WAITLIST_ADMIN_TOKEN'],
    claimUrlBase: process.env['WAITLIST_CLAIM_URL_BASE'],
  });

  const business = createBusinessRouter({
    pool: deps.pool,
    jwt: deps.jwt,
    realtime: deps.realtime,
    llm: deps.llm,
    memoryStore: deps.memoryStore,
    retrievalStore: deps.retrievalStore,
    // 12.5 输出审核 provider：漏传会导致配了 MODERATION_API_KEY 也静默走规则版
    outputModerator: deps.outputModerator,
  });
  app.route('/', business);

  // 管理后台（/admin；路由自带 basePath('/admin')，挂根路径即生效）
  const admin = createAdminRouter({
    pool: deps.pool,
    jwt: deps.jwt,
    adminSessions: deps.adminSessions,
    adminSessionStore: deps.adminSessionStore,
    adminUsers: deps.adminUsers,
    realtime: deps.realtime,
    waitlist: deps.waitlist,
  });
  app.route('/', admin);

  return app;
}

/** 启动（本地开发 / 生产共用一个入口） */
export async function main(): Promise<void> {
  const pool = createPool({ connectionString: env('DATABASE_URL') });

  // 启动迁移（幂等；失败则中止启动，避免跑在未迁移的 schema 上）
  const { applied } = await migrate(pool);
  if (applied.length > 0) console.info(`[server] migrations applied: ${applied.join(', ')}`);

  // ---- 自建 Auth（9.8）----
  const jwtSecret = env('JWT_SECRET');
  // 8.3 密钥强度：HS256 弱密钥可被离线爆破。生产拒绝 <32 字节；开发警告放行
  // （.env.local 默认 dev-only-change-me 仅本地，e2e 依赖）
  if (jwtSecret.length < 32) {
    const msg = `JWT_SECRET 过短（${jwtSecret.length} 字节，建议 ≥32：openssl rand -base64 48）`;
    if (process.env['NODE_ENV'] === 'production') throw new Error(msg);
    console.warn(`[server] 警告：${msg}（开发环境放行，生产拒绝）`);
  }
  const jwt = new JwtService({ secret: jwtSecret });
  const store = new PgSessionStore(pool);
  // refresh token 有效期（滑动窗口：每次 /auth/refresh 轮换时按当前 TTL 续期，
  // 只要在 TTL 内启动过一次应用就永不掉线）。REFRESH_TOKEN_TTL_DAYS 可配，
  // 默认 30 天；设长（如 3650）即"长期保持登录"。clamp 上限 3650 天。
  const refreshTtlDays = Number(process.env['REFRESH_TOKEN_TTL_DAYS'] ?? 30);
  const refreshTtlMs =
    Number.isFinite(refreshTtlDays) && refreshTtlDays > 0
      ? Math.min(refreshTtlDays, 3650) * 24 * 60 * 60_000
      : 30 * 24 * 60 * 60_000;
  const sessions = new SessionManager(store, refreshTtlMs);
  const users = new PgUsersStore(pool);
  const devices = new PgDevicesStore(pool);

  // ---- 管理后台（/admin；管理员会话/账号存储，独立于用户域）----
  const adminSessionStore = new PgAdminSessionStore(pool);
  const adminSessions = new AdminSessionManager(adminSessionStore);
  const adminUsers = new PgAdminUserStore(pool);

  // ---- 13.2 邮箱 OTP（事务邮件；devCode 仅限开发环境返回，生产绝不开启）----
  const mailProvider = (() => {
    const smtp = smtpConfigFromEnv();
    if (smtp) {
      console.info(`[server] 邮件已启用：${smtp.host}:${smtp.port}`);
      return createSmtpMailProvider(smtp);
    }
    return createNoopMailProvider();
  })();
  const otp = new OtpService(new PgOtpStore(pool), mailProvider, {
    // dev 开关：可选读取（与 PET_DEV_RESET 同款），缺失时静默关闭，不影响生产启动
    devCodeInResponse: process.env['PET_DEV_OTP_CODE_IN_RESPONSE'] === 'true',
  });

  // ---- 4.3 邀请状态机（auth 注册绑定 + admin 运营邀请共用同一实例）----
  // claimUrlBase 与 registerWaitlistRoutes 同一环境变量：admin 发放与公开路由发同一链接
  const waitlistService = new WaitlistService(pool, mailProvider, {
    claimUrlBase: process.env['WAITLIST_CLAIM_URL_BASE'],
  });

  // ---- 自建 Realtime（9.2/9.4）----
  // 暂停校验：管理后台 suspend 后已登录连接立即拒绝（重连也挡），与 requireAuth 同语义
  const realtime = new RealtimeServer(jwt, undefined, undefined, async (userId) => {
    const { rows } = await pool.query(
      `select 1 from auth.users where id = $1 and account_status = 'suspended'`,
      [userId],
    );
    return (rows.length ?? 0) > 0;
  });

  // ---- 模型客户端（10.1；密钥只存服务端环境变量 8.3；未配置则 chat 降级骨架）----
  const llmConfig = llmConfigFromEnv();
  if (llmConfig) {
    console.info(`[server] AI 模型已启用：${llmConfig.model}（${llmConfig.baseUrl}）`);
  }
  const llm = llmConfig ? createOpenAiCompatibleClient(llmConfig) : undefined;

  // ---- 嵌入客户端（10.7 向量臂；未配置则记忆检索降级 FTS-only）----
  const embeddingConfig = embeddingConfigFromEnv();
  if (embeddingConfig) {
    console.info(`[server] 嵌入模型已启用：${embeddingConfig.model}（向量检索臂开启）`);
  }
  const embeddingProvider = embeddingConfig
    ? createOpenAiCompatibleEmbeddingClient(embeddingConfig)
    : undefined;

  // ---- 输出审核（12.5 免费 Moderation；未配置密钥则图内规则版兜底）----
  const moderationConfig = moderationConfigFromEnv();
  if (moderationConfig) {
    console.info('[server] 输出审核已启用：OpenAI 兼容 /moderations（12.5）');
  }
  const outputModerator = moderationConfig
    ? createOpenAiCompatibleModerator(moderationConfig)
    : undefined;

  // ---- 记忆存储（10.6 落库/检索/审计；RLS 纵深防御在 store 事务内 set claims）----
  const memoryStore = new PgMemoryExtractStore(pool, embeddingProvider);

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
    retrievalStore: memoryStore, // 同一实例实现双接口（10.7 检索）
    outputModerator,
    otp, // 13.2 邮箱 OTP 登录
    mail: mailProvider, // 13.2 事务邮件（waitlist 确认）
    adminSessions,
    adminSessionStore,
    adminUsers,
    waitlist: waitlistService,
    devReset: process.env['PET_DEV_RESET'] === 'true',
  });

  const port = Number(process.env['PORT'] ?? 8787);
  // 监听地址约束（部署边界）：默认只绑回环，杜绝误配直暴公网；
  // 容器/反代异机场景需显式 PET_BIND_HOST=0.0.0.0（:: 同理），绑定全网卡时高声警告
  const bindHost = process.env['PET_BIND_HOST'] ?? '127.0.0.1';
  if (bindHost === '0.0.0.0' || bindHost === '::') {
    console.warn(
      '[server] 警告：PET_BIND_HOST 绑定全部网卡——仅限容器/反代同机场景，' +
        '务必由防火墙或反向代理限制来源（管理后台 /admin 与业务 API 将对外可达）',
    );
  }
  const server = serve({ fetch: app.fetch, port, hostname: bindHost });

  realtime.attach(server);

  // 11.4 保留期清理（隐私承诺落地）：启动即跑一次 + 每 24h 一次；幂等，失败仅日志
  const runSweep = (): void => {
    runRetentionSweep(pool)
      .then((r) => console.info('[retention] sweep:', JSON.stringify(r)))
      .catch((e) => console.warn('[retention] sweep 失败：', (e as Error).message));
  };
  runSweep();
  setInterval(runSweep, 24 * 60 * 60 * 1000).unref();

  console.info(`[server] listening on ${bindHost}:${port} (ws: /realtime)`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((e) => {
    console.error('[server] 启动失败：', (e as Error).message);
    process.exit(1);
  });
}
