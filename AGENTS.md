# AGENTS.md —— 项目架构地图

> 本文件是给开发者与 AI 协作者的"落点索引"。每个功能该改哪个包，先看这里。
> 配套文档：[设计稿](docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-design.md) · [决策清单](docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-review-checklist.md)

## 仓库布局

```
ai-social-desktop-pet/
├── apps/desktop/          Electron 桌面端（透明窗 + Live2D + React）
├── packages/
│   ├── protocol/          ⭐ 单一真相源：共享类型 + zod schema（客户端/Edge Functions/测试三处复用）
│   ├── config/            feature flags、模型路由、限额/保留期
│   ├── ai-graph/          ⭐ graph engineering：状态图运行时 + chat-flow/memory-extract 图
│   ├── supabase/          DB migrations（9.9 schema + RLS + pgvector）+ Edge Functions
│   └── ui/                共享 React 组件
├── tooling/{tsconfig,eslint-config}/
└── docs/                  设计稿、调研发现、决策清单
```

## 功能落点速查

| 你要做的事                                      | 改这里                                                       | 设计稿章节               |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| 加/改一个 AI 输出字段、事件类型、命令、记忆字段 | `packages/protocol/src/*`                                    | 9.3 / 10.2 / 10.5        |
| 改 AI 流程的一个步骤（分类/检索/生成/审核）     | `packages/ai-graph/src/graphs/chat-flow-nodes.ts` 的对应节点 | 10.1                     |
| 改路由策略（L0–L3/Safety）                      | `chat-flow.ts` 的条件边 + `packages/config/src/routing.ts`   | 10.3                     |
| 改记忆抽取/去重/确认                            | `packages/ai-graph/src/graphs/memory-extract.ts`             | 10.6                     |
| 改检索算法（hybrid/RRF/时间衰减）               | `chat-flow-nodes.ts` 的 `retrieveMemoryNode`                 | 10.7                     |
| 加一张表 / 改 RLS / 索引                        | `packages/supabase/db/migrations/`（新 migration）           | 9.9 / 11.2               |
| 加/改一个后端命令（礼物/拜访/邀请/sync）        | `packages/supabase/functions/<name>/index.ts`                | 9.4 / 6.x                |
| 改桌宠窗口/穿透/托盘/更新                       | `apps/desktop/electron/main/*`                               | 8.1–8.7                  |
| 改桌宠动画/状态机/气泡                          | `apps/desktop/src/pet/*`                                     | 7.1                      |
| 加渲染页（聊天/好友/记忆中心）                  | `apps/desktop/src/app/*`                                     | 6.x                      |
| 改限额/配额/保留期                              | `packages/config/src/limits.ts`                              | 6.5 / 10.9 / 11.4 / 12.7 |
| 改 feature 开关                                 | `packages/config/src/feature-flags.ts`                       | P0 运维                  |

## 关键约定（勿违反）

1. **类型只有一个真相源**：所有跨端共享的类型/校验放 `@pet/protocol`，其它包只能 `import` 不能重复定义。**不要 import 子路径**（`@pet/protocol/ai` 已移除——统一走根入口，避免 zod 双实例）。
2. **图而非过程函数**：AI 流程（10.1）必须表达为 `@pet/ai-graph` 的状态图节点，不要写成巨型 if/else。新流程分支 = 新条件边。
3. **数据库提交即真相**：业务命令经 Edge Function 事务落库 + 写双方 inbox + Realtime 通知。Realtime 只是通知，不是真相（9.4）。
4. **记忆先权限后检索**：检索必须先 `owner+visibility+purpose+sensitivity+时间有效性+memory_status=active` 过滤，再 hybrid 检索（10.7）。
5. **8.3 安全基线不可放松**：`nodeIntegration:false` / `contextIsolation:true` / `sandbox:true` / 严格 CSP / **IPC 通道必须在 `electron/main/ipc/register.ts` 注册且输入过 zod 校验** / 外部链接交系统浏览器。
6. **审核走免费 Moderation**：输入输出审核不与对话同档付费模型（12.5）。
7. **Edge Functions 引用共享包**：`packages/supabase/functions/import_map.json` 已把 `@pet/protocol` 等映射到源码，`config.toml` 已开 `bundle=true`——新增函数直接 `import { ... } from '@pet/protocol'`，无需复制代码。

## 常用命令

```bash
pnpm install          # 装依赖
pnpm dev              # 启动桌面端（electron-vite，renderer 直接吃共享包源码，无需先 build）
pnpm typecheck        # 全 workspace 类型检查（含 references 链）
pnpm --filter @pet/desktop typecheck   # 桌面端单独检查（root 不含 desktop）
pnpm lint             # ESLint
pnpm test             # vitest（alias 到源码，不依赖 dist）
pnpm format           # prettier 格式化（CI 会检查 format:check）
pnpm --filter @pet/desktop build       # 打包桌面端
```

Supabase（需本地 CLI 与 Docker，项目根在 packages/supabase）：

```bash
cd packages/supabase
supabase start           # 启动本地栈
supabase db reset        # 应用 migrations
supabase functions serve # 本地跑 Edge Functions（bundle 共享包）
```

## 尚未实现（框架阶段留 stub）

- 节点内真实逻辑（模型调用 / 分类器 / 检索 / 生成）—— 第 7-10 周
- Live2D Cubism SDK 集成 —— 待 V-1 许可确认后引入
- RLS 羁绊记忆成员校验完整策略 —— 后续 migration
- Edge Functions 的鉴权与事务 —— 第 11-14 周

详见设计稿 14.2 实施路线与决策清单 V 类验证项。
