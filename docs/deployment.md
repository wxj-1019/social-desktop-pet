# 部署指南（封测准备）—— 2026-08-02

> 自建后端（D-13）生产部署 + Windows 客户端打包/更新。覆盖 13.1 发行、12.6 成本、8.3 安全基线、11.4 备份。

## 一、VPS 选型（V-10 已定档）

- **2C4G 即可**（400 并发实测 RSS≈84MB，见 poc-window-capabilities.md），预算 $5–15/月
- 建议就近部署（目标用户地区）；带宽 1–5Mbps 起步（月流量 ~19.3GB 占比 <2%）
- Postgres 16 + Node 22 同机部署（单实例设计，9.1）

## 二、后端部署（systemd）

```bash
# 1. 代码与构建（在构建机或服务器上）
pnpm install
pnpm --filter @pet/server build          # → dist/

# 注意监听边界：默认只绑 127.0.0.1（Caddy 反代同机即可）；
# 容器/反代异机需显式 PET_BIND_HOST=0.0.0.0 并配好防火墙/来源限制（见 .env.example）

# 2. 服务器布局
sudo mkdir -p /opt/pet/server /etc/pet /var/backups/pet
# 把 dist/ + migrations/ 传到 /opt/pet/server/
sudo cp deploy/pet-server.service /etc/systemd/system/
sudo cp deploy/pet-server.env.example /etc/pet/pet-server.env
sudo chmod 600 /etc/pet/pet-server.env
sudo vim /etc/pet/pet-server.env          # 填 DATABASE_URL/JWT_SECRET（openssl rand -base64 48）

# 3. 建库（应用层权限为主 + RLS 兜底，0000 兼容层）
createdb pet   # 或 psql -c "create database pet;"
sudo systemctl daemon-reload && sudo systemctl enable --now pet-server
curl -s http://127.0.0.1:8787/healthz    # 首次启动自动应用 migrations（幂等）
```

**反向代理 + HTTPS（13.1 强制：客户端 API/WS 走 HTTPS/WSS）**：Caddy 最省事（自动证书）。
完整样例见 `deploy/Caddyfile`（含 WS 升级、SSE 免缓冲 `flush_interval -1`、管理后台静态托管 + /admin/* 同源反代）：

```caddyfile
api.pet.example {
    reverse_proxy 127.0.0.1:8787 {
        flush_interval -1   # SSE（/chat）流式免缓冲；WS 升级 Caddy 自动透传
    }
}
# 桌面端打包注入 PET_API_BASE=https://api.pet.example（见 §四；CSP 按实际地址动态收紧）
```

## 二·B、快速路径：docker compose（服务器有 Docker 时 5 分钟起）

```bash
# 仓库根（含 docker-compose.yml + apps/server/Dockerfile）
vim docker-compose.yml          # 改 JWT_SECRET（openssl rand -base64 48）；db 密码按需
docker compose up -d --build    # pgvector + server（首次启动自动迁移）
curl -s http://127.0.0.1:8787/healthz   # {"ok":true,"db":"ok"}
```

- 仍需前置 Caddy 提供 HTTPS（compose 内服务只绑本机回环）；数据卷 `pet-pg-data` 持久化
- 两条路径（systemd / compose）二选一；systemd 见 §二，备份恢复命令相同（compose 下 `docker compose exec db pg_dump ...`）
- 镜像构建正确性由 CI `docker-build` job 兜底（本地无 Docker 也能安全迭代 Dockerfile）

## 三、备份（11.4：backupDays=30）

```bash
# systemd timer：每日 03:00
sudo tee /etc/systemd/system/pet-backup.service <<'EOF'
[Unit]
Description=Pet Postgres backup
[Service]
Type=oneshot
EnvironmentFile=/etc/pet/pet-server.env
Environment=BACKUP_DIR=/var/backups/pet
ExecStart=/bin/bash /opt/pet/deploy/backup-postgres.sh
EOF
sudo tee /etc/systemd/system/pet-backup.timer <<'EOF'
[Unit]
Description=Daily pet backup
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl enable --now pet-backup.timer
```

恢复演练（生产每月一次）：`pg_restore --clean -d pet pet-YYYYMMDD.dump`。

## 四、Windows 客户端打包（13.1 按用户安装）

```bash
# 生产分发：打包时烧入服务器地址（多台电脑的桌宠连同一后端的关键开关）
PET_API_BASE=https://api.pet.example pnpm package:win
# 本地开发包（连本机 127.0.0.1:8787）：直接 pnpm package:win
# 产物：apps/desktop/release/AI Pet Setup <版本>.exe（NSIS per-user，无需管理员）
```

**API 地址读取序**（electron.vite.config define 烧入 + session-service 读取）：
运行时环境变量 `PET_API_BASE`（开发/e2e）→ 打包烧入值（生产分发）→ `http://127.0.0.1:8787`（本地模式默认）。
CSP `connect-src` 按 API 地址动态生成（security.ts buildCsp），WS 地址由 API 地址推导——**打包注入后无需其它配置**。

**多机分发流程**：每台电脑安装同一安装包 → 首次启动面板登录（或 OTP 邮箱验证码）→ 自动连接服务器（API/WSS/深链 pet:// 全走 https 域名）→ 管理后台即可看到全部设备与在线状态（设备管理见 admin「用户/设备」页；在线判定 = WS 连接聚合）。

- 安装包需 **Authenticode 签名 + 时间戳**（13.1）；EV 证书 + 云 HSM 选型见 V-11（第 15 周）
- 未签名包会触发 SmartScreen 警告（新发布者 EV 才可豁免）

## 五、更新链路（8.3/13.5：HTTPS + sha256，签名待 V-11）

```bash
# 1. 打包新版本
pnpm package:win
# 2. 生成 manifest（版本 + sha256 + URL）
node tools/build-update-manifest.mjs "apps/desktop/release/AI Pet Setup 1.1.0.exe" "1.1.0" \
  --url "https://updates.example.com/pet/AI%20Pet%20Setup%201.1.0.exe"
# 3. 上传安装包 + manifest.json 到 updates.example.com/pet/
# 4. 服务器环境变量 UPDATE_MANIFEST_URL=https://updates.example.com/pet/manifest.json
```

客户端启动 30s 后静默检查（打包版）；`stable`/`beta` 灰度通道 = manifest 分键。
**注意**：V-11 前 verify 步骤为占位——正式封测前必须补签名链（13.5 更新供应链攻击防护）。

## 六、安全基线核对（8.3）

| 项                                                                   | 状态                                   |
| -------------------------------------------------------------------- | -------------------------------------- |
| 客户端 nodeIntegration:false / contextIsolation / sandbox / 严格 CSP | ✅ 已实现（e2e 断言）                  |
| IPC allowlist + zod 校验                                             | ✅                                     |
| refresh token 只存 safeStorage + 只存哈希（服务端）                  | ✅                                     |
| 模型密钥只存服务端 env                                               | ✅（`llm.ts` 读 env）                  |
| 生产 JWT_SECRET 强随机 + 环境文件 600                                | ⚠️ 部署时执行                          |
| 客户端 connect-src 收紧到 API 域名                                   | ⚠️ 部署时执行（当前 127.0.0.1 开发值） |
| 安装包签名（EV，V-11）                                               | ⏳ 第 15 周                            |

## 七、封测前清单

- [ ] VPS 购买 + systemd 部署 + healthz 通过
- [ ] Caddy/HTTPS + 客户端 PET_API_BASE 指向域名 + CSP 收紧
- [ ] 管理后台部署与账号初始化（`pnpm --filter @pet/server admin:create <email>`；安全基线与运维流程见 [admin-deploy.md](admin-deploy.md)：生产强制 `ADMIN_COOKIE_SECURE`、`PET_TRUST_PROXY`、管理员停用即撤会话）
- [ ] 备份 timer 生效 + 一次恢复演练
- [ ] AI_MODEL_API_KEY 配置（GLM-4-Flash 免费档）或确认骨架降级可接受
- [ ] 安装包 EV 签名（V-11 门禁）或确认封测接受 SmartScreen 警告
- [ ] 更新 manifest 上线 + 客户端静默检查验证
- [ ] 20–30 人 alpha 内测招募（V-15，第 6 周末）
