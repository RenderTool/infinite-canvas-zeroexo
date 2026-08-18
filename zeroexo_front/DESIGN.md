---
name: ZeroExo Frontend
description: ZeroExo 前端（C 端）的设计系统规范 — 标准化版
version: 1.0.0
colors:
  primary: "#e94560"
  primary-hover: "#ff6b7a"
  success: "#10b981"
  warning: "#f59e0b"
  error: "#ef4444"
  info: "#3b82f6"
  text-primary: "#1c1917"
  text-secondary: "#57534e"
  text-tertiary: "#a8a29e"
  border: "#e7e5e4"
  border-secondary: "#d6d3d1"
  bg-page: "#ffffff"
  bg-container: "#f5f5f4"
  bg-elevated: "#fafaf9"
  bg-dark: "#161412"
typography:
  display:
    fontFamily: "'Sora', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontWeight: "700"
  body:
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontWeight: "400"
  mono:
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace"
    fontWeight: "500"
  h1:
    fontSize: 24px
    fontWeight: 700
    letterSpacing: -0.025em
  h2:
    fontSize: 20px
    fontWeight: 600
    letterSpacing: -0.025em
  h3:
    fontSize: 18px
    fontWeight: 500
  body:
    fontSize: 14px
    lineHeight: 1.625
  caption:
    fontSize: 12px
    color: "{colors.text-secondary}"
  small:
    fontSize: 11px
    color: "{colors.text-secondary}"
rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 14px
  full: 9999px
spacing:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
layout:
  nav-height: 54px
  stage-toolbar-height: 42px
  sidebar-expanded: 220px
  sidebar-collapsed: 60px
  icon-btn: 32px
  avatar-size: 24px
components:
  card:
    backgroundColor: "{colors.bg-container}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg-page}"
    rounded: "{rounded.sm}"
    height: 32px
  button-large:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg-page}"
    rounded: "{rounded.md}"
    height: 44px
  modal:
    backgroundColor: "{colors.bg-page}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    centered: true
  toolbar:
    height: 32px
    gap: 8px
  input:
    rounded: "{rounded.sm}"
    height: 36px
  select:
    rounded: "{rounded.sm}"
    height: 36px
  tag:
    rounded: "{rounded.full}"
    fontSize: 11px
---

## Overview

**ZeroExo Frontend** — 面向 C 端用户的 AI 视频创作平台，融合创意构思与制作交付。设计语言追求 **"Warm Technical"**（温暖技术感），在专业工具与新手引导之间取得平衡。

暗色主题使用深暖灰（`#161412`）而非纯黑，避免冰冷感。亮色主题使用纯白（`#ffffff`）背景。主色（`#e94560`）为克制的红色，用于选中状态、激活指示器和主要操作。

系统避免玻璃态、重渐变和装饰性元素。表面采用平面设计配合微妙边框分割。深度通过阴影和透明度层级而非模糊效果实现。

## 实施方式

### 1. 主题系统 — `@zeroexo/plugin-theme` + `AntdThemeProvider`

所有设计令牌通过 `@zeroexo/plugin-theme` 的 `useTheme()` 钩子获取，并通过 `AntdThemeProvider` 映射到 antd 的 ConfigProvider 主题配置。

```tsx
// antd-theme-provider.tsx（已实现）
<ConfigProvider theme={{
  cssVar: { key: 'zx' },
  algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: {
    zIndexPopupBase: 20000,
    colorPrimary: theme.toolbar.accent,       // #e94560
    colorBgLayout: theme.canvas.background,
    colorBgContainer: theme.toolbar.background,
    colorText: theme.toolbar.text,
    colorTextSecondary: theme.toolbar.textMuted,
    colorBorder: theme.toolbar.border,
    colorError: theme.toolbar.danger,
    borderRadius: 8,
    fontSize: 13,
  },
  components: { /* 详见 antd-theme-provider.tsx */ },
}}>
  {children}
</ConfigProvider>
```

### 2. CSS 变量 — Tailwind CSS `@theme`

Tailwind CSS 的 `@theme` 指令中定义全局设计令牌，`.css` 文件中使用 Tailwind 工具类。

### 3. JS 设计令牌 — `LAYOUT_CONSTANTS.ts`

布局常量通过 `@/shared/components/LAYOUT_CONSTANTS.js` 中的 `LAYOUT` 对象引用，禁止硬编码。

## Colors

### 主题令牌结构

`@zeroexo/plugin-theme` 的 `ThemeConfig` 包含 5 个类别，每个类别有明暗两套值：

| 类别 | 说明 | 明色值 | 暗色值 |
|------|------|--------|--------|
| `canvas.background` | 画布/页面背景 | `#ffffff` | `#161412` |
| `toolbar.background` | 导航栏/工具栏/面板背景 | `#ffffff` | `#161412` |
| `toolbar.accent` | 主色 — 选中/激活/主要操作 | `#e94560` | `#e94560` |
| `toolbar.text` | 主要文本色 | `#1c1917` | `#f5f5f4` |
| `toolbar.textMuted` | 次要文本色 | `#57534e` | `#a8a29e` |
| `toolbar.border` | 所有边框/分割线 | `#e7e5e4` | `#44403c` |
| `toolbar.danger` | 危险操作色 | `#ef4444` | `#ef4444` |
| `node.fill` | 卡片/表面填充 | `#f5f5f4` | `#1c1917` |

### 状态色（Stage Colors）

用于多步骤工作流中的状态指示：

| 令牌 | 值 | 用途 |
|------|-----|------|
| `STAGE_COLORS.completed` | `#10b981` | 已完成步骤、确认徽标 |
| `STAGE_COLORS.active` | `#3b82f6` | 当前步骤、进行中指标 |
| `STAGE_COLORS.action` | `#8b5cf6` | 主要操作按钮（"下一步"） |
| `STAGE_COLORS.assist` | `#a78bfa` | 次要/建议性操作（"询问 AI"） |

### 颜色使用规则

- `accent`（#e94560）仅用于**选中状态**、**激活指示器**和**主要操作**，不得大面积作为背景填充
- 暗色模式下，accent 不得作为大段文本的主色（影响可读性）
- 所有图标使用 `currentColor` 继承父级颜色，不硬编码图标色值
- 白色主题图标默认 `#1c1917`，暗色主题默认 `#f5f5f4`

## Typography

### 字体栈

| 角色 | 字体 | 字重 | 用途 |
|------|------|------|------|
| Display | Sora | 600–700 | 标题、品牌文字 |
| Body | DM Sans | 400–500 | 正文、标签、按钮 |
| Mono | JetBrains Mono | 500 | 代码、元数据 |

### 字号阶梯

| 层级 | 尺寸 | 字重 | 行高 | 用途 |
|------|------|------|------|------|
| h1 | 24px | 700 | — | 品牌标题 |
| h2 | 20px | 600 | — | 页面标题 |
| h3 | 18px | 500 | — | 卡片标题 |
| body | 14px | 400 | 1.625 | 正文默认 |
| caption | 12px | 400 | — | 辅助文字 |
| small | 11px | 400 | — | 极小标注 |
| button | 13px | 500 | — | 按钮文字 |
| label | 11–12px | 500 | — | 表单标签 |
| mono | 12px | 500 | — | 等宽文字 |

### 字体加载策略

字体文件采用**项目资源优先 + CDN 备选**策略：
1. 字体文件通过 `@fontsource-*` 包管理或放在 `public/fonts/`
2. HTML 中通过 `<link rel="preconnect">` 预连接到 Google Fonts CDN
3. `font-family` 末尾始终包含系统字体栈备选

## Layout & Spacing

### 双层布局系统

**Tier 1 — 全局层**（列表/管理页面：首页、创作、资产、提示词）

```
应用布局壳 (AppLayout)
├─ 顶部栏 (54px) — AppTopBar
│  Logo | 菜单项 | 搜索 | 用户操作
├─ 侧边栏 (可选) — AppSidebar
└─ 内容区 (flex:1)
   └─ 页面内容 (overflow: auto)
```

**Tier 2 — 编辑器层**（详情/编辑页：画布编辑器、创作详情）

```
antd Layout (自有 Header+Content)
├─ 顶部栏 (54px) — 编辑器 TopBar
│  左侧操作区 | 右侧操作区
└─ 内容区 (flex:1)
   ├─ 侧边栏 (可选)
   └─ 主区域 (画布/舞台内容)
```

### 高度常量

| 组件 | 高度 | 常量 |
|------|------|------|
| TopNav / TopBar | 54px | `LAYOUT.NAV_HEIGHT` |
| StageToolbar | 42px | `LAYOUT.STAGE_TOOLBAR_HEIGHT` |
| Sidebar (展开) | — | `LAYOUT.SIDEBAR_EXPANDED` (220px) |
| Sidebar (收起) | — | `LAYOUT.SIDEBAR_COLLAPSED` (60px) |

### 页面布局模式

所有列表/管理页面遵循以下模式：

```
page container (height: 100%, flex column, overflow: hidden)
├─ toolbar: flex row, padding 12–20px
│  ├─ 标题 (左)
│  └─ 搜索 + 图标按钮 + 新建 (右，全部有 Tooltip)
└─ content: flex: 1, overflow: auto, padding 20px
   └─ grid: auto-fill, minmax(280px, 1fr), gap: 20px
      └─ Cards (aspect-ratio: 16:9)
```

### 间距体系

基础间距单位 **8px**，所有 gap/padding/margin 应为此倍数：

| 值 | 常见用途 |
|----|----------|
| 4px (0.5x) | 分割线高度、圆点间距 |
| 8px (1x) | 按钮内边距 Y、元素 gap |
| 12px (1.5x) | 元素 gap、卡片内边距 X |
| 16px (2x) | 页面 padding (桌面)、gutter、卡片内边距 |
| 20px (2.5x) | 页面 padding (桌面)、卡片网格 gap |
| 24px (3x) | 卡片网格 padding、区块间距 |

## Components

### 页面容器
- 所有列表/管理页面使用 `AppLayout`（antd Layout 的封装，增加移动端适配和主题注入）
- 编辑器页面直接使用 antd Layout，不包裹 `AppLayout`

### 顶部栏（TopBar）
- 三个变体：导航栏、编辑器顶部栏、创作详情顶部栏
- 高度统一 54px，使用 `theme.toolbar.background` 作为背景
- `borderBottom: 1px solid ${theme.toolbar.border}`

### 图标按钮（Icon-Only Buttons）
- 所有工具栏操作按钮使用图标 + antd Tooltip 设计
- 尺寸 32x32，`fontSize: 16`，`borderRadius: 6`
- 使用 `lucide-react` 图标，hover 时通过 `zeroexo-icon-btn` 类实现缩放动画
- **提示文字（Tooltip）：统一使用 antd `Tooltip`**，禁止使用自研 `tooltip.tsx`（已废弃）

### 弹窗（Modal）
- **优先使用 antd Modal**，已通过 `AntdThemeProvider` 配置完整主题
- 必须设置 `centered` 属性
- 使用 `styles.body: { padding: 0 }` 取消默认 padding，由内部完全控制间距
- 必须在 `styles.content` 中设置 `background` 和 `border`，确保明暗主题适配
- 宽度规范：编辑类 680px，详情类 960px，确认类 520px，上传类 440px
- 自研 `modal.tsx`（portal-based）仅用于极简场景（不需要 antd 依赖时，如 asset-picker 和 image-dialog-renderer）

### 按钮（Button）
- 尺寸规范：工具栏 `size="small"`（24px），主操作 `default`（32px），大按钮 `large`（44px）
- 类型规范：主要操作 `type="primary"`，次要操作 `type="default"`
- 危险操作：统一添加 `danger` 属性
- 图标按钮：使用 `lucide-react` 图标，配合 antd Tooltip

### 卡片（Card）
- 使用 `antd Card`，`bordered={false}`，`borderRadius: 14px`
- 使用 `styles.body` 自定义 body 样式（禁止使用已弃用的 `bodyStyle` 属性）
- hover 效果：`translateY(-4px)` + `boxShadow`
- 过渡动画：`all 0.3s cubic-bezier(0.22, 1, 0.36, 1)`
- 缩略图宽高比：16:9

### 输入框（Input）
- 使用 antd `Input`，`controlHeight: 36`
- 搜索框：使用 `Input` + 自定义 prefix 图标，宽度 240px，`allowClear`
- 禁止使用 `Input.Search` 组件

### 选择框（Select）
- **通用场景：使用 antd `Select`**，`controlHeight: 36`
  - 工具栏中统一设置 `width: 140px` + `allowClear`
  - 搜索/筛选页面的分类下拉使用 antd Select
- **Canvas 编辑器场景：使用 `SimpleSelect`**（`@/shared/components/simple-select.js`）
  - 专为 canvas 节点工具栏设计，支持 `fixed` 定位避免 overflow 裁剪
  - 支持 `stopPropagation` 防止拖拽干扰
  - 自定义字体、颜色、边框
  - 仅用于 script-structured-editor 等画布内编辑器

### 表单（Form）
- 使用 antd `Form`，`layout="vertical"`，标签在上控件在下
- 表单标签与控件间距：`marginBottom: 12px`

### 表格（Table）
- `size="small"`，`headerBorderRadius: 8`
- `pagination: { showSizeChanger: true, showTotal: (t) => \`共 ${t} 条\` }`

### 标签（Tag）
- 状态标识：使用预设颜色名（如 `color="blue"`、`color="green"`）
- 风格：`fontSize: 11`，`borderRadius: 9999px`
- 在 div/td 中最多显示前 4 个标签，超出显示 +N

### 头像（Avatar）
- 用户头像：antd `Avatar`，size 24px，显示首字符
- AI 头像：自定义组件，8px border-radius，Bot 图标

### 下拉菜单（Dropdown）
- **通用场景：使用 antd `Dropdown`**（6 文件：top-bar、left-side-toolbar、project-card、EpisodeList、EntityStateCard、canvas-menu）
- **Canvas 编辑器场景：`SimpleSelect` 内部使用自研 Dropdown**
  - 自研 `dropdown.tsx` 支持 `fixed` 定位（避免 overflow 裁剪）、auto-positioning、bouncy easing 动画
  - 不直接暴露给业务组件，仅通过 `SimpleSelect` 间接使用

### 抽屉（Drawer）
- 使用 antd `Drawer`
- 统一 `placement="right"`（仅移动端菜单使用 `left`）
- 宽度：详情面板 480px，全屏面板 960px

### 确认弹窗
- 所有删除/危险操作使用 `Modal.confirm`（antd），禁止使用 `Popconfirm`
- 必须包含：`centered: true`、`okType: 'danger'`、`okText: '确定删除'`、`cancelText: '取消'`
- 内容文案必须明确说明操作后果
- 也可使用 `ConfirmDialog`（`@/shared/components/confirm-dialog.js`，antd Modal 的封装），提供统一的"取消 + 确认"底部按钮

## 图标使用规则

### 图标库
- 首选 **`lucide-react`** 作为主要图标库（线性简约风格）
- 当 `lucide-react` 缺少所需图标时，允许使用 `@ant-design/icons` 或 `bootstrap-icons` 作为补充
- 图标风格：线性简约，默认与主题文字配色一致（`color: inherit`）
- 禁止使用 emoji 作为图标（🛠️、✅ 等）

### hover 动画
- 所有图标按钮使用 `zeroexo-icon-btn` CSS 类
- 动画：`transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)`
- hover：`transform: scale(1.1)`
- active：`transform: scale(0.95)`

### 尺寸规范
- 工具栏图标：16px
- 列表内操作图标：12px
- 大标题图标：16px

## Animation

### 缓动曲线
- 默认：`cubic-bezier(0.22, 1, 0.36, 1)` — 平滑减速
- 弹入：`cubic-bezier(0.34, 1.56, 0.64, 1)` — 下拉/弹窗入口

### 时长规范
- 150–200ms：hover 状态、按钮反馈
- 200–300ms：面板过渡、元素重排
- 300–500ms：卡片入场（fade-up）、页面过渡

UI 动画不超过 500ms。长时间操作使用进度指示器。

### 关键帧
所有关键帧定义在 `app.css` 中：
- `zeroexo-fade-in` — 淡入
- `zeroexo-fade-up` — 上移淡入
- `zeroexo-fade-scale` — 缩放淡入
- `zeroexo-slide-in-right` — 右侧滑入
- `zeroexo-pulse-soft` — 呼吸脉冲

## CSS & Styling 规则

1. **Tailwind CSS 优先**：组件样式优先使用 Tailwind 工具类。仅在动态值（主题相关、状态相关）无法通过 Tailwind 表达时，回退到 inline `style` 对象
2. 静态/可复用的样式值提取到工厂函数（`function fooStyle(theme): CSSProperties`）
3. 主题 token 通过 `useTheme()` 在组件层级获取，并作为 props 传递给共享组件
4. 共享组件接收 `theme: ThemeConfig` 作为 prop，不在内部调用 `useTheme()`
5. 所有颜色值通过 ConfigProvider token 或 CSS 变量控制，禁止硬编码

## 导入约定

- 使用 `@/` 别名引用 `src/` 下的文件
- 使用 `.js` 扩展名引用 `.ts/.tsx` 文件（Vite 约定）
- 主题钩子从 `@zeroexo/plugin-theme` 导入
- 共享类型从 `@zeroexo/shared` 导入
- Lucide 图标按名称导入：`import { Sparkles, History } from 'lucide-react'`

## Do's and Don'ts

- DO: 使用 `AntdThemeProvider` 统一 antd 主题配置
- DO: 使用 `@zeroexo/plugin-theme` 的 `useTheme()` 获取主题 token
- DO: 使用 `lucide-react` 作为主要图标库
- DO: 优先使用 antd Modal（已通过 ConfigProvider 配置主题）
- DO: 所有 Modal 设置 `centered`
- DO: 所有删除操作使用 `Modal.confirm`
- DO: 使用 `styles.body` 替代已弃用的 `bodyStyle`
- DO: 使用 Tailwind CSS 工具类作为主要样式方案
- DO: 使用 `@/` 别名避免深层相对路径
- DO: 尊重 `prefers-reduced-motion`：将所有动画时长设为 0ms
- DON'T: 使用 emoji 作为图标（🛠️、✅ 等）
- DON'T: 使用 `Input.Search` 组件
- DON'T: 使用 `Popconfirm` 执行删除操作
- DON'T: 使用 `bodyStyle` 作为本地变量名（避免与 antd 废弃 API 混淆）
- DON'T: 硬编码颜色值（使用主题 token 或 CSS 变量）
- DON'T: 硬编码布局尺寸（导入 `LAYOUT` 常量）
- DON'T: 混用缓动曲线（保持统一节奏）
- DON'T: 在共享组件内部调用 `useTheme()`（通过 prop 传入）
- DON'T: 使用纯黑 `#000` 作为暗色背景（使用 `#161412`）