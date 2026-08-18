# 优化落地方案（2026-08-14）

> 来源：4 路并行只读审查（桌面端 / 后端+AI 图 / 工程化依赖 / 协议+状态机+测试），覆盖全部 188 个源文件与 78 个测试文件；🔴 级发现均已回读源码逐条验证。
> 原则：每阶段独立可交付、自带验收标准（DoD）；先修"静默失效"与部署断链，再修用户可见问题，最后做升级与清理。

---

## 阶段 0 —— 修复后端构建断链（部署起不来）

**问题**：`apps/server/tsconfig.json:7` 为 `"noEmit": true` + `outDir:"out"`，而 `package.json` 的 `main/build/start` 指向 `./dist/index.js`；实测 `dist/`、`out/` 均不存在 → `pnpm --filter @pet/server build` 零产物，`deploy/pet-server.service` 与 `docs/deployment.md` 的部署链路全部 ENOENT。

**改动**：

| 文件                                      | 改动                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/server/tsconfig.build.json`（新增） | `extends` 原配置，`noEmit:false`、`outDir:dist`、`composite:false`、`declaration:false` |
| `apps/server/package.json`                | `build` 改 `tsc -p tsconfig.build.json`；`typecheck` 保持 `tsc -b`（noEmit 语义不变）   |
| `.github/workflows/ci.yml` quality job    | 追加 `pnpm --filter @pet/server build` 门禁                                             |
| 根 `package.json` `build` 脚本            | server 段由"只 typecheck"改为真实 build（见阶段 7.5 一并理顺）                          |

**DoD**：

- [ ] `pnpm --filter @pet/server build` 产出 `apps/server/dist/index.js`
- [ ] `node apps/server/dist/index.js`（无 DATABASE_URL 时）报预期错误而非 ENOENT
- [ ] CI quality job 含 server build 步骤

---

## 阶段 1 —— 修"静默失效"生产 bug（P0 正确性）

### 1.1 输出审核接线（12.5 从未生效）

**问题**：`apps/server/src/index.ts:101-108` 创建 `outputModerator`（:167-169）却未传入 `createBusinessRouter` → `BusinessDeps.outputModerator` 恒 undefined，配了 `MODERATION_API_KEY` 也静默走规则版。
**改动**：`:101-108` 补 `outputModerator: deps.outputModerator`；`apps/server/src/routes/chat.test.ts` 加"注入 moderator 后图内被调用"的断言。
**DoD**：新测试验证注入的 mock moderator 被 chat 流调用；`pnpm test` 绿。

### 1.2 WebSocket 稳定性（error + 心跳）

**问题**：`apps/server/src/realtime/ws.ts:49-53` 无 `error` 监听（单客户端异常可崩整个进程）；服务端从不 ping，僵尸连接永不清理（第 8 行注释声称有 ping/pong 但实现只是应答客户端）。
**改动**：`connection` 与 `handleAuth` 后均 `ws.on('error', () => ws.close())`；`attach` 后 `setInterval` 定期 `ws.ping()` + 无 pong 则 `terminate()`（interval 随 wss close 清理，可注入开关便于测试）。
**DoD**：新增 ws 测试（模拟 error 事件不抛、超时未 pong 连接被移除）；`pnpm test` 绿。

### 1.3 输出审核时序（先展示后审核）

**问题**：`packages/ai-graph/src/graphs/chat-flow-nodes.ts:235-239` 先流式 emit 全部 token，`moderateOutputNode`（:266）在其后才跑 → 命中 PII 的回复已被用户完整看到。
**改动**：`generateNode` 改为缓冲完整 `parsed.dialogue` 后一次性返回（不逐 chunk emit token），由 `moderate_output` 审核通过后新增一个 `stream_reply` 节点负责流式 emit；或保留逐 chunk 但审核前置为"边生成边审"（推荐前者，改动面小）。
**DoD**：新增测试断言"审核拦截时客户端未收到任何 token"；现有 chat-flow 测试按新 emit 时序更新。

> 2026-08-17 验证结论：当前代码与测试已满足该 DoD。生产图执行顺序为 `generate -> moderate_output -> approve_action -> stream_reply`；阻断路径不经过 `stream_reply`，因此在审核拦截时客户端不会收到任何 token。见 `packages/ai-graph/src/graphs/chat-flow.ts:112-123`、`packages/ai-graph/src/graphs/chat-flow-nodes.ts:318-331`、`packages/ai-graph/src/graphs/chat-flow.test.ts:302-318`。

### 1.4 更新链路（静默失败 + prerelease 比较）

**问题**：`apps/desktop/electron/main/update-source.ts:36-42` fetch 拒绝/`res.json()` 抛错/挂起无超时 → 违反"失败按无更新"契约；manifest 只 `as` 强转。`update-controller.ts:71` prerelease 用字符串比较（`beta.10 < beta.9`）。
**改动**：`checkForUpdate` 包 try/catch 返回 null + `AbortSignal.timeout(10_000)` + zod `UpdateManifestSchema`；`compareSemver` prerelease 按 `.` 分段数字感知比较（自实现 ~15 行，或引 `semver` 包）。
**DoD**：补 fetch 拒绝 / 畸形 JSON / 挂起超时 / `1.0.0-beta.10 vs 1.0.0-beta.9` 四个测试。

### 1.5 记忆抽取图异常降级

**问题**：`packages/ai-graph/src/graphs/memory-extract.ts:196-199, 275-287` 两处 `llm.streamChat` 无 try/catch → 模型瞬时故障让子图 reject（fire-and-forget 未处理拒绝直通 server）。
**改动**：两处包 try/catch，分别回退 `{candidates:[]}` / `{action:'ADD'}`（对齐 `input-classifier.ts:127-136` 的既有范式）。
**DoD**：新增"抛异常 llm → 图仍到 END 且不 reject"测试。

**阶段 1 DoD 汇总**：`pnpm typecheck && pnpm test` 全绿；新增/更新测试 ≥ 8 条。

---

## 阶段 2 —— 修用户可见问题

### 2.1 'moved' 路径覆盖缩放

**问题**：`window-controller.ts:190-196` 'moved' → `toPersistedPosition`（scale 恒 1）→ `schedulePetPositionSave`（`index.ts:148-154`）250ms 后直接 `positionStore.save()` 覆盖用户缩放；`savePetPosition`（:168-177）却正确保留 scale。
**改动**：`schedulePetPositionSave` 改为 `positionStore.save({ ...position, scale: positionStore.load().scale })`；两条保存路径收敛共用同一"合并 scale"辅助函数。
**DoD**：`position-store`/`window-controller` 相关测试补"moved 保存后 scale 不变"断言。

### 2.2 好友页 WS 抖动 + 事件重复

**问题**：`apps/desktop/src/app/friends.tsx:117-131` WS 效应依赖 `[pullSync, refreshFriends]`，`pullSync` 依赖 `lastSeq` → 每次游标推进都 close 重连；轮询与 `onEvent` 并发读同一 `lastSeq` → 同一批事件 append 两次。
**改动**：`lastSeq` 放入 ref；`pullSync` 读 ref 并加 in-flight 守卫（进行中直接 return）；WS 效应依赖稳定回调。
**DoD**：friends 组件测试补"轮询与实时并发不重复"与"游标推进不重建 WS"断言。

**阶段 2 DoD 汇总**：`pnpm --filter @pet/desktop typecheck && pnpm test` 绿。

---

## 阶段 3 —— 认证与安全加固

| #   | 改动                                                                                                                                                                                                                                      | 落点                                                                                            | 验收                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 3.1 | login/register 加 IP+账号滑动窗口限流与失败锁定；OTP 轮换冷却改指数退避 + /otp/login IP 限流                                                                                                                                              | `apps/server/src/routes/auth.ts`、`apps/server/src/auth/otp.ts`                                 | 路由测试：连续失败 429/锁定；60s 内多次 request 冷却延长                |
| 3.2 | 设备撤销双保险（`active_display_device_id`）收进 `requireAuth` 中间件（按 userId 查询并缓存），全局生效                                                                                                                                   | `apps/server/src/routes/business.ts`                                                            | 被停用设备调 /chat、/gift、/sync 均 403 的测试                          |
| 3.3 | CSP `connect-src` 收紧为显式后端源（`127.0.0.1:8787` + 配置的 API 域名）；main 侧 `webRequest.onHeadersReceived` 追加响应头级 CSP；两窗口加 `setWindowOpenHandler(() => deny)` + `will-navigate` 拦截                                     | `apps/desktop/src/index.html`、`apps/desktop/electron/main/security.ts`、`window-controller.ts` | 新增 `security.test.ts` 钉住 SECURE_WEB_PREFS 三件套与 allowlist 无重复 |
| 3.4 | `JWT_SECRET` 启动时校验 ≥32 字节；register/login/refresh/revoke 的 `c.req.json()` 统一 `.catch(() => ({}))`；email 小写归一；`limit` 参数 `Number.isFinite` + clamp [1,200]；register/login 复用 `@pet/protocol` 的 Session*PayloadSchema | `apps/server/src/index.ts`、`routes/auth.ts`、`routes/chat.ts:268`、`routes/memories.ts:302`    | 畸形 JSON/参数返回 400 而非 500 的测试；大小写邮箱合并测试              |

**阶段 3 DoD 汇总**：`pnpm test` 绿；新增安全相关测试 ≥ 8 条；`pnpm lint` 绿。

---

## 阶段 4 —— 数据库与一致性

| #   | 改动                                                                                                                                                       | 落点                                                        | 验收                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| 4.1 | `deliverEvent` 改为返回待通知列表，由路由层在 `commit` 之后推 WS（外部事务不再提前推送）                                                                   | `apps/server/src/lib/inbox.ts:83-95` + 各路由               | 测试：commit 失败时收件人未收到 WS 事件          |
| 4.2 | 好友房间加确定性唯一键 + insert-on-conflict 幂等创建                                                                                                       | `apps/server/src/lib/relationships.ts:70-93` + 新 migration | 并发建房间测试只产生一行                         |
| 4.3 | RLS 落地：文档化非 owner 数据库角色；关键表 `FORCE ROW LEVEL SECURITY`；所有业务事务统一 `set_config('request.jwt.claims')`                                | migrations + 各 routes/store                                | 用受限角色跑 /me、/friends、/memories 的集成测试 |
| 4.4 | embedding 计算移出 DB 事务（先算后落库；或落库后异步补 + 回填脚本幂等）                                                                                    | `apps/server/src/lib/memory-store.ts:176-184`               | 并发落库时连接池不被打满（压测或代码审查）       |
| 4.5 | 保留期清理任务：过期 `refresh_sessions`、超期 `chat_messages`（90 天）、`command_receipts`/`memory_audit_log` 上限；用 `packages/config` 的 RETENTION 常量 | 新 `apps/server/src/lib/retention.ts` + 启动定时器          | sweep 测试：过期行被删、保留期内行不动           |
| 4.6 | `recallMemories` 补 **sensitivity** 权限维度（如 friend_visit 排除 high）                                                                                  | `apps/server/src/lib/memory-store.ts:76-80`                 | SQL 断言测试含 sensitivity 条件                  |

**阶段 4 DoD 汇总**：新 migration 可幂等应用（`pnpm migrate`）；相关单测绿；e2e 后端用例可跑通。

---

## 阶段 5 —— 配置收敛与成本保护

| #   | 改动                                                                                                                                                                | 落点                                                                                               | 验收                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 5.1 | `visitsPerFriendPerDay=3` 在 visit.ts 落地（按 user+friend+day 配额）；`dailyTokenBudgetPerUser` 改为按 `token_estimate` 比对；`aiEnabled` kill switch 在路由层先判 | `apps/server/src/routes/visit.ts`、`chat.ts:126-154`                                               | 配额超限 429 测试；kill switch 关闭时 chat 降级骨架 |
| 5.2 | `retrievalTopKForLevel` 改读 `@pet/config` 的 `DEFAULT_ROUTE_TABLE.memoryRetrievalTopK`（L0/SAFETY→0），删本地 3/6 常量                                             | `packages/ai-graph/src/graphs/memory-retrieval.ts:81-84`                                           | ai-graph 测试断言读 config 值                       |
| 5.3 | `ACTION_REPLIES` 与 `ACTION_COMMANDS` 合并为一份导出表（含 intent/reply）；`DAILY_GIFT_LIMIT`、2000 字符上限移入 `packages/config/src/limits.ts`                    | `chat-flow-nodes.ts:151-159`、`route-rules.ts`、`gift.ts:31`、`chat.ts:170`、`memories.ts:114/354` | 表驱动测试覆盖每个命令映射                          |
| 5.4 | `moderation.ts:71` allowlist 死分支：删除或对真实类目实现并正向测试                                                                                                 | `apps/server/src/ai/moderation.ts`                                                                 | 死分支清理后测试仍绿                                |

**阶段 5 DoD 汇总**：`pnpm typecheck && pnpm test` 绿；配置消费方测试 ≥ 5 条。

---

## 阶段 6 —— 测试基建加固（防回归）

| #   | 改动                                                                                                                                       | 落点                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 6.1 | chat-flow 测试打真实生产图：`buildChatFlow` 支持注入 classify/route 替身节点；删除手写复制条件边                                           | `packages/ai-graph/src/graphs/chat-flow.test.ts:46-60, 79-93, 389-407`                               |
| 6.2 | 补错误路径：保守 OR（LLM 判 none+规则判 high）、moderator 抛错回退规则版、输出侧危机分支、`chat-flow-nodes.ts:64-79` 改为不原地改 `merged` | `chat-flow.test.ts`、`chat-flow-nodes.ts`                                                            |
| 6.3 | `crisis-rules.ts:54-57` minor_risk 收紧为有意图语境（或降为 low）；补正/负用例（"我弟弟是小学生"不触发）                                   | `crisis-rules.ts` + 测试                                                                             |
| 6.4 | flaky 治理：固定 sleep 改 `vi.waitFor` 探针；`afterEach(() => vi.useRealTimers())`；MAIL mock 改 per-test/beforeEach clear                 | `chat-memory.test.ts:151`、`mail.test.ts:84`、`chat.test.ts:8-23`、`waitlist.test.ts`、`otp.test.ts` |
| 6.5 | protocol 收窄：`payload: z.unknown()` 建 type→schema 判别注册表（复用 discriminatedUnion 模式）；持久化契约补 version 字段或 ADR           | `packages/protocol/src/events/index.ts:31`、`commands/index.ts:19`                                   |

**阶段 6 DoD 汇总**：全量测试连跑 3 次无 flake；覆盖新增 ≥ 12 条。

---

## 阶段 7 —— 升级与清理

| #   | 改动                                                                                                                                                                                                                        | 风险控制                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 7.1 | Electron 33 → 当前稳定线（约 43）+ 同步 electron-builder                                                                                                                                                                    | 先升 desktop 单独跑 star-isle e2e；注意 `webContents` API 变更点 |
| 7.2 | Node 20 → 22/24：`package.json` engines + CI `actions/setup-node`                                                                                                                                                           | 本地已用 22.17 验证无碍                                          |
| 7.3 | vite 5 → 6/7 + electron-vite 2 → 3/4（desktop 与 landing 同步）                                                                                                                                                             | 构建产物 diff 检查；HMR dev 冒烟                                 |
| 7.4 | 死依赖清理：`@pet/ui`（全仓零消费，归档或摘出 build）、desktop 的 `@pet/config`、landing 的 `@pet/protocol`、`@types/pngjs`                                                                                                 | `pnpm -r exec` 无残留 import 后删除                              |
| 7.5 | root build 语义理顺 + landing 纳入 CI（typecheck/build）；CI 加固：concurrency 分组、timeout-minutes、`permissions: contents: read`、e2e retries 1-2；Linux e2e job 起 Postgres + `pnpm dev:server` 跑全量或收缩为本地 spec | CI 全绿为准                                                      |
| 7.6 | stale Supabase 引用清理（.prettierignore / eslint-config ignores / .gitignore / docs / 根 package.json 描述）；删除根目录空文件 `{`；`clean` 脚本去掉 `                                                                     |                                                                  | true` 并修正路径；`.npmrc`加`engine-strict=true` | `pnpm format:check && pnpm lint` 绿 |

**阶段 7 DoD 汇总**：本地 `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @pet/desktop build && pnpm --filter @pet/server build` 全绿；CI 三个 job 全绿。

---

## 明确暂缓（有意不做）

- **React 19 / zod 4 / vitest 3-4 / pnpm 10**：迁移成本与收益需单独评估，当前版本无功能缺陷（报告 #10 判定"可暂缓"）。
- **Live2D Cubism SDK**：待 V-1 许可确认（框架期 stub 保留）。
- **多实例 WS 升级 Redis pub/sub**：首版单实例够用（9.1 已注明）。
- **向量检索/输出审核的供应商实测**：需真实密钥，属 P2 验证项（AGENTS.md 已列）。

## 执行建议

- 阶段 0-1 优先（部署断链 + 静默失效），约半天工作量；阶段 2 紧随（用户可见）。
- 阶段 3-5 涉及行为变更，改完各自跑 `pnpm test`，其中 4.3（RLS）建议在验证环境先行。
- 阶段 6 与 1/2 有重叠（如 6.1 的注入式 buildChatFlow 是 1.3 时序改动的测试前提），可合并推进。
- 每阶段单独提交 PR，CI 全绿后再进下一阶段。
