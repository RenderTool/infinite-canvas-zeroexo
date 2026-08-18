# ============================================
# ZeroExo Admin - Dockerfile (多阶段构建)
# ============================================

# ---------- 阶段 1: 构建 ----------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .

# 构建输出到 dist/ (覆盖 vite.config.ts 中的 outDir)
RUN pnpm build -- --outDir dist

# ---------- 阶段 2: 运行 ----------
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html/admin
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
