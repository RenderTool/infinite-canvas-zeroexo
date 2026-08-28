<p align="center">
  <img src="https://img.shields.io/badge/ZeroExo_Platform-v1.2.0-6c5ce7?style=for-the-badge" alt="version">
  <img src="https://img.shields.io/badge/Active_Development-yellow?style=for-the-badge" alt="active development">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/NestJS-10-EA2845?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
</p>

<h1 align="center">ZeroExo Platform</h1>

<p align="center">
  A full-stack, AI-driven canvas platform. From idea to storyboard, from shots to a finished short film — one platform, end to end.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> · <a href="#product-modules">Modules</a> · <a href="#roadmap">Roadmap</a> · <a href="#quick-start">Quick Start</a>
</p>

---

> **Early development** — APIs, UI, and data models change frequently. Contributions and feedback are welcome.

### Highlights

- **Infinite canvas** — Self-built React DOM engine, node orchestration, multi-level LOD, grid spatial index
- **AI film-out pipeline** — Script → storyboard → shots → finished film; every node can chat with AI
- **Real-time collaboration** — Yjs CRDT + Hocuspocus, offline-first, timestamp-based conflict rebasing

### Latest Previews (v1.2.0)

| Prompt Viewer — generation-chain canvas | Streaming canvas editing |
|---|---|
| ![Prompt Viewer](./docs/screenshots/canvas/提示词查看器.jpg) | ![Streaming canvas editing](./docs/screenshots/canvas/流式画布编辑.jpg) |

## Product Modules

| Frontend Canvas | Admin Console |
|---|---|
| ![Frontend Canvas](docs/screenshots/frontend/前端首页.webp) | ![Admin Console](docs/screenshots/admin/后台首页.webp) |

ZeroExo is a **full-stack** project. The React canvas frontend is the core product, and the NestJS-backed admin console provides operational control — all in one platform.

### Home Page

![Home page](docs/screenshots/frontend/前端首页.webp)

### Canvas Capabilities

| Canvas overview | Keyboard shortcuts | Node style config |
|---|---|---|
| ![Canvas overview](docs/screenshots/canvas/画布概览.webp) | ![Keyboard shortcuts](docs/screenshots/canvas/画布快捷键.webp) | ![Node style config](docs/screenshots/canvas/画布节点样式配置.webp) |

| Debug & collaboration | Project dev agent | Agent self-upgrade & maintenance |
|---|---|---|
| ![Debug and collaboration](docs/screenshots/canvas/debug和协作.webp) | ![Project dev agent](docs/screenshots/canvas/项目工程开发配套Agent.webp) | ![Agent self-upgrade and maintenance](docs/screenshots/canvas/Agent自我升级项目维护一体.webp) |

### Animated Demos (Canvas Operations)

**Real-time Collaborative Editing**

Multiple users edit the same canvas simultaneously with Yjs + Hocuspocus real-time sync and offline-first local persistence — changes are visible instantly.

![Real-time collaborative editing](docs/screenshots/frontend/前端画布协作.gif)

**Stacked Node Aggregation**

Group multiple nodes into a single stacked node with one click, with expand, switch, and remove actions for organized, compact layouts.

![Stacked node aggregation](docs/screenshots/frontend/前端画布堆叠.gif)

**Rapid Node Navigation**

Quickly locate and focus canvas nodes via navigation controls, improving browsing and editing efficiency on large canvases.

![Rapid node navigation](docs/screenshots/frontend/前端画布导航.gif)

**Hierarchy Panel & Double-click Focus**

The hierarchy panel overviews node relationships in a tree structure; double-click any node to instantly focus the viewport, balancing global overview and local editing.

![Hierarchy panel & double-click focus](docs/screenshots/canvas/画布层级面板和双击聚焦.gif)

**Multi-language Switching**

Switch the interface between Chinese, English, and Japanese in real time with a single click.

![Multi-language switching](docs/screenshots/frontend/多语言切换.gif)

**Canvas Theme Switching**

Toggle between light and dark themes across all pages, with every UI element fully adapting to the active theme.

![Canvas theme switching](docs/screenshots/frontend/画布换肤.gif)

### Frontend — Canvas (the core)

The canvas editor is the platform's core module, covering the complete
production pipeline of script → storyboard → shot → finished film:

| Area | What it does |
|------|--------------|
| Canvas core | Viewport pan/zoom, grid spatial index, multi-level LOD rendering, node subscription, node/edge selection & editing, group/arrange/size/layer tools |
| Node system | Video, image, text, stacked, and generator nodes; per-type colors and icons; AI chat per node |
| Collaboration | Yjs + Hocuspocus real-time sync, presence/awareness, offline-first local persistence, timestamp-based conflict rebasing |
| AI production | Agent dock, streamed thinking UI, canvas agents (storyboard, shot, genre analysis), AI chat composer with @-mentions |
| Storyboard & script | Rich-text script editor, storyboard episodes, shot lists, script import & conversion |
| Material & prompt | Asset library, prompt library with favorites, resource sync (cloud-first) |

#### Screenshots

| Login | Home | Light theme |
|---|---|---|
| ![Login](docs/screenshots/frontend/前端登录页.webp) | ![Home](docs/screenshots/frontend/前端首页.webp) | ![Light theme](docs/screenshots/frontend/前端白色主题.webp) |

| Script editor | Script & storyboard | Storyboard editor |
|---|---|---|
| ![Script editor](docs/screenshots/frontend/前端剧本编辑页.webp) | ![Script and storyboard](docs/screenshots/frontend/前端剧本和分镜.webp) | ![Storyboard editor](docs/screenshots/frontend/前端分镜编辑页.webp) |

| Prompt library | Asset library | Canvas manager |
|---|---|---|
| ![Prompts](docs/screenshots/frontend/前端提示词.webp) | ![Asset library](docs/screenshots/frontend/前端素材库管理页.webp) | ![Canvas manager](docs/screenshots/frontend/前端画布管理页.webp) |

### Admin Console

Operational control plane for the platform:

- API provider management (credentials, health checks, per-user keys)
- User management & application approval (RBAC: `super_admin` / `admin` / `operator` / `user`)
- Prompt library, branding, multi-language policies
- Analytics dashboards (operations & billing) built on ECharts

#### Screenshots

| Admin home | Site operations | User asset & permission management |
|---|---|---|
| ![Admin home](docs/screenshots/admin/后台首页.webp) | ![Site operations](docs/screenshots/admin/后台管理站点运营.webp) | ![User asset & permission management](docs/screenshots/admin/后台管理用户资产权限管理.webp) |

| API provider management | Provider details | Storage |
|---|---|---|
| ![API provider management](docs/screenshots/admin/后台API渠道管理.webp) | ![Provider details](docs/screenshots/admin/后台API渠道管理具体页.webp) | ![Storage](docs/screenshots/admin/后台存储页.webp) |

| Site settings | Logs | Email service |
|---|---|---|
| ![Site settings](docs/screenshots/admin/后台站点管理.webp) | ![Logs](docs/screenshots/admin/后台日志.webp) | ![Email service](docs/screenshots/admin/后台管理邮件服务.webp) |

### Backend API

A NestJS + Prisma service layer: authentication & refresh rotation, role-based
guards, AI provider orchestration with encrypted key storage (AES-256-GCM),
SSE streaming, asset storage (MinIO / local), collaboration backend, billing,
and analytics.

> The backend provides the capability foundation for the canvas editor and
> the admin console. See the per-module READMEs for details.

## Roadmap

What's being built next, in priority order:

1. **Smart film-splitting (拉片拆片)** — feed a reference video, get it
   broken into shots/scenes/storyboard automatically.
2. **Million-word novel breakdown** — one-click structural decomposition of
   long-form novels into chapters, scenes, and shot-ready storyboards.
   (Shell already in place.)
3. **Pre-shoot white-model preview** — auto-generate a staged preview
   ("previsualization") of every decomposed shot, with camera movement and
   layout. The manual Blender modeling step is replaced by an automated,
   one-click preview pass.

More on the horizon: better multi-provider AI orchestration, marketplace
hooks for the idea → platform → revenue loop, and production-grade
collaboration tooling.

## Quick Start

### Option A: Docker Compose (recommended)

```bash
git clone <your-repo-url>
cd zeroexo-platform
cp zeroexo_backend/.env.example zeroexo_backend/.env   # then edit secrets
docker compose up -d
```

Create the initial admin account (super-admin):

```bash
# seed requires strong passwords via env vars (seed refuses defaults in production)
docker compose exec backend sh -c \
  "SEED_SUPER_ADMIN_PASSWORD='<strong-password>' \
   SEED_ADMIN_PASSWORD='<strong-password>' \
   SEED_USER_PASSWORD='<strong-password>' \
   npx ts-node prisma/seed.ts"
```

| Service   | URL                     |
|-----------|-------------------------|
| Frontend (canvas) | http://localhost:80 |
| Admin     | http://localhost:80/admin/ |
| API       | http://localhost:3000 |
| Swagger   | http://localhost:3000/api/docs |

### Option B: Local development

Prerequisites: Node.js >= 18, pnpm >= 9, PostgreSQL 16, Redis 7, MinIO.

```bash
# 1. Backend
cd zeroexo_backend
cp .env.example .env
pnpm install
npx prisma migrate deploy && npx prisma generate
pnpm db:seed          # create initial accounts (password via SEED_SUPER_ADMIN_PASSWORD)
pnpm dev              # http://localhost:3000

# 2. Admin console
cd ../zeroexo_admin
pnpm install
pnpm dev              # http://localhost:8080

# 3. Frontend (canvas)
cd ../zeroexo_front
pnpm install
pnpm dev              # http://localhost:5180
```

> Initial accounts are created by `pnpm db:seed`. In production the
> super-admin password is read from `SEED_SUPER_ADMIN_PASSWORD` and the
> seed script refuses to run with the default value.

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        F[Canvas Editor<br/>React + zustand + Yjs]
        A[Admin Console<br/>React + antd]
    end

    subgraph Gateway
        N[nginx]
    end

    subgraph Backend[NestJS API]
        R[RBAC + JWT Guard]
        P[AI Providers<br/>encrypted keys]
        G[AI Generate<br/>SSE streaming]
        AG[Agent System]
        C[Collaboration<br/>Hocuspocus / SSE]
        B[Billing & Credit]
        S[Storage<br/>MinIO / Local]
    end

    subgraph Data
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

## Repository Structure

```
zeroexo-platform/
├── zeroexo_front/          # Canvas editor (the core product)
│   ├── packages/           # @zeroexo/* plugins: nodes, layout, group, history ...
│   └── src/                # app shell, features, sync, collaboration
├── zeroexo_admin/          # Admin console (React + antd + ECharts)
├── zeroexo_backend/        # NestJS API (Prisma, PostgreSQL, Redis, MinIO)
│   ├── prisma/             # schema, migrations, seeders
│   └── src/modules/        # auth, ai-generate, agent, assets, billing, ...
├── docs/screenshots/       # screenshots per module (frontend/canvas/admin)
├── docker-compose.yml      # one-command deployment
└── docker/nginx/           # reverse proxy config
```

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Canvas   | React 18, Vite 6, pnpm workspace, Turbo, Yjs, zustand, Vitest |
| Admin    | React 18, Vite 8, antd 6, ProComponents, ECharts, i18next |
| Backend  | NestJS 10, Prisma 5, PostgreSQL 16, Redis 7, MinIO, OpenTelemetry |
| Realtime | Hocuspocus (Yjs), Server-Sent Events |
| Security | JWT + refresh rotation, RBAC, rate limiting, AES-256-GCM |
| Deploy   | Docker Compose, nginx, PM2 (ecosystem.config.js) |

## Scripts

See the per-module READMEs:

- [zeroexo_front](zeroexo_front/README.md) — `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm test`
- [zeroexo_admin](zeroexo_admin/README.md) — `pnpm dev` / `pnpm build` / `pnpm lint`
- [zeroexo_backend](zeroexo_backend/README.md) — `pnpm dev` / `pnpm build` / `pnpm typecheck` / `pnpm db:seed`

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and
check [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE) © 斯高和 <750831855@qq.com>
