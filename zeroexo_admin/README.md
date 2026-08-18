<p align="center">
  <img src="https://img.shields.io/badge/ZeroExo_Admin-v1.0.0-blue?style=for-the-badge" alt="version">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react" alt="React">
  <img src="https://img.shields.io/badge/Ant_Design-6-1677FF?style=for-the-badge&logo=antdesign" alt="Ant Design">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite" alt="Vite">
</p>

<h1 align="center">ZeroExo Admin</h1>

<p align="center">ZeroExo 平台管理后台 —— 用户与入驻管理 · AI 渠道配置 · 资源与提示词 · 运营与计费分析</p>

## 功能模块

- **用户管理** — 用户列表、入驻审核、角色管理（RBAC：`super_admin` / `admin` / `operator` / `user`）、回收站。
- **AI 渠道配置** — API 渠道管理（凭据、健康检测、模型与参数模板）、AI 品牌与模型编排、参数模板导入导出。
- **AI 测试工作台** — 基于 SSE 流式的图像 / 视频 / 语音生成测试，支持多渠道参数表单与结果对比。
- **资源与提示词** — 公共提示词库（只读展示、分类统计）、用户资源管理、批量删除与标签筛选。
- **品牌与政策** — 品牌定制、多语言政策（中 / 英 / 日）、站点内容管理。
- **运营与计费** — ECharts 数据看板（运营分析、计费分析）、套餐与定价设置、积分与对账。
- **系统日志** — 操作与运行日志查看、日志清理。

## 快速开始

```bash
npm install
npm run dev      # http://localhost:8080/admin/
npm run build    # 生产构建（tsc + vite build）
npm run lint     # ESLint 检查
```

## 账户说明

初始账户由后端 seed 脚本创建，生产环境通过 `SEED_SUPER_ADMIN_PASSWORD` 环境变量指定超级管理员密码，禁止使用默认凭据。

> 设计规范详见 [DESIGN.md](DESIGN.md)，接口文档由后端 Swagger 提供。
