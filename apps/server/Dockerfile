# syntax=docker/dockerfile:1
# 自建后端镜像（D-13）：构建 workspace 依赖包 → 运行 apps/server。
# 构建上下文必须是仓库根（pnpm workspace 需要 packages/* 源码）：
#   docker build -f apps/server/Dockerfile -t pet-server .
# 本地无 Docker 环境，构建正确性由 CI docker-build job 验证。

# ---- 构建阶段：装 server 依赖闭包 + 逐包 tsc 构建 ----
FROM node:20-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @pet/server...
RUN pnpm --filter @pet/protocol --filter @pet/config --filter @pet/ai-graph run build \
  && pnpm --filter @pet/server run build

# ---- 运行阶段：保留完整 workspace 布局（node_modules 的 @pet/* 链接指向 packages/dist） ----
# 优化点（TODO）：改用 pnpm deploy 产物瘦身；当前优先保证 workspace symlink 结构可靠
FROM node:20-slim
WORKDIR /repo/apps/server
ENV NODE_ENV=production
# 容器内必须绑全部网卡（默认 127.0.0.1 在容器内不可达）；对外仍需反代/防火墙收口
ENV PET_BIND_HOST=0.0.0.0
COPY --from=build /repo /repo
EXPOSE 8787
# cwd=apps/server：启动迁移读 ./migrations（与 systemd 部署的 WorkingDirectory 语义一致）
CMD ["node", "dist/index.js"]
