<p align="center">
  <img src="https://img.shields.io/badge/ZeroExo_Server-v0.1.0-blue?style=for-the-badge" alt="version">
  <img src="https://img.shields.io/badge/NestJS-10-EA2845?style=for-the-badge&logo=nestjs" alt="NestJS">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis" alt="Redis">
</p>

<h1 align="center">ZeroExo Server</h1>

<p align="center">NestJS 后端 API 服务 —— 认证 · 项目管理 · AI 调度 · 素材存储</p>

## 数据库初始化

后端依赖 PostgreSQL 16+，监听 `localhost:5432`。

### 推荐：使用启动器

[ZeroExoLauncher](https://github.com/RenderTool/zeroexo-launcher) 自动管理 PostgreSQL 下载、启动和数据库初始化，无需手动操作。

### 手动初始化

```bash
# 1. 确保 PostgreSQL 已启动并监听 5432 端口
# 2. 创建用户和数据库
set PGPASSWORD=postgres
psql -U postgres -h localhost -f init-db.sql

# 3. 应用 migration 创建表
npx prisma migrate deploy

# 4. 生成 Prisma Client
npx prisma generate
```

数据库信息：用户/库/密码均为 `zeroexo`，与 [.env](.env.example) 中 `DATABASE_URL` 一致。

## 快速开始

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm prisma:studio  # http://localhost:5555
```

## 默认账户

| 角色 | 邮箱 | 密码 |
|------|------|------|
| 超级管理员 | root@zeroexo.com | root123456 |
| 管理员 | admin@zeroexo.com | admin123456 |
| 测试用户 | test@zeroexo.com | test123456 |

> 通过 `pnpm db:seed` 写入

## 服务地址

| 服务 | 地址 |
|------|------|
| API | http://localhost:3000 |
| Swagger | http://localhost:3000/api/docs |
| Prisma Studio | http://localhost:5555 |
