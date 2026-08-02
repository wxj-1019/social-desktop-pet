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

| 层       | 技术                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 桌面端   | Electron + electron-vite + React + TypeScript                             |
| 表现     | Live2D Cubism SDK for Web（许可待确认）                                   |
| 后端     | 自建（D-13）：Postgres 社区版 + Node（Hono HTTP + WebSocket + 自建 Auth） |
| 记忆     | PostgreSQL + pgvector（HNSW + hybrid 检索）                               |
| Graph    | 自研轻量状态图运行时（`@pet/ai-graph`，LangGraph 启发，依赖无关）         |
| Monorepo | pnpm workspaces                                                           |

> **后端选型（2026-08-01 依 D-13）**：放弃 Supabase 托管改为自建 Postgres + Node——软件费 0（VPS 成本见设计稿 12.6）；9.9 migrations（纯 SQL + pgvector）原样复用，记忆检索方案不变；AI Gateway 直接在 Node 服务跑 `@pet/ai-graph`。

## 快速开始

前置：Node ≥ 20.11、pnpm ≥ 9。

```bash
pnpm install
pnpm format:check  # 格式化检查（CI 门禁）
pnpm typecheck     # 类型检查（含 references 链）
pnpm test          # 单测（alias 到源码不依赖 dist）
pnpm dev           # 启动桌面端（renderer 直接吃共享包源码，无需先 build）
pnpm test:e2e      # e2e（需后端运行；Electron 单实例锁 → workers=1）
```

自建后端（需本地 Postgres 16+ 或 Docker）：

```bash
docker run -d --name pet-pg -e POSTGRES_PASSWORD=pet -p 5432:5432 postgres:16   # 或使用本机 Postgres
cp apps/server/.env.example apps/server/.env.local   # 填 DATABASE_URL / JWT_SECRET
pnpm dev:server        # 启动（自动应用未执行的 migrations，幂等）
pnpm migrate           # 手动应用 migrations
pnpm bench:ws          # V-10 WS 压测（需 BENCH_TOKEN）
pnpm package:win       # 打包 Windows 安装包（NSIS per-user，13.1）
```

## 为什么自研 graph runtime 而非直接用 LangGraph.js

1. 设计稿 10.1 是固定 DAG（非自由 agent 探索），轻量 runtime（~300 LOC）足够且更可控
2. 依赖无关 → 可在 Node（`apps/server` 原生加载）/ 浏览器（测试）两处复用
3. 节点函数保持纯函数，未来可无痛迁移到 LangGraph.js

运行时见 [`packages/ai-graph/src/runtime/`](packages/ai-graph/src/runtime/)，核心图定义见 [`chat-flow.ts`](packages/ai-graph/src/graphs/chat-flow.ts)。

## 首只真实桌宠：星屿

> 2026-08-03 已落地并 e2e 验证（star-isle.spec.ts 7 例全绿；全部 17 例 e2e 通过）。

- **React SVG 原创角色**：星尾狐猫"星屿"由原生 React SVG 绘制（`apps/desktop/src/pet/star-isle-visual.tsx`），非贴图、非 Live2D
- **启动即见**：无需登录即可显示、拖动、摸头（touch 动作）、本地模式聊天（气泡回复）
- **双击打开面板**：双击星屿身体打开面板窗（登录页/聊天/好友页）
- **穿透恢复**：手动开启整窗穿透后，只能通过托盘菜单恢复（`toggle-pass-through`；8.4 不可恢复事故为 0）
- **不使用 PetDex/Live2D 资产**：仅借鉴其交互思路（透明浮窗/拖动/气泡），角色、代码、素材全部原创（见设计稿星屿章节边界）
- **平台**：Windows 10/11 优先（CI 已加 `star-isle-windows` job 真机验证）；macOS 待后续
- 拖动位置持久化：重启后按保存的位置还原（`position-store`）

## 项目结构

见 [AGENTS.md](AGENTS.md) 的"功能落点速查"表——每个功能该改哪个包一目了然。

## 状态

**2026-08-02：14.2 第 1–2 周 PoC 已闭环，第 3–6 周 Alpha 骨架完成度高。**

- 后端（自建 Postgres + Node）：Auth/邀请/礼物/拜访/sync/chat(SSE) 全链路真实可用，WS 实时推送
- 桌面端：登录/好友/聊天/深链邀请/本地降级全部可用；8 控制器齐备
- 已通过：单测 135、e2e 10/10、V-10 压测（400 并发）、资源基线（RSS 288MB ≤300MB）
- 封测准备：`pnpm package:win` 出安装包；部署指南见 [docs/deployment.md](docs/deployment.md)

当前状态速览与交接要点见 [docs/status-2026-08-02.md](docs/status-2026-08-02.md)，业务逻辑按 [设计稿 14.2 实施路线](docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-design.md) 推进。

## 许可

UNLICENSED（私有项目）。
