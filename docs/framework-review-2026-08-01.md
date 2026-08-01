# 项目框架审查报告（2026-08-01）

> 审查对象：monorepo 骨架（81 文件，typecheck/lint/test 已通过）
> 审查方式：外部审查者视角 + 实测验证（非纸面推测）
> 结论：架构方向正确，无致命缺陷；发现 **3 个必须修**（会影响开发/CI/合规）、**7 个建议修**、若干优化点。

---

## 一、实测验证结果（先说事实）

| 验证项                                   | 结果                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm typecheck`（root `tsc -b`）        | ✅ 通过                                                                |
| `pnpm --filter @pet/desktop typecheck`   | ✅ 通过                                                                |
| `pnpm lint`                              | ✅ 通过                                                                |
| `pnpm test`（6 用例，含 graph 条件路由） | ✅ 通过                                                                |
| `pnpm --filter @pet/desktop build`       | ✅ 通过（electron-vite 正常注入 `__dirname`）                          |
| `pnpm format:check`                      | ❌ **首次失败**（19 文件），`pnpm format` 后 ✅                        |
| 干净 clone 后 `pnpm dev`                 | ❌ **会失败**（renderer 依赖 `@pet/ui` 的 dist，而 dist 被 gitignore） |

---

## 二、必须修（3 项，影响开发/CI/合规）

### 🔴 1. CI 不检查 desktop，且不检查格式（两处 CI 缺口）

**问题**：

- `.github/workflows/ci.yml` 只跑根 `pnpm typecheck`，但根 `tsconfig.json` 的 references **不含 `apps/desktop`** → desktop 的类型错误永远不会被 CI 发现（本地单独检查才能发现）。
- CI 第一道 `pnpm format:check` 在我实测时**失败**（19 文件未格式化）→ 当前代码推上去 CI 必红。

**修复**：CI 增加 `pnpm --filter @pet/desktop typecheck`；并已执行 `pnpm format` 消除格式问题。

### 🔴 2. 干净 clone 后 `pnpm dev` 失败（dist 依赖）

**问题**：renderer 通过 `@pet/ui` 的 `exports` 解析到 `dist/`，但 `dist/` 在 `.gitignore` 中。新 clone 后未先 build 直接 `pnpm dev` → Vite 解析失败。

**修复**：dev 脚本加预构建，或 Vite 配置 `resolve.conditions: ['development']` + exports 加 `development` condition 指向源码（社区主流做法，dev 直接吃 TS 源码，无需先 build）。

### 🔴 3. 数据库 RLS：好友间无法读取对方昵称（设计稿 11.1 冲突）

**问题**：`profiles` 表 RLS 策略 `profiles_self_only` 只允许本人访问。但产品需要好友关系双方可见昵称/头像（11.1"好友关系仅关系双方可见"）。当前策略下**好友场景读对方资料会 403**，第 11 周联机开发时必然踩到。

**修复**：为 friendship 双方加联合 SELECT 策略（`EXISTS (SELECT 1 FROM friendships WHERE ... AND status='active')`）。

---

## 三、建议修（7 项，架构/工程实践）

### 🟠 4. Supabase Edge Functions 无法引用 workspace 共享包（架构缺口）

**问题**：AGENTS.md 声称"Edge Functions 从源码直接引用 `@pet/protocol`/`@pet/ai-graph`"，但 **Deno 无法解析 workspace 本地包**（Supabase Functions 运行时只认 URL/npm: 前缀）。chat/index.ts 的 TODO 说"引入 @pet/ai-graph"——当前做不到，第 7 周会卡住。

**修复**：明确方案——(a) 用 `supabase functions build` 的 bundler 配置打包 workspace 包（推荐，bundle 进函数）；或 (b) 用 import map 指向已发布/构建产物。AGENTS.md 需写清楚。

### 🟠 5. protocol 子路径导出存在 zod 双实例风险（休眠）

**问题**：`exports` 暴露 `./ai`、`./memory` 等子路径，与根入口重复导出同一模块。若未来一处 `import from '@pet/protocol'`、另一处 `import from '@pet/protocol/ai'`，在 Node/打包器下可能解析为两份 → zod schema 双实例 → `.instanceof`/`.safeParse` 行为异常。当前无人用子路径（风险休眠），但这是**埋好的雷**。

**修复**：移除子路径导出，统一根入口；或保留子路径但根入口改为 re-export 同一模块引用。

### 🟠 6. IPC 只有发送端没有处理端（8.3 安全要求未闭环）

**问题**：preload 暴露 `setIgnoreMouseEvents/minimize/hide` 等 API，但 main 进程**没有注册任何 `ipcMain` handler**——调用静默失败。且 8.3 要求"IPC 输入使用 Schema 验证 + allowlist"，当前 `IPC_ALLOWLIST` 常量定义了但未实际用于拦截。

**修复**：加 `ipc/register.ts`：为每个 allowlist 通道注册 handler，非法通道报错；用 `@pet/protocol` zod schema 校验 IPC 输入。

### 🟠 7. `resources/live2d` 目录缺失（计划与交付不符）

**问题**：搭建计划里有 `apps/desktop/resources/live2d/` + Manifest 占位，实际未创建。第 3 周 Live2D 集成时需现补。

**修复**：补目录 + `model-manifest.json` 占位（注明许可 V-1 未确认前不放真实模型）。

### 🟠 8. desktop 类型与 renderer 无共享（preload API 类型断裂）

**问题**：preload 定义了 `PetApi` 类型，但 renderer（`tsconfig.web.json` 不含 electron/）无法引用；`app.tsx` 用 `(window as unknown as {...})` 断言绕过——类型安全丢失。

**修复**：建 `src/types/pet-api.d.ts` 全局声明 `window.pet: PetApi`（从 preload 类型 re-export），renderer 获得完整类型。

### 🟠 9. events 表 `room_seq` 无唯一约束

**问题**：9.6 要求 `room_seq` 保证单好友关系内事件顺序，但 migration 里 `(room_id, room_seq)` 未建唯一约束——并发插入可能产生重复序列，破坏顺序保证。

**修复**：`create unique index on events(room_id, room_seq)`。

### 🟠 10. `.env.example` 缺失

**问题**：`.gitignore` 有 `!.env.example` 例外但文件不存在；dev 需要 Supabase URL/key 的环境变量约定。

**修复**：补 `.env.example`（desktop 与 supabase 各一份）。

---

## 四、优化建议（架构层面）

### 💡 A. graph runtime 的三个演进点（不阻塞，但值得规划）

1. **子图真正触发**：chat-flow 的 `approve_action` 只设了 `memoryExtractTriggered: true` 标志，没有真实调度 memory-extract 子图。建议明确触发机制：Edge Function 内 fire-and-forget，或写 `memory_extract_jobs` 表由定时器/队列消费（与 10.6"异步抽取"对齐）。
2. **HITL 中断语义**：runtime 已定义 `interrupt` 事件但节点不消费。D-3 记忆确认是真正的中断点，建议给 runtime 加 `waitForInput`/`resume` 语义（LangGraph interrupt/resume 模式），否则记忆确认只能靠外部状态模拟。
3. **conditional edge 的可视化**：`getStructure()` 已可输出节点/边，建议补 mermaid 导出——`pnpm graph:visualize` 生成 chat-flow 图，直接支持 13.5 评测与演示。

### 💡 B. memory-extract 与 chat-flow 的状态类型不统一

两个图各自定义 state（`ChatFlowState` / `MemoryExtractState`），共享字段（threadId/userId）重复。建议抽 `GraphBaseState`（threadId + spans），两图 extend——与 11.2 审计统一。

### 💡 C. protocol 的测试覆盖不足

6 个测试全在 protocol 的 ai schema 与 ai-graph。protocol 的 memory/events/commands/safety/domain schema 未测。建议按"契约即测试"补 `schema.test.ts`（每个 schema 一个 happy path + 一个 reject case），成本低收益高——schema 是边界，错了全线崩。

### 💡 D. vitest 只测 packages，desktop renderer 无测试环境

CI 的 `pnpm test` 不含 renderer（无 jsdom/vitest-environment）。建议加 `vitest.workspace` 或 renderer 独立测试配置（第 3 周有 UI 后必然需要）。

### 💡 E. AGENTS.md 与 README 的准确性问题

- AGENTS.md 的"Edge Functions 从源码直接引用 @pet/protocol"（问题 4）不实；
- README 的 CI 徽章指向的 workflow 实际会红（问题 1）。

---

## 五、优先级总表

| 优先级  | 编号 | 问题                                   | 修复成本                     |
| ------- | ---- | -------------------------------------- | ---------------------------- |
| 🔴 必须 | 1    | CI 不查 desktop + format 门禁失败      | 低（CI 脚本）                |
| 🔴 必须 | 2    | 干净 clone 后 dev 失败                 | 中（dev condition 或预构建） |
| 🔴 必须 | 3    | RLS 好友无法读对方资料                 | 低（一条 SQL）               |
| 🟠 建议 | 4    | Edge Functions 引用 workspace 包不可行 | 中（bundler 配置）           |
| 🟠 建议 | 5    | protocol 子路径 zod 双实例             | 低                           |
| 🟠 建议 | 6    | IPC 无 handler、allowlist 未生效       | 低                           |
| 🟠 建议 | 7    | resources/live2d 缺失                  | 低                           |
| 🟠 建议 | 8    | preload API 类型断裂                   | 低                           |
| 🟠 建议 | 9    | events room_seq 无唯一约束             | 低                           |
| 🟠 建议 | 10   | .env.example 缺失                      | 低                           |
| 💡 优化 | A–E  | 子图调度/HITL/可视化/类型统一/测试覆盖 | 规划中                       |

---

## 六、结论

框架**方向正确、质量门禁真实有效**（typecheck/lint/test 全绿），graph engineering 落点（状态图 + checkpoint + spans）与设计稿 10.1/11.2/13.5 契合。但存在 **3 个必修复问题**：CI 覆盖缺口、dev 工作流依赖 dist、RLS 好友读取冲突——它们不会在"当前"暴露（骨架不跑联机、不跑 CI），但会在第 3 周（dev）、第 11 周（联机）、首次 push（CI）时分别炸掉。**建议在进入 14.2 第 3 周实现前一次性修完必修复项 + 低成本建议项（4–10），共约半天工作量。**
