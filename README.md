# 跨平台 AI 社交桌宠

> 一只会记住你、也能去好友电脑旅行的 AI 桌宠。
> 面向真实好友共同养成的跨平台桌面陪伴产品。

[![CI](https://img.shields.io/badge/CI-typecheck%20%7C%20lint%20%7C%20test-brightgreen)](.github/workflows/ci.yml)

## 这是什么

一款 Windows + macOS 的 Electron 桌宠，差异化在于：

- **异步跨电脑拜访** —— 桌宠去好友桌面旅行（未发现任何已上线产品支持此功能）
- **可治理的 AI 记忆** —— 私人记忆与共同记忆分表、分权、分场景检索；用户可见、可改、可删
- **graph engineering** —— AI 流程建模为显式状态图（loop engineering 的进阶），可观测、可重放、可恢复

完整产品规格见 [设计稿](docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-design.md)。

## 技术栈

| 层       | 技术                                                              |
| -------- | ----------------------------------------------------------------- |
| 桌面端   | Electron + electron-vite + React + TypeScript                     |
| 表现     | Live2D Cubism SDK for Web（许可待确认）                           |
| 后端     | Supabase（PostgreSQL + RLS + Realtime + Edge Functions）          |
| 记忆     | PostgreSQL + pgvector（HNSW + hybrid 检索）                       |
| Graph    | 自研轻量状态图运行时（`@pet/ai-graph`，LangGraph 启发，依赖无关） |
| Monorepo | pnpm workspaces                                                   |

## 快速开始

前置：Node ≥ 20.11、pnpm ≥ 9。

```bash
pnpm install
pnpm format:check  # 格式化检查（CI 门禁）
pnpm typecheck     # 类型检查（含 references 链）
pnpm test          # 单测（含 graph runtime 自测，alias 到源码不依赖 dist）
pnpm dev           # 启动桌面端（renderer 直接吃共享包源码，无需先 build）
```

Supabase 后端（需 [Supabase CLI](https://supabase.com/docs/guides/cli) 与 Docker，项目根在 `packages/supabase`）：

```bash
cd packages/supabase
supabase start        # 启动本地栈
supabase db reset     # 应用 migrations（9.9 schema + RLS + pgvector）
supabase functions serve  # 本地跑 Edge Functions（bundle 共享包）
```

## 为什么自研 graph runtime 而非直接用 LangGraph.js

1. Supabase Edge Functions 跑在 Deno，LangGraph.js 偏 Node 有兼容风险
2. 设计稿 10.1 是固定 DAG（非自由 agent 探索），轻量 runtime（~300 LOC）足够且更可控
3. 依赖无关 → 可在 Deno / Node / 浏览器（测试）三处复用
4. 节点函数保持纯函数，未来可无痛迁移到 LangGraph.js

运行时见 [`packages/ai-graph/src/runtime/`](packages/ai-graph/src/runtime/)，核心图定义见 [`chat-flow.ts`](packages/ai-graph/src/graphs/chat-flow.ts)。

## 项目结构

见 [AGENTS.md](AGENTS.md) 的"功能落点速查"表——每个功能该改哪个包一目了然。

## 状态

框架阶段（可编译可跑空窗口），业务逻辑按 [设计稿 14.2 实施路线](docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-design.md) 推进。

## 许可

UNLICENSED（私有项目）。
