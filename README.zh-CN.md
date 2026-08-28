<p align="center">
  <img src="https://img.shields.io/badge/ZeroExo_Platform-v1.2.0-6c5ce7?style=for-the-badge" alt="version">
  <img src="https://img.shields.io/badge/Active_Development-yellow?style=for-the-badge" alt="active development">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/NestJS-10-EA2845?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
</p>

<h1 align="center">ZeroExo Platform</h1>

<p align="center">
  全栈、AI 驱动的画布平台。从创意到分镜、从镜头到成片，一个平台端到端完成。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="#产品模块">产品模块</a> · <a href="#路线图">路线图</a> · <a href="#快速开始">快速开始</a>
</p>

---

> **早期开发** — API、界面与数据模型会频繁变更。欢迎贡献与反馈。

### 核心亮点

- **无限画布** — 自研 React DOM 引擎，节点编排、多级 LOD、网格空间索引
- **AI 出片流水线** — 剧本 → 分镜 → 镜头 → 成片；每个节点可 AI 对话
- **实时协作** — Yjs CRDT + Hocuspocus，离线优先、时间戳冲突变基

### 最新预览（v1.2.0）

| 提示词查看器（生成链路画布） | 流式画布编辑 |
|---|---|
| ![提示词查看器](./docs/screenshots/canvas/提示词查看器.jpg) | ![流式画布编辑](./docs/screenshots/canvas/流式画布编辑.jpg) |

## 产品模块

| 前端画布 | 管理后台 |
|---|---|
| ![前端画布](docs/screenshots/frontend/前端首页.webp) | ![管理后台](docs/screenshots/admin/后台首页.webp) |

ZeroExo 是一个**全栈项目**。前端 React 画布是核心产品，后端 NestJS 驱动的管理后台提供运营控制能力 — 前后端分离，一体部署。

### 首页

![首页](docs/screenshots/frontend/前端首页.webp)

### 画布能力展示

| 画布概览 | 快捷键 | 节点样式配置 |
|---|---|---|
| ![画布概览](docs/screenshots/canvas/画布概览.webp) | ![画布快捷键](docs/screenshots/canvas/画布快捷键.webp) | ![节点样式配置](docs/screenshots/canvas/画布节点样式配置.webp) |

| 调试与协作 | 项目工程开发配套 Agent | Agent 自我升级与维护 |
|---|---|---|
| ![调试和协作](docs/screenshots/canvas/debug和协作.webp) | ![项目工程开发配套Agent](docs/screenshots/canvas/项目工程开发配套Agent.webp) | ![Agent自我升级项目维护一体](docs/screenshots/canvas/Agent自我升级项目维护一体.webp) |

### 动态演示（画布操作）

**实时协作编辑**

多人同时在线编辑同一画布，基于 Yjs 与 Hocuspocus 实现实时同步与离线优先本地持久化，操作结果即时可见。

![实时协作编辑](docs/screenshots/frontend/前端画布协作.gif)

**堆叠节点收纳**

将多个节点一键聚合为堆叠节点，支持展开、切换与移出，实现节点的分组管理与紧凑排布。

![堆叠节点收纳](docs/screenshots/frontend/前端画布堆叠.gif)

**节点快速定位**

通过节点导航控件快速定位与聚焦画布节点，提升大规模画布下的浏览与编辑效率。

![节点快速定位](docs/screenshots/frontend/前端画布导航.gif)

**层级面板与双击聚焦**

层级面板以树状结构总览节点关系，双击节点即时聚焦视口，兼顾全局视图与局部编辑。

![层级面板与双击聚焦](docs/screenshots/canvas/画布层级面板和双击聚焦.gif)

**多语言切换**

一键实时切换中文、英文、日文界面语言。

![多语言切换](docs/screenshots/frontend/多语言切换.gif)

**画布换肤**

在浅色与深色主题间自由切换，所有页面 UI 元素随主题完整适配。

![画布换肤](docs/screenshots/frontend/画布换肤.gif)

### 前端 — 画布（核心）

画布编辑器是平台的核心模块，覆盖「剧本 → 分镜 → 镜头 → 成片」的完整制作流程：

| 模块 | 说明 |
|------|------|
| 画布核心 | 视口平移缩放、网格空间索引、多级 LOD 渲染、节点订阅、节点/边选中与编辑、分组 / 排列 / 尺寸 / 层序工具 |
| 节点系统 | 视频、图片、文本、堆叠与生成节点；按类型配置颜色与图标；每个节点可 AI 对话 |
| 画布协作 | Yjs + Hocuspocus 实时同步、在线状态感知、离线优先本地持久化、基于时间戳的冲突 rebase |
| AI 出片 | 智能体停靠栏、流式思考 UI、画布智能体（分镜 / 镜头 / 题材分析）、支持 @ 提及的 AI 对话创作 |
| 分镜与剧本 | 富文本剧本编辑器、分镜集数、镜头列表、剧本导入与转换 |
| 素材与提示词 | 素材库、可收藏的提示词库、资源同步（云优先） |

#### 界面预览

| 登录页 | 首页 | 白色主题 |
|---|---|---|
| ![登录页](docs/screenshots/frontend/前端登录页.webp) | ![首页](docs/screenshots/frontend/前端首页.webp) | ![白色主题](docs/screenshots/frontend/前端白色主题.webp) |

| 剧本编辑 | 剧本与分镜 | 分镜编辑 |
|---|---|---|
| ![剧本编辑页](docs/screenshots/frontend/前端剧本编辑页.webp) | ![剧本和分镜](docs/screenshots/frontend/前端剧本和分镜.webp) | ![分镜编辑页](docs/screenshots/frontend/前端分镜编辑页.webp) |

| 提示词库 | 素材库 | 画布管理 |
|---|---|---|
| ![提示词](docs/screenshots/frontend/前端提示词.webp) | ![素材库管理页](docs/screenshots/frontend/前端素材库管理页.webp) | ![画布管理页](docs/screenshots/frontend/前端画布管理页.webp) |

### 管理后台

平台运营控制面：

- API 渠道管理（凭据、健康检测、用户级密钥）
- 用户管理与入驻审核（RBAC：`super_admin` / `admin` / `operator` / `user`）
- 提示词库、品牌定制、多语言政策
- 基于 ECharts 的运营与计费数据看板

#### 界面预览

| 后台首页 | 站点运营 | 用户资产权限管理 |
|---|---|---|
| ![后台首页](docs/screenshots/admin/后台首页.webp) | ![站点运营](docs/screenshots/admin/后台管理站点运营.webp) | ![用户资产权限管理](docs/screenshots/admin/后台管理用户资产权限管理.webp) |

| API 渠道管理 | 渠道详情 | 存储 |
|---|---|---|
| ![API渠道管理](docs/screenshots/admin/后台API渠道管理.webp) | ![渠道详情](docs/screenshots/admin/后台API渠道管理具体页.webp) | ![存储](docs/screenshots/admin/后台存储页.webp) |

| 站点管理 | 日志 | 邮件服务 |
|---|---|---|
| ![站点管理](docs/screenshots/admin/后台站点管理.webp) | ![日志](docs/screenshots/admin/后台日志.webp) | ![邮件服务](docs/screenshots/admin/后台管理邮件服务.webp) |

### 后端 API

NestJS + Prisma 服务层：认证与 refresh 轮换、基于角色的守卫、AI 渠道编排（密钥 AES-256-GCM 加密存储）、SSE 流式、素材存储（MinIO / 本地）、协作后端、计费与数据分析。

> 后端为画布编辑器与管理后台提供能力支撑，模块说明详见各子项目 README。

## 路线图

按优先级推进：

1. **智能拉片拆片** — 输入参考视频，自动拆分为镜头 / 场景 / 分镜。
2. **百万小说智能拆解** — 长篇小说一键结构化拆解为章节、场景与可直接拍摄的分镜（壳已就位）。
3. **超前白模预览** — 对已拆解的分镜自动生成编排预演（previsualization），含运镜与布景。手动 Blender 建模环节替换为全自动化一键预演。

更远的计划：面向「创意 → 上架 → 营收」闭环的插件市场、生产级协作工具链。

## 快速开始

### 方式 A：Docker Compose（推荐）

```bash
git clone <你的仓库地址>
cd zeroexo-platform
cp zeroexo_backend/.env.example zeroexo_backend/.env   # 然后修改密钥
docker compose up -d
```

创建初始管理员账号（super_admin）：

```bash
# seed 必须通过环境变量提供强密码（生产环境下 seed 会拒绝使用默认值）
docker compose exec backend sh -c \
  "SEED_SUPER_ADMIN_PASSWORD='<强密码>' \
   SEED_ADMIN_PASSWORD='<强密码>' \
   SEED_USER_PASSWORD='<强密码>' \
   npx ts-node prisma/seed.ts"
```

| 服务     | 地址                          |
|----------|-------------------------------|
| 前端画布 | http://localhost:80           |
| 管理后台 | http://localhost:80/admin/    |
| API      | http://localhost:3000         |
| Swagger  | http://localhost:3000/api/docs |

### 方式 B：本地开发

环境要求：Node.js >= 18、pnpm >= 9、PostgreSQL 16、Redis 7、MinIO。

```bash
# 1. 后端
cd zeroexo_backend
cp .env.example .env
pnpm install
npx prisma migrate deploy && npx prisma generate
pnpm db:seed          # 创建初始账户（密码通过 SEED_SUPER_ADMIN_PASSWORD 指定）
pnpm dev              # http://localhost:3000

# 2. 管理后台
cd ../zeroexo_admin
pnpm install
pnpm dev              # http://localhost:8080

# 3. 前端画布
cd ../zeroexo_front
pnpm install
pnpm dev              # http://localhost:5180
```

> 初始账户由 `pnpm db:seed` 创建。生产环境超级管理员密码读取
> `SEED_SUPER_ADMIN_PASSWORD` 环境变量，脚本拒绝使用默认密码执行。

## 架构

```mermaid
flowchart LR
    subgraph 客户端
        F[画布编辑器<br/>React + zustand + Yjs]
        A[管理后台<br/>React + antd]
    end

    subgraph 网关
        N[nginx]
    end

    subgraph 后端[NestJS API]
        R[RBAC + JWT 守卫]
        P[AI 渠道<br/>密钥加密]
        G[AI 生成<br/>SSE 流式]
        AG[智能体系统]
        C[实时协作<br/>Hocuspocus / SSE]
        B[计费与积分]
        S[存储服务<br/>MinIO / 本地]
    end

    subgraph 数据
        PG[(PostgreSQL)]
        RD[(Redis)]
        MI[(MinIO)]
    end

    F --> N
    A --> N
    N --> R
    R --> P
    P --> G
    P --> AG
    P --> C
    P --> B
    P --> S
    G --> PG
    G --> RD
    S --> MI
```

## 仓库结构

```
zeroexo-platform/
├── zeroexo_front/          # 画布编辑器（核心产品）
│   ├── packages/           # @zeroexo/* 插件：nodes、layout、group、history ...
│   └── src/                # 应用外壳、功能模块、同步、协作
├── zeroexo_admin/          # 管理后台（React + antd + ECharts）
├── zeroexo_backend/        # NestJS API（Prisma / PostgreSQL / Redis / MinIO）
│   ├── prisma/             # schema、migrations、种子脚本
│   └── src/modules/        # 认证、AI 生成、智能体、素材、计费 ...
├── docs/screenshots/       # 各模块截图（frontend / canvas / admin）
├── docker-compose.yml      # 一键部署
└── docker/nginx/           # 反向代理配置
```

## 技术栈

| 分层     | 技术                                                         |
|----------|--------------------------------------------------------------|
| 画布     | React 18、Vite 6、pnpm workspace、Turbo、Yjs、zustand、Vitest |
| 管理后台 | React 18、Vite 8、antd 6、ProComponents、ECharts、i18next    |
| 后端     | NestJS 10、Prisma 5、PostgreSQL 16、Redis 7、MinIO、OpenTelemetry |
| 实时     | Hocuspocus (Yjs)、Server-Sent Events                         |
| 安全     | JWT + refresh 轮换、RBAC、限流、AES-256-GCM                  |
| 部署     | Docker Compose、nginx、PM2（ecosystem.config.js）             |

## 常用脚本

详见各模块 README：

- [zeroexo_front](zeroexo_front/README.md) — `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test`
- [zeroexo_admin](zeroexo_admin/README.md) — `pnpm dev` / `pnpm build` / `pnpm lint`
- [zeroexo_backend](zeroexo_backend/README.md) — `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm db:seed`

## 参与贡献

欢迎提交 Issue 与 PR，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全漏洞上报请查看 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE) © 斯高和 <750831855@qq.com>
