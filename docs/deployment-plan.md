# 生产部署实施计划 —— 服务器后端 + 管理后台 + 多机桌宠接入

- **状态**：待执行（物料已齐备，等待服务器/域名就绪）
- **日期**：2026-08-22
- **目标**：后端（API + WS + admin API）与管理后台部署到公网服务器；多台电脑安装桌宠客户端，登录后自动连接服务器；运营在管理后台统一管理全部用户/设备/在线状态与社交数据。
- **关联文档**：[deployment.md](deployment.md)（部署指南）· [admin-deploy.md](admin-deploy.md)（管理后台运维）· [../deploy/Caddyfile](../deploy/Caddyfile)（反代样例）· [../docker-compose.yml](../docker-compose.yml)
- **关联提交**：d6d5828（打包烧入 API 地址）、984354b（多实例广播/档案同步）、c63f2db（metrics/限流/羁绊/容器化）

---

## 一、目标架构与现状

### 1.1 目标架构

```
                    ┌────────────── 公网 VPS（2C4G）──────────────┐
                    │                                             │
 桌宠电脑 A ──HTTPS/WSS──▶ Caddy ──▶ Node 后端 :8787 ──▶ Postgres 16
 桌宠电脑 B ──HTTPS/WSS──▶  (443)    │（API/WS/SSE/admin API/   (pgvector)
 桌宠电脑 C ──HTTPS/WSS──▶          │  /healthz //metrics）
                    │               │
 运营浏览器 ────HTTPS───▶ Caddy ──▶ admin 静态站 + /admin/* 同源反代
                    └─────────────────────────────────────────────┘
```

- 桌宠客户端只信任打包烧入的 `https://api.<域名>`；API/WS（`/realtime`）/聊天 SSE/深链验证全走同一域名
- 管理后台独立域名（`admin.<域名>`），静态文件 + `/admin/*` API 同源反代（admin 前端全部用相对路径）
- 多实例扩展已预留（PG LISTEN/NOTIFY 广播 + presence 聚合），首期单实例即可

### 1.2 已就绪物料（无需开发）

| 物料            | 位置                                                             | 说明                                   |
| --------------- | ---------------------------------------------------------------- | -------------------------------------- |
| 服务端镜像/构建 | `apps/server/Dockerfile`、`pnpm --filter @pet/server build`      | 两条部署路径均可用                     |
| compose 编排    | `docker-compose.yml`                                             | pgvector:pg16 + server，含健康检查     |
| systemd 单元    | `deploy/pet-server.service`                                      | Restart=on-failure + 安全加固          |
| 环境变量模板    | `deploy/pet-server.env.example`                                  | 含密钥生成说明                         |
| 反代样例        | `deploy/Caddyfile`                                               | WSS 透传、SSE 免缓冲、admin 托管       |
| 备份脚本        | `deploy/backup-postgres.sh` + timer 模板                         | 每日 pg_dump、30 天保留                |
| 桌面端打包注入  | `PET_API_BASE=... pnpm package:win`                              | define 烧入，CSP/WS 自动跟随（已验证） |
| 可观测性        | `/healthz`（DB 探活）、`/metrics`（Prometheus 文本）、结构化日志 | 均已上线                               |
| 多实例支持      | PG LISTEN/NOTIFY 广播                                            | 未来横向扩容无需改代码                 |

### 1.3 待准备清单（用户侧，阶段 0 完成的输入）

| 项               | 要求                                                                 | 备注                                 |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------ |
| VPS              | 2C4G，Ubuntu 22.04/Debian 12，$5–15/月                               | 400 并发实测 RSS≈84MB，2C4G 充裕     |
| 域名             | 1 个主域名 + 2 条 A 记录：`api.<域名>`、`admin.<域名>` → VPS 公网 IP | Caddy 自动签发 Let's Encrypt 证书    |
| 模型密钥（可选） | `AI_MODEL_API_KEY`（GLM-4-Flash 免费档等 OpenAI 兼容）               | 不配则聊天走骨架降级（明确提示用户） |
| SMTP（可选）     | OTP 邮箱验证码/邀请邮件                                              | 不配则 waitlist 确认信降级为日志     |
| 管理员邮箱       | 1 个                                                                 | `admin:create` 初始化                |

---

## 二、实施阶段总览

| 阶段 | 内容                                  | 依赖 | 预计耗时                | 验收标志                                     |
| ---- | ------------------------------------- | ---- | ----------------------- | -------------------------------------------- |
| 0    | 前置准备（VPS/域名/密钥）             | —    | 0.5–1 天（含 DNS 生效） | SSH 可登录、DNS 解析正确                     |
| 1    | 服务器初始化与安全加固                | 0    | 0.5 小时                | 防火墙仅放行 22/80/443                       |
| 2    | 后端部署（compose 或 systemd 二选一） | 1    | 0.5–1 小时              | `curl /healthz` 返回 `{"ok":true,"db":"ok"}` |
| 3    | HTTPS 反代（Caddy）                   | 2    | 0.5 小时                | `https://api.<域名>/healthz` 200 + 证书有效  |
| 4    | 管理后台部署与初始化                  | 3    | 0.5 小时                | 浏览器登录 admin 成功                        |
| 5    | 桌面端生产包构建与分发                | 3    | 1 小时（含多机安装）    | 任一电脑登录并出现在 admin 设备列表          |
| 6    | 端到端验收                            | 5    | 1–2 小时                | §九场景清单全过                              |
| 7    | 运维就绪（备份/监控/更新流程）        | 6    | 1 小时                  | 备份 timer 生效 + 一次恢复演练               |

**总计约 1–2 个工作日**（不含 DNS 生效与多机内测协调）。

---

## 三、阶段 0：前置准备

1. **购买 VPS**，记下公网 IP；创建非 root 部署用户（`adduser pet && usermod -aG sudo pet`）。
2. **域名 DNS**：添加两条 A 记录（`api`、`admin`）→ VPS IP；等待生效（`nslookup api.<域名>`）。
3. **生成密钥**（本机执行，记入密码管理器）：
   ```bash
   openssl rand -base64 48    # JWT_SECRET（必须 ≥32 字节，生产启动强制校验）
   openssl rand -base64 24    # Postgres pet 用户密码
   ```
4. **开发机确认**：`pnpm install && pnpm typecheck && pnpm test` 全绿（当前基线：1026 单测）。

---

## 四、阶段 1：服务器初始化与安全加固

```bash
ssh pet@<VPS_IP>
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Shanghai

# 防火墙：仅放行 SSH/HTTP/HTTPS（后端 8787 只绑 127.0.0.1，不对公网）
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable

# SSH 加固（可选但建议）：禁密码登录（确认密钥可登录后再开）
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

**验收**：`sudo ufw status` 仅 22/80/443；新开终端密钥登录正常。

---

## 五、阶段 2：后端部署（二选一）

### 路径 A：docker compose（推荐——服务器有 Docker 时最省事）

```bash
# 1) 装 Docker（官方脚本）
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker pet && exit   # 重新登录生效

# 2) 取代码并配置
git clone https://github.com/wxj-1019/social-desktop-pet.git ~/pet && cd ~/pet
cp apps/server/.env.example .env.server.local   # 参考密钥项
vim docker-compose.yml
#   必改：JWT_SECRET=<阶段0生成>
#   建议改：db 两个 pet 密码（POSTGRES_PASSWORD 与 DATABASE_URL 保持一致）

# 3) 起服务（首次自动构建镜像 + 应用全部 migrations，幂等）
docker compose up -d --build
```

**验收**：

```bash
curl -s http://127.0.0.1:8787/healthz          # → {"ok":true,"db":"ok","onlineUsers":0}
curl -s http://127.0.0.1:8787/metrics | head -5   # Prometheus 文本正常输出
docker compose ps                               # db healthy + server running
```

### 路径 B：systemd（无 Docker 时）

按 [deployment.md](deployment.md) §二 执行：Node 22 + 构建 `dist/` → `/opt/pet/server` → `deploy/pet-server.service` → `/etc/pet/pet-server.env`（chmod 600）→ 建库 → `systemctl enable --now pet-server`。

**验收**：同路径 A；另加 `systemctl status pet-server` 为 active。

> 两条路径的后续阶段（Caddy/admin/备份）完全一致。**生产必设**（写入 env / compose environment）：
> `NODE_ENV=production`、`JWT_SECRET`（强随机）、`ADMIN_COOKIE_SECURE=true`（生产缺失拒绝启动）、可选 `PET_TRUST_PROXY=true`（反代后按真实 IP 限流/审计）、`METRICS_TOKEN`（如 /metrics 需经公网采集）。

---

## 六、阶段 3：HTTPS 反代（Caddy）

```bash
sudo apt install -y caddy
sudo cp ~/pet/deploy/Caddyfile /etc/caddy/Caddyfile
sudo vim /etc/caddy/Caddyfile     # 把 api.pet.example/admin.pet.example 替换为真实域名
sudo systemctl reload caddy       # 证书自动签发（首次访问触发，约 10–30s）
```

**验收**：

```bash
curl -s https://api.<域名>/healthz            # 200，证书 Let's Encrypt
# WSS（用浏览器或 wscat）：
npx wscat -c wss://api.<域名>/realtime        # 连接建立（未鉴权会等 auth 消息，不断开即通）
```

> Caddy 样例已含 `flush_interval -1`（SSE 流式免缓冲）与 WS 升级透传，无需额外配置。

---

## 七、阶段 4：管理后台部署与初始化

```bash
# 1) 构建 admin 静态产物（服务器或开发机均可；产物部署到 /opt/pet/admin/dist）
cd ~/pet && pnpm install && pnpm --filter @pet/admin build
sudo mkdir -p /opt/pet/admin && sudo cp -r apps/admin/dist /opt/pet/admin/dist

# 2) 初始化管理员（服务器 repo 目录执行；db 已仅回环暴露 5432 供本机运维命令）
#    pnpm 依赖已就绪（compose build 用的是同一份源码树）
DATABASE_URL=postgres://pet:<密码>@127.0.0.1:5432/pet ADMIN_PASSWORD='<强密码>' \
  pnpm --filter @pet/server exec tsx scripts/admin-create.ts ops@<域名>
# （幂等：账号已存在时退出码非 0，可忽略）

# 3) 生产安全开关复核（admin-deploy.md）：
#   ADMIN_COOKIE_SECURE=true ✅（阶段 2 已设）
#   PET_TRUST_PROXY=true（经 Caddy 后按真实 IP 限流/审计）
```

**验收**：浏览器打开 `https://admin.<域名>` → 登录管理员账号 → 总览页四张统计卡正常渲染。

---

## 八、阶段 5：桌面端生产包构建与分发

```bash
# 开发机（Windows）执行：
pnpm install
PET_API_BASE=https://api.<域名> pnpm package:win
# 产物：apps/desktop/release/AI Pet Setup <版本>.exe（NSIS per-user，无需管理员权限）
```

**分发前自检**（关键正确性验证，30 秒）：

```bash
# 确认服务器地址已烧入产物（应输出你的域名）：
grep -o "https://api.<域名>" apps/desktop/out/main/index.js | head -1
```

**分发方式（内测期）**：直发安装包（网盘/内网共享）；**签名**：未购买 EV 证书（V-11）前，用户首次运行会遇到 SmartScreen 警告——内测可接受并在分发说明中告知"更多信息 → 仍要运行"。

**装机接入**（每台电脑）：安装 → 启动 → 面板点"登录后解锁好友与云端记忆" → 邮箱密码登录（或 OTP 验证码）→ 桌宠出现在桌面且右上角在线。

---

## 九、阶段 6：端到端验收清单

| #   | 场景         | 操作                                                  | 预期                                                              |
| --- | ------------ | ----------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | 登录接入     | 电脑 A 登录 alice、电脑 B 登录 bob                    | 两台桌宠上线；admin「用户」页两账号 `online=true`                 |
| 2   | 实时在线感知 | 关闭电脑 B                                            | A 的好友页 bob 绿点数秒内熄灭（presence.changed）                 |
| 3   | 好友邀请     | A 生成邀请链接发给 B（深链或手动 token）              | 双方成为好友，好友卡片出现                                        |
| 4   | 送礼全链路   | A 送 B 小饼干                                         | B 的桌宠 cheer + 气泡；羁绊进度 +1；admin「社交互动中心」可见事件 |
| 5   | 拜访         | A 拜访 B（挥手）                                      | B 的桌宠 wave 欢迎 + "来看你啦"气泡                               |
| 6   | 聊天         | 任一账号发消息                                        | SSE 流式回复正常（反代不切断长流）                                |
| 7   | 危机协议     | 发送自伤相关句                                        | 回复包含 12356 热线（crisis 三级响应）                            |
| 8   | 跨设备档案   | 电脑 A 调整桌宠大小/角色 → 电脑 B 登录同账号          | B 启动后档案与 A 一致（pets.profile_sync）                        |
| 9   | 设备撤销     | B 换新设备登录                                        | 旧设备云端功能 403（admin「设备」页可查历史）                     |
| 10  | 运营能力     | admin 暂停某账号                                      | 该账号 WS 立即断开、API 403（双保险）                             |
| 11  | 指标         | 抓取 `https://api.<域名>/metrics`（带 METRICS_TOKEN） | 请求数/在线数/连接池指标可见                                      |
| 12  | 断线韧性     | 拔网线 30s 再恢复                                     | 桌宠气泡"网络不在，我先陪你"→恢复后 /sync 增量补齐，不重放历史    |

---

## 十、阶段 7：运维就绪

### 10.1 备份与恢复

- systemd 路径：按 [deployment.md](deployment.md) §三 挂 `pet-backup.timer`（每日 03:00，30 天保留）。
- compose 路径：宿主机 crontab 加 `0 3 * * * cd ~/pet && docker compose exec -T db pg_dump -U pet pet | gzip > /var/backups/pet/pet-$(date +\%F).dump.gz`。
- **上线一周内完成一次恢复演练**：`gunzip -c pet-<日期>.dump.gz | docker compose exec -T db psql -U pet -d pet_restore_test`。

### 10.2 监控

- 存活：外部拨测 `https://api.<域名>/healthz`（UptimeRobot 免费档即可，DB 故障时返回 503）。
- 指标：`/metrics` 接 Prometheus（或免费 Grafana Cloud）；关注 `pet_http_requests_total`（429/529 突增）、`pet_db_pool_connections{state="waiting"}`、`pet_ws_online_users`。
- 日志：`journalctl -u pet-server -f`（systemd）或 `docker compose logs -f server`（JSON lines，按 requestId 串联排障）。

### 10.3 更新流程

- **后端**：`git pull && docker compose up -d --build`（migration 自动应用、幂等；升级窗口建议低峰，WS 会短暂重连，客户端有指数退避）。
- **客户端**：`tools/build-update-manifest.mjs` 生成 manifest → 上传安装包与 manifest → 设 `UPDATE_MANIFEST_URL` → 客户端启动 30s 后静默检查（签名校验待 V-11，见 deployment.md §五）。

### 10.4 多实例扩展（容量触发的后续项）

单实例 2C4G 支撑数百并发；出现瓶颈（CPU 持续 >70%、WS 连接数逼近单进程上限）时：再起 1–2 个 server 实例挂同一 Caddy（round_robin）——跨实例 WS 投递与 presence 聚合已由 PG LISTEN/NOTIFY 支持（`realtime/pubsub.ts`），**无需改代码**，仅需保证实例数 ≤ Caddy 上游配置。

---

## 十一、风险与回滚

| 风险                                         | 缓解                                                                    | 回滚                                          |
| -------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| migration 失败（版本跳跃）                   | 启动前自动迁移为幂等事务；升级前手动 `pg_dump` 一次                     | 恢复备份 + 回退镜像/commit                    |
| Caddy 证书签发失败（DNS 未生效/80 端口不通） | 阶段 0 验证 DNS；ufw 已放行 80                                          | `caddy validate` 排查；暂用 HTTP 调试勿对公网 |
| JWT_SECRET 泄露                              | env 文件 600 权限 + 密码管理器保存；泄露即轮换（全体 refresh 失效重登） | 换 secret 重启                                |
| 未签名安装包被 SmartScreen 拦截              | 内测期分发说明引导；正式封测前走 V-11 EV 签名                           | —                                             |
| SSE 被中间层缓冲（聊天逐字卡顿）             | Caddyfile 已设 `flush_interval -1`                                      | 若用 Nginx 改 `proxy_buffering off`           |
| 单实例进程崩溃                               | systemd Restart=on-failure / compose restart 策略                       | 客户端自动重连 + /sync 补齐，无数据丢失       |

---

## 十二、上线检查清单（Go/No-Go）

- [ ] 阶段 0–6 全部验收项通过
- [ ] `NODE_ENV=production`、`JWT_SECRET` ≥32 字节强随机、`ADMIN_COOKIE_SECURE=true`
- [ ] `/etc/pet/pet-server.env` 或 compose environment 权限收紧（600 / 不入库）
- [ ] ufw 仅 22/80/443；8787 未对公网
- [ ] 备份 timer/crontab 生效，且完成一次恢复演练
- [ ] 外部拨测已挂 `https://api.<域名>/healthz`
- [ ] admin 管理员账号为强密码 + 已试登录
- [ ] 生产安装包自检（grep 烧入域名）通过
- [ ] 分发说明已含 SmartScreen 引导与服务器地址说明
- [ ] （可选）AI_MODEL_API_KEY / SMTP / METRICS_TOKEN 已按需配置

---

## 十三、时间线建议

```
D1 上午  阶段 0–2（VPS 初始化 + 后端起服务，healthz 绿）
D1 下午  阶段 3–4（HTTPS + admin 登录通）
D2 上午  阶段 5（打包 + 2–3 台电脑安装接入）
D2 下午  阶段 6（端到端验收 12 场景）+ 阶段 7（备份/拨测/恢复演练）
```

DNS 生效（最长数小时）与 VPS 购买可提前在前一天完成，实际占用约 1.5 个工作日。
