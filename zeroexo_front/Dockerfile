# ============================================
# ZeroExo Frontend (Canvas) - Dockerfile (多阶段构建)
# 构建上下文: zeroexo_front/
# ============================================

# ---------- 阶段 1: 构建 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖配置文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/ packages/

# 安装依赖
RUN npm install -g pnpm@9.15.0 && pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建
RUN pnpm build

# ---------- 阶段 2: 运行 ----------
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 80

ENTRYPOINT ["entrypoint.sh"]