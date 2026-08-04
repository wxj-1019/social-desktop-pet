# AGENTS.md —— 项目架构地图

> 本文件是给开发者与 AI 协作者的"落点索引"。每个功能该改哪个包，先看这里。
> 配套文档：[设计稿](docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-design.md) · [决策清单](docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-review-checklist.md)
> **2026-08-01 依 D-13**：后端由 Supabase 托管改为自建 Postgres + Node（`apps/server`）。

## 仓库布局

```
ai-social-desktop-pet/
├── apps/desktop/          Electron 桌面端（透明窗 + Live2D + React）
├── apps/server/           自建后端（D-13）：Hono HTTP + WebSocket + 自建 Auth + migrations
├── packages/
│   ├── protocol/          ⭐ 单一真相源：共享类型 + zod schema（客户端/服务端/测试三处复用）
│   ├── config/            feature flags、模型路由、限额/保留期
│   ├── ai-graph/          ⭐ graph engineering：状态图运行时 + chat-flow/memory-extract 图
│   └── ui/                共享 React 组件
├── tooling/{tsconfig,eslint-config}/
└── docs/                  设计稿、调研发现、决策清单
```

## 功能落点速查

| 你要做的事                                      | 改这里                                                                                                           | 设计稿章节               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 加/改一个 AI 输出字段、事件类型、命令、记忆字段 | `packages/protocol/src/*`                                                                                        | 9.3 / 10.2 / 10.5        |
| 改 AI 流程的一个步骤（分类/检索/生成/审核）     | `packages/ai-graph/src/graphs/chat-flow-nodes.ts` 的对应节点 + `input-classifier.ts`（V-13 分类）                | 10.1                     |
| 改路由策略（L0–L3/Safety）                      | `route-rules.ts`（规则判定）+ `chat-flow.ts` 的条件边 + `packages/config/src/routing.ts`                         | 10.3                     |
| 改记忆抽取/去重/确认                            | `packages/ai-graph/src/graphs/memory-extract.ts`                                                                 | 10.6                     |
| 改记忆确认 API / 确认卡 UI / "已记住"提示       | `apps/server/src/routes/memories.ts` + `apps/desktop/src/app/memory-confirm-card.tsx`                            | 10.6 / D-3               |
| 改检索算法（hybrid/RRF/时间衰减）               | `packages/ai-graph/src/graphs/memory-retrieval.ts` + `apps/server/src/lib/memory-store.ts`（recallMemories）     | 10.7                     |
| 改记忆中心页（查看/修改/删除/来源）             | `apps/desktop/src/app/memories.tsx` + `apps/server/src/routes/memories.ts`（GET /memories、edit）                | 11.3                     |
| 加一张表 / 改 RLS / 索引                        | `apps/server/migrations/`（新 migration，0003 起自建兼容层）                                                     | 9.9 / 11.2               |
| 加/改一个 HTTP 路由（礼物/拜访/邀请/sync/chat） | `apps/server/src/routes/*.ts`                                                                                    | 9.4 / 6.x                |
| 改登录/刷新/设备撤销/密码哈希/OTP（9.8 / 13.2） | `apps/server/src/auth/*`（jwt + session + password + otp）+ `routes/auth.ts`                                     | 9.8 / 13.2               |
| 改在线状态/收件箱投递/心跳                      | `apps/server/src/realtime/ws.ts`                                                                                 | 9.2 / 9.4                |
| 改桌宠窗口/穿透/托盘/更新                       | `apps/desktop/electron/main/*`                                                                                   | 8.1–8.7                  |
| 改星屿外观/动作/交互（SVG 角色、动画、气泡）    | `apps/desktop/src/pet/*`（star-isle-visual.tsx 等）                                                              | 星屿设计稿               |
| 改状态审批/动作映射（CHATTING/touch/idle 等）   | `packages/pet-state/src/*`（index.ts + visual-mapping.ts）                                                       | 7.1                      |
| 改双窗口/拖动/托盘（pet+panel 窗、拖拽持久化）  | `apps/desktop/electron/main/*`（window/drag/tray/position）                                                      | 8.1–8.7 / 星屿设计稿     |
| 改桌宠状态机逻辑（转换/动作审批/白名单）        | `packages/pet-state/src/index.ts`（纯逻辑，可单测）                                                              | 7.1                      |
| 改桌宠动画/渲染/气泡                            | `apps/desktop/src/pet/*`（`pet-experience.tsx` 组合 `usePetRuntime`，状态机在 Main 侧 `pet-runtime-controller`） | 7.1–7.3                  |
| 加渲染页（聊天/好友/记忆中心）                  | `apps/desktop/src/app/*`                                                                                         | 6.x                      |
| 改限额/配额/保留期                              | `packages/config/src/limits.ts`                                                                                  | 6.5 / 10.9 / 11.4 / 12.7 |
| 改 feature 开关                                 | `packages/config/src/feature-flags.ts`                                                                           | P0 运维                  |

## 关键约定（勿违反）

1. **类型只有一个真相源**：所有跨端共享的类型/校验放 `@pet/protocol`，其它包只能 `import` 不能重复定义。**不要 import 子路径**（`@pet/protocol/ai` 已移除——统一走根入口，避免 zod 双实例）。
2. **图而非过程函数**：AI 流程（10.1）必须表达为 `@pet/ai-graph` 的状态图节点，不要写成巨型 if/else。新流程分支 = 新条件边。`apps/server` 的 Node 运行时原生加载该图（比 Deno import_map 更顺）。
3. **数据库提交即真相**：业务命令经事务落库 + 写双方 inbox + WebSocket 通知。WS 只是通知，不是真相（9.4）。
4. **RLS 是纵深防御不是主防线**（D-13）：应用层权限校验为主；每个业务事务开头 `set local request.jwt.claims`（`rlsClaimsJson`），RLS 策略（`auth.uid()`，见 0003）兜底。
5. **记忆先权限后检索**：检索必须先 `owner+visibility+purpose+sensitivity+时间有效性+memory_status=active` 过滤，再 hybrid 检索（10.7）。
6. **8.3 安全基线不可放松**：`nodeIntegration:false` / `contextIsolation:true` / `sandbox:true` / 严格 CSP / **IPC 通道必须在 `electron/main/ipc/register.ts` 注册且输入过 zod 校验** / 外部链接交系统浏览器 / **模型供应商密钥只存服务端环境变量**。
7. **审核走免费 Moderation**：输入输出审核不与对话同档付费模型（12.5）。
8. **refresh token 只存哈希**：`refresh_sessions.token_hash = sha256(token)`，明文绝不下落（9.8 轮换即撤销，防重放）。

## 常用命令

```bash
pnpm install          # 装依赖
pnpm dev              # 启动桌面端（electron-vite，renderer 直接吃共享包源码，无需先 build）
pnpm dev:server       # 启动自建后端（apps/server，tsx watch，需 DATABASE_URL）
pnpm migrate          # 应用 apps/server/migrations（需 Postgres 运行中）
pnpm typecheck        # 全 workspace 类型检查（含 references 链）
pnpm --filter @pet/desktop typecheck   # 桌面端单独检查（root 不含 desktop）
pnpm lint             # ESLint
pnpm test             # vitest（alias 到源码，不依赖 dist）
pnpm format           # prettier 格式化（CI 会检查 format:check）
pnpm --filter @pet/desktop build       # 打包桌面端
pnpm bench:ws         # V-10：自建 WS 并发压测（需服务 + BENCH_TOKEN）
pnpm --filter @pet/server backfill-embeddings   # 历史记忆向量回填（需 EMBEDDING_* 配置，幂等）
```

自建后端本地起（D-13；需 Docker 或本地 Postgres 16）：

```bash
docker run -d --name pet-pg -e POSTGRES_PASSWORD=pet -p 5432:5432 postgres:16
cp apps/server/.env.example apps/server/.env.local   # 填 DATABASE_URL
pnpm dev:server          # 自动应用未执行的 migrations（幂等）
```

## 尚未实现（框架阶段留 stub）

- **向量检索臂**：embedding provider 已接入（`apps/server/src/ai/embedding.ts`，EMBEDDING_* 环境变量，OpenAI 兼容协议）；persistMemory 落库 embedding、recallMemories 查询向量生成、`pnpm --filter @pet/server backfill-embeddings` 历史回填（幂等）；未配置密钥时自动降级 FTS-only（RRF 单臂语义不变）
- **输出审核**：规则版已落地（`moderation-rules.ts`：PII/敏感细节拦截 → blocked_reply 阻断路径）；注入 `OutputModerator` 走 12.5 免费 Moderation（含 allowlist 语义核对）的供应商实现待密钥接入
- **V-13 分类器**：LLM 版已落地（`input-classifier.ts`：危机三级 + 类别 + 路由同源分类，**多轮上下文判定**，失败回退规则版；`classifierLlm` 独立注入可走低成本档；`crisis-resources.ts` 本地化热线库）；PsyCrisis-Bench 种子训练版与多轮阈值校准留评测集（V-16）阶段
- Live2D Cubism SDK 集成 —— 待 V-1 许可确认后引入
- 13.2 邀请邮件/状态机：MailProvider + SMTP 已接入（waitlist 报名确认 + 邮箱 OTP 登录，`/auth/otp/request` + `/auth/otp/login`，验证码 sha256 落库/15min TTL/5 次尝试/60s 冷却；`PET_DEV_OTP_CODE_IN_RESPONSE` 仅本地开发返回验证码）；**邀请状态机已落地**（`WaitlistService`：pending → invited（8 位兑换码 sha256 落库 + 邀请邮件 + 30 天过期）→ claim 兑换 joined → register 绑定 claimed_by；invited 超期惰性 expired；`POST /waitlist/invite` 运营端点（WAITLIST_ADMIN_TOKEN，未配置 404）+ `POST /waitlist/claim` 公开兑换 + landing 兑换页）

详见设计稿 14.2 实施路线与决策清单 V 类验证项。
