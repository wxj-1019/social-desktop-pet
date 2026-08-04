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
| 改 AI 流程的一个步骤（分类/检索/生成/审核）     | `packages/ai-graph/src/graphs/chat-flow-nodes.ts` 的对应节点                                                     | 10.1                     |
| 改路由策略（L0–L3/Safety）                      | `chat-flow.ts` 的条件边 + `packages/config/src/routing.ts`                                                       | 10.3                     |
| 改记忆抽取/去重/确认                            | `packages/ai-graph/src/graphs/memory-extract.ts`                                                                 | 10.6                     |
| 改记忆确认 API / 确认卡 UI / "已记住"提示       | `apps/server/src/routes/memories.ts` + `apps/desktop/src/app/memory-confirm-card.tsx`                            | 10.6 / D-3               |
| 改检索算法（hybrid/RRF/时间衰减）               | `packages/ai-graph/src/graphs/memory-retrieval.ts` + `apps/server/src/lib/memory-store.ts`（recallMemories）     | 10.7                     |
| 改记忆中心页（查看/修改/删除/来源）             | `apps/desktop/src/app/memories.tsx` + `apps/server/src/routes/memories.ts`（GET /memories、edit）                | 11.3                     |
| 加一张表 / 改 RLS / 索引                        | `apps/server/migrations/`（新 migration，0003 起自建兼容层）                                                     | 9.9 / 11.2               |
| 加/改一个 HTTP 路由（礼物/拜访/邀请/sync/chat） | `apps/server/src/routes/*.ts`                                                                                    | 9.4 / 6.x                |
| 改登录/刷新/设备撤销（9.8 撤销双保险）          | `apps/server/src/auth/*`（jwt + session）                                                                        | 9.8                      |
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
```

自建后端本地起（D-13；需 Docker 或本地 Postgres 16）：

```bash
docker run -d --name pet-pg -e POSTGRES_PASSWORD=pet -p 5432:5432 postgres:16
cp apps/server/.env.example apps/server/.env.local   # 填 DATABASE_URL
pnpm dev:server          # 自动应用未执行的 migrations（幂等）
```

## 尚未实现（框架阶段留 stub）

- **向量检索臂**：`recallMemories`（memory-store.ts）已实现权限过滤 + FTS 臂；10.7 RRF 融合/时间衰减/importance 打分在 `memory-retrieval.ts` 纯函数完成；向量臂 SQL 就绪（HNSW + `embedding <=> query`），待嵌入服务（模型密钥 + 历史回填）后启用
- **输出审核**：`moderateOutputNode` 直接放行（11.2 第四道输出侧记忆泄漏校验未实现）
- **分类器**：危机预筛为规则版（2026-08-02，crisis-rules.ts）；V-13 自建中文分类器就绪后替换（11.8 三级固定危机话术已落地，含 12356/120/110）
- **10.3 路由分级**：`buildContextNode` 的 routing 仍 L1 scaffold（L0–L3 判定留后续）
- `routes/auth.ts` 密码哈希 scrypt → 生产前换 argon2 + 邮件 OTP（13.2 事务邮件）
- Live2D Cubism SDK 集成 —— 待 V-1 许可确认后引入
- RLS 羁绊记忆成员校验完整策略 —— 后续 migration
- 13.2 邀请邮件（waitlist 落库 + 限流已就绪，发信需邮件供应商）

详见设计稿 14.2 实施路线与决策清单 V 类验证项。
