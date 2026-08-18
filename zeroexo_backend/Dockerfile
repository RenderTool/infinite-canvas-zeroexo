# ============================================
# ZeroExo Backend - Dockerfile (多阶段构建)
# ============================================

# ---------- 阶段 1: 构建 ----------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ---------- 阶段 2: 运行 ----------
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# 以非 root 用户运行(安全加固): node 镜像自带 node 用户,
# storage 目录授权给 node 用户,保证运行时文件写入可用
RUN mkdir -p /app/storage && chown -R node:node /app
USER node

EXPOSE 3000

# 健康检查: 每 30s 检测,超时 10s,重试 3 次后标记不健康
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["pnpm", "start"]
