# zeroexo_backend 贡献指南

技术栈：NestJS + Prisma + PostgreSQL + MinIO

## 文件命名约定

所有文件统一使用 kebab-case：

| 文件类型 | 命名风格 | 示例 |
|---------|---------|------|
| 控制器 | kebab-case + `.controller.ts` | `ai-generate.controller.ts` |
| 服务 | kebab-case + `.service.ts` | `api-providers.service.ts` |
| 模块 | kebab-case + `.module.ts` | `sync-events.module.ts` |
| 守卫 | kebab-case + `.guard.ts` | `jwt-auth.guard.ts` |
| 适配器 | kebab-case + `.adapter.ts` | `openai.adapter.ts` |
| DTO | kebab-case + `.dto.ts` | `generate-request.dto.ts` |
| 工具 | kebab-case + `.util.ts` 或 `.ts` | `crypto.util.ts` |

## 目录结构

```
src/
├── modules/          # 业务模块（每个模块独立目录）
│   ├── ai-generate/  # AI 生成代理
│   ├── api-providers/# API 渠道管理
│   ├── auth/         # 认证授权
│   └── ...
├── common/           # 公共模块（Prisma、装饰器、拦截器）
├── config/           # 配置
└── prisma/           # Prisma schema 与迁移
```

## 安全约束

- 后端自动调度绝对禁止向第三方外部服务发起主动心跳探测
- 编辑 API Provider 时 credentials 为空对象不允许发送到后端
- 所有健康检查仅允许管理员手动触发
- 服务配置使用外部 JSON 文件，含 `{root}` 和 `{pgctl}` 路径占位符
