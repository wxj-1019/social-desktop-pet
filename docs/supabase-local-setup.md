# Supabase 本地环境准备（V-10 Presence 计费实测前置）

> 对应设计稿 14.2 第 1–2 周门禁：Supabase Auth/Realtime/RLS PoC + V-10 Presence 计费实测
> 本机状态：**Docker 未安装**（2026-08-01 检查）——以下步骤需要你执行

---

## 1. 安装 Docker Desktop（必需，一次性）

Supabase 本地栈跑在 Docker 容器里，`supabase start` 的硬依赖。

1. 下载安装：[Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
   - 系统要求：Windows 10/11 x64，需开启 **WSL2**（安装向导会引导）
   - 安装后重启，启动 Docker Desktop 等待右下角显示 "Engine running"
2. 验证：命令行执行 `docker --version` 应输出版本号

> 若公司网络受限装不了 Docker Desktop：可用 Supabase 云端免费项目替代实测（见 §4 备选），
> 或联系管理员开通（V-10 属于门禁硬性项，不可跳过）。

## 2. 启动本地栈（CLI 已装好，2.111.0）

```bash
cd E:\A_Project\ai-social-desktop-pet\packages\supabase
supabase start
```

首次启动会拉取镜像（几分钟）。成功输出类似：

```
Started supabase local development setup.
         API URL: http://127.0.0.1:54321
          anon key: eyJhbGciOiJIUzI1NiIs...
```

## 3. 应用 migrations 并跑 V-10 实测

```bash
# 应用 0001_init + 0002_fix_rls_and_sequences（自动执行）
supabase db reset

# 设置环境变量（anon key 用上一步输出）
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=eyJhbGci...

# 跑 V-10 Presence 计费实测（20 连接 × 60 秒，心跳 10s）
pnpm bench:presence --clients 20 --duration 60

# 加压：100 连接 × 300 秒，模拟封测规模（观察连接稳定性 + 消息速率）
pnpm bench:presence --clients 100 --duration 300
```

实测结果自动追加到 `docs/poc-window-capabilities.md`（V-10 节）。

## 4. 若 Docker 装不了：云端备选

1. 注册 [supabase.com](https://supabase.com)（免费项目即可）
2. 创建项目 → 拿到 Project URL + anon key
3. 在 Dashboard → SQL Editor 执行 `packages/supabase/migrations/*.sql`
4. 跑同一压测脚本（`SUPABASE_URL/SUPABASE_ANON_KEY` 换成云端值）
   - ⚠️ 云端实测会产生真实 Realtime 消息（免费档有限额），先用 `--clients 10 --duration 30` 小规模验证
   - ⚠️ 云端数据不得包含真实用户数据（合规：未完成评估前不向服务商发送，见 11.10）

## 5. 完成后回填

| 项                | 记录位置                                  |
| ----------------- | ----------------------------------------- |
| Presence 实测报告 | `docs/poc-window-capabilities.md` V-10 节 |
| 12.6 成本区间回填 | 设计稿 12.6（按实测消息量 × $2.50/1M）    |
| 决策清单 V-10     | 勾选"□ 确认"                              |
| 第 1–2 周门禁     | Supabase PoC 退出项通过                   |

## 6. 常用命令速查

```bash
supabase start          # 启动本地栈
supabase stop           # 停止
supabase db reset       # 重置数据库（应用全部 migrations）
supabase status         # 查看 URL/key
supabase functions serve --env-file .env.local  # 本地跑 Edge Functions
```
