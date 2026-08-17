# 管理后台部署说明

## 前置条件

- Postgres 16+ 已迁移（`pnpm migrate`，包含 0015_admin_console.sql）
- 服务端已启动（`pnpm dev:server` 或打包部署）
- 管理员账号已初始化（`pnpm --filter @pet/server admin:create <email>`）

## 开发环境

```bash
pnpm dev:server   # 后端 :8787（含 /admin/* API）
pnpm dev:admin    # 前端 :5175（vite proxy /admin → 8787）
```

浏览器打开 http://localhost:5175 → 用 `admin:create` 创建的账号登录。

## 内网部署

```bash
# 1. 构建前端
pnpm --filter @pet/admin build
# 产物：apps/admin/dist/（静态文件）

# 2. 配置 Nginx/Caddy 托管静态文件 + 反向代理 API
# Nginx 示例：
# location /admin/ {
#   proxy_pass http://127.0.0.1:8787;  # API
# }
# location / {
#   root /path/to/apps/admin/dist;     # 静态文件
#   try_files $uri /index.html;
# }
```

## 安全基线

- 后端只监听内网/回环地址，或反向代理层限制来源网段（`allow` 指令）
- HTTPS 下设置 `ADMIN_COOKIE_SECURE=true`（cookie Secure 标志）
- 管理员密码 ≥12 位，存储为 argon2id 哈希（密钥只存环境变量）
- 公网部署前需：HTTPS + 来源限制 + 二次验证（后续迭代）

## 审计

所有写操作与敏感数据读取记录在 `admin_audit_log` 表，查询入口为后台"审计日志"页。审计日志只追加，不提供删除接口。

## 敏感数据

聊天/记忆原文默认不可见（只显示截断摘要）。查看原文必须填写理由，系统签发 5 分钟一次性授权，读取后立即失效并记入审计。后台不提供批量导出。
