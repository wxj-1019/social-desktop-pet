# AI Social Desktop Pet 管理后台设计

- 日期：2026-08-18
- 状态：待实现
- 范围：单管理员、用户与设备、运行与用量、聊天与记忆原文、运营邀请

## 1. 目标

为运营人员提供一个独立的 Web 管理后台，统一查看和控制所有已登录桌宠账号及设备，观察运行与模型用量，管理 waitlist/邀请，并在有明确理由且经过临时授权时处理聊天和记忆原文。

后台不直接连接 Postgres。所有操作通过 `apps/server` 的管理 API 完成；服务端负责管理员鉴权、业务权限、事务、敏感数据保护和审计。

首期部署按“先本机/内网、后公网”设计。首期只支持一个管理员账号，但 API 不依赖裸的运营 token，未来可扩展角色模型和二次验证。

## 2. 非目标

首期不做：

- 多管理员 RBAC 和权限委托；
- 聊天/记忆原文批量导出或下载；
- 任意 SQL、数据库浏览器或数据直接编辑器；
- 对在线桌宠下发动作、远程控制窗口或实时操控；
- 完整 BI 报表编辑器；
- 管理员 TOTP/硬件密钥（为公网阶段预留接口，但不阻塞内网首期）。

## 3. 总体架构

新增独立前端应用 `apps/admin`：

```text
浏览器
  │ HTTPS / 本机 HTTP
  ▼
apps/admin（React + Vite）
  │ /admin/* API
  ▼
apps/server（Hono）
  ├── admin auth/session
  ├── admin routes + audit
  ├── existing user/business routes
  └── Postgres
```

管理 API 与普通桌宠用户 API 使用不同认证边界：

- 普通用户 access token 不能访问 `/admin/*`；
- 管理员 access token 不能调用普通用户身份接口；
- 管理员 refresh token 只存哈希，并通过 HttpOnly、Secure、SameSite cookie 保存；
- 开发环境后台可使用 `http://localhost:5175`；生产环境建议由 Nginx/Caddy 将后台和 API 放在同一 HTTPS 域名下，减少 CORS 与 cookie 配置风险。

## 4. 数据模型

新增 migration，沿用 `apps/server/migrations/` 的幂等迁移约定。

### 4.1 `admin_users`

```text
id              uuid primary key
email           text unique not null
password_hash   text not null
status          active | disabled
last_login_at   timestamptz
created_at      timestamptz not null
updated_at      timestamptz not null
```

密码使用现有 Argon2id 密码模块。管理员初始账号不写入 migration、`.env.example` 或仓库，通过一次性 CLI 初始化，例如 `pnpm --filter @pet/server admin:create`。

### 4.2 `admin_sessions`

```text
token_hash      text primary key
admin_id        uuid references admin_users(id) on delete cascade
expires_at      timestamptz not null
revoked_at      timestamptz
created_at      timestamptz not null
last_seen_at    timestamptz
```

刷新时轮换 token，旧 token 立即撤销，防止重放。数据库永不保存明文 refresh token。

### 4.3 `admin_audit_log`

```text
id              uuid primary key
admin_id        uuid references admin_users(id)
action          text not null
resource_type   text not null
resource_id     uuid/text
reason          text
request_ip      inet/text
metadata        jsonb not null default '{}'
created_at      timestamptz not null
```

日志只追加，不提供删除接口。管理员登录、刷新/撤销、账号暂停/恢复、设备撤销、邀请操作、敏感数据授权和读取都必须记录。

### 4.4 普通账号状态

为 `auth.users` 增加：

```text
account_status       active | suspended
suspended_at         timestamptz
suspended_reason     text
```

暂停账号的事务必须：更新账号状态、撤销该账号全部 refresh session、将设备标记为 revoked、断开 Realtime 连接并写审计日志。恢复账号只恢复登录能力，不自动恢复已撤销设备。

### 4.5 敏感访问授权

新增 `admin_sensitive_grants`，避免把敏感查看权限只放在内存中：

```text
grant_id             uuid primary key
admin_id             uuid references admin_users(id)
target_user_id       uuid references auth.users(id)
resource_type        chat | private_memory | bond_memory
resource_scope       jsonb not null
grant_token_hash      text unique not null
reason               text not null
expires_at           timestamptz not null
used_at              timestamptz
created_at           timestamptz not null
```

`grant_id`/token 绑定管理员、目标用户、资源类型和范围，默认 5 分钟有效、单次使用。服务端只保存 token 哈希；读取后立即写 `used_at` 并审计。

## 5. 管理 API

### 5.1 管理员认证

```text
POST /admin/auth/login
POST /admin/auth/refresh
POST /admin/auth/revoke
GET  /admin/auth/me
```

登录使用邮箱/密码；失败按 IP 和账号双重限流并支持短时锁定。access token 只在前端内存中使用，refresh token 走 HttpOnly cookie。

### 5.2 总览、用户和设备

```text
GET  /admin/overview
GET  /admin/users?q=&status=&page=&pageSize=&sort=
GET  /admin/users/:userId
POST /admin/users/:userId/suspend
POST /admin/users/:userId/restore
GET  /admin/users/:userId/devices
POST /admin/devices/:deviceId/revoke
```

列表响应只返回运营需要的字段：用户 ID、邮箱、昵称、账号状态、注册时间、设备数、在线/最近在线、最近用量和异常标记。禁止返回密码哈希、refresh token、JWT、模型密钥和完整敏感原文。

设备撤销后复用现有设备撤销语义，旧设备无法刷新/继续调用需要活动设备的业务接口。

### 5.3 运行与用量

```text
GET /admin/usage?from=&to=&userId=&model=&page=
GET /admin/usage/users/:userId?from=&to=
```

首期基于 `chat_usage` 和现有聊天/错误数据提供请求量、token 估算、限额命中、模型路由、成功/失败分类和时间趋势。服务端统一分页和最大时间范围，避免后台查询压垮业务库。

### 5.4 运营邀请

```text
GET  /admin/waitlist?status=&q=&page=
POST /admin/waitlist/:id/invite
POST /admin/waitlist/:id/expire
```

复用现有 `WaitlistService` 和邀请邮件链路；每次邀请、过期和失败都记录审计。运营 token 仅作为兼容旧运营端点的过渡，不作为后台登录凭证。

### 5.5 聊天、记忆和敏感授权

默认接口只返回统计和脱敏摘要：

```text
GET  /admin/users/:userId/chat-summary?from=&to=&page=
GET  /admin/users/:userId/memories-summary?status=&page=
POST /admin/sensitive-access
GET  /admin/sensitive-access/:grantId/content
```

`POST /admin/sensitive-access` 必须接收查看理由、目标用户、资源类型和明确范围。服务端校验管理员会话、资源边界和理由长度，生成一次性 grant。内容接口校验 grant 所有者、目标用户、资源类型、过期时间和未使用状态；成功读取后立即失效。禁止跨用户范围 grant 和批量导出。

### 5.6 审计

```text
GET /admin/audit-log?adminId=&action=&resourceType=&from=&to=&page=
```

查询支持时间、管理员、动作、资源类型和目标资源过滤。审计记录只追加，敏感访问的“授权申请”和“实际读取”分别记录。

## 6. 页面信息架构

`apps/admin` 使用固定侧栏 + 顶部环境/管理员状态 + 主区数据表格/详情抽屉的运营控制台布局，不使用营销式大卡片堆叠。

### 总览

展示注册用户数、活跃设备数、最近 24 小时聊天量、错误率、限额命中、待处理邀请。异常项可跳转到对应筛选结果。

### 用户管理

支持邮箱/昵称/userId 搜索、账号状态筛选、最后在线排序、分页。用户详情抽屉展示基础资料、设备、宠物/好友概览、用量摘要、邀请状态和审计入口。

暂停、恢复和设备撤销都需要确认；暂停账号必须填写理由。

### 运行与用量

支持时间范围、用户、模型、状态过滤；表格提供请求量、估算 token、限额命中、失败原因和最近请求时间。图表只做固定的趋势与分布，不做可编辑 BI。

### 聊天与记忆

默认显示数量、时间、分类、敏感度和脱敏摘要。查看原文按钮必须打开理由表单，显示授权范围和 5 分钟倒计时；读取后页面清空临时授权，不保留到 localStorage。

### 运营邀请

展示 waitlist 状态、报名时间、邀请时间、兑换时间、过期时间和邮件结果。邀请/过期使用明确的状态按钮和确认反馈。

### 审计日志

使用可筛选的追加事件表，展示时间、管理员、动作、资源、理由和结果。敏感访问突出显示，但不在审计列表中嵌入原文。

## 7. 安全与隐私规则

- `/admin/*` 使用独立管理员 middleware；普通用户 JWT 一律 403；
- 开发/内网阶段限制监听地址或由反向代理限制来源；公网阶段强制 HTTPS；
- 所有写操作使用服务端参数化 SQL 和事务；
- 管理列表使用最大 page size、最大时间范围和查询超时保护；
- 登录、刷新、敏感授权和高风险写操作按 IP/账号限流；
- 原文不进入前端持久化、浏览器下载或普通错误日志；
- 审计日志只记录必要 metadata，不写入密码、token 或完整模型密钥；
- 管理员停用后撤销全部管理员 refresh session；
- 数据保留遵循现有 retention 策略，后台不提供绕过保留期的删除操作。

## 8. 错误处理

统一返回结构化错误：

- `401 admin_unauthorized`：未登录或会话失效；
- `403 admin_forbidden`：权限边界或资源范围不允许；
- `404 not_found`：资源不存在；
- `409 state_conflict`：状态转换冲突；
- `422 invalid_input`：筛选、理由或操作参数非法；
- `429 rate_limit`：触发限流；
- `503 admin_temporarily_unavailable`：后台依赖暂不可用。

前端遇到 401 自动尝试一次 refresh，失败后回到管理员登录页；写操作失败保留表单输入但不自动重试，避免重复执行。

## 9. 测试和验收

### 服务端

- migration 可重复执行；
- 管理员登录、刷新轮换、撤销和停用；
- 普通用户 token 访问 `/admin/*` 返回 401/403；
- 暂停账号阻断新登录、撤销会话、撤销设备并断开 WS；
- 设备撤销后旧设备无法刷新；
- 敏感 grant 绑定管理员/用户/资源，过期和重复读取失败；
- 每个高风险写操作和敏感查看写入审计；
- 分页、时间范围、限流、错误响应和事务回滚有单测；
- 列表响应不会泄露密码哈希、token、JWT 或模型密钥。

### 前端

- 管理员登录与会话恢复；
- 用户、设备、用量、waitlist、审计列表的搜索/筛选/分页；
- 暂停、恢复、设备撤销和邀请操作的确认/错误/成功状态；
- 敏感内容默认脱敏，理由提交、倒计时、读取后失效完整；
- 空数据、加载、网络错误、401 过期和 403 权限错误完整；
- Playwright 验证管理员登录、暂停用户、撤销设备和审计记录出现。

## 10. 分阶段交付

### P0：安全基础和可登录后台

- migration：管理员表、会话表、审计表、账号状态、敏感 grant；
- admin auth middleware、登录/刷新/撤销；
- `apps/admin` 骨架、登录页、总览空状态；
- 管理员初始化 CLI；
- 服务端认证和越权测试。

### P1：统一管理核心

- 用户/设备列表与详情；
- 账号暂停/恢复、设备撤销；
- 用量总览和用户用量；
- waitlist/邀请管理；
- 审计日志列表。

### P2：敏感数据处理

- 聊天和记忆脱敏摘要；
- 一次性敏感访问授权；
- 原文读取审计与前端倒计时；
- 端到端测试和内网部署说明。

## 11. 验收标准

设计完成后的首期后台满足：

1. 单管理员可以安全登录并恢复会话；
2. 可以搜索、查看和分页管理所有用户及其设备；
3. 可以暂停/恢复账号，撤销设备，且普通用户旧会话按预期失效；
4. 可以查看运行、用量、邀请和审计信息；
5. 聊天/记忆原文默认不可见，临时授权、理由、过期和审计完整；
6. 普通用户 token 无法访问后台；
7. 迁移、单测、前端测试和关键 Playwright 流程通过；
8. 后台不直接暴露数据库，不泄露密码、token、JWT、模型密钥或不必要的敏感原文。
