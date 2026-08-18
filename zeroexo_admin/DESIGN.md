---
name: ZeroExo Admin
description: ZeroExo 管理后台的现代化设计系统规范 — v2.3
version: 2.3.0
colors:
  primary: "#1677ff"
  primary-hover: "#4096ff"
  primary-active: "#0958d9"
  primary-light: "#e6f4ff"
  success: "#10b981"
  success-light: "#ecfdf5"
  warning: "#f59e0b"
  warning-light: "#fffbeb"
  error: "#ef4444"
  error-light: "#fef2f2"
  ai: "#8b5cf6"
  ai-light: "#f5f3ff"
  text-primary: "#171717"
  text-secondary: "#525252"
  text-tertiary: "#a3a3a3"
  text-disabled: "#d4d4d4"
  border: "#e5e5e5"
  border-light: "#f5f5f5"
  border-strong: "#d4d4d4"
  bg-page: "#fafafa"
  bg-surface: "#ffffff"
  bg-elevated: "#f5f5f5"
  bg-hover: "#f5f5f5"
  bg-selected: "#eff6ff"
  bg-code: "#f6f8fa"
  bg-dark: "#0f172a"
gradients:
  brand: "linear-gradient(135deg, #1677ff 0%, #7c3aed 100%)"
  ai: "linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)"
  success: "linear-gradient(135deg, #10b981 0%, #059669 100%)"
typography:
  h1:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
    fontSize: 28px
    fontWeight: 600
  h2:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
    fontSize: 20px
    fontWeight: 600
  h3:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
    fontSize: 16px
    fontWeight: 600
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
    fontSize: 14px
  caption:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
    fontSize: 12px
    color: "{colors.text-secondary}"
  small:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
    fontSize: 11px
    color: "{colors.text-tertiary}"
  label:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
    fontSize: 13px
    fontWeight: 500
rounded:
  none: 0px
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  '2xl': 16px
  full: 9999px
shadow:
  sm: "0 1px 2px 0 rgba(0,0,0,0.05)"
  md: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)"
  lg: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)"
  xl: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)"
  primary: "0 4px 12px rgba(22,119,255,0.25)"
spacing:
  none: 0px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  '2xl': 48px
animation:
  fast: "150ms"
  base: "200ms"
  slow: "300ms"
  fadeIn: "fadeIn 200ms ease-out"
components:
  card:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    shadow: "{shadow.sm}"
    hoverShadow: "{shadow.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.md}"
    height: 36px
    hoverShadow: "{shadow.primary}"
  button-large:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.lg}"
    height: 44px
  card-stat:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.lg}"
    shadow: "{shadow.sm}"
  modal:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
    shadow: "{shadow.xl}"
  table:
    rounded: "{rounded.md}"
    size: small
    pagination: pageSize=10, showTotal
    headerBg: "{colors.bg-elevated}"
  tag:
    rounded: "{rounded.xs}"
  input:
    rounded: "{rounded.md}"
    height: 36px
  select:
    rounded: "{rounded.md}"
    height: 36px
  code-block:
    backgroundColor: "{colors.bg-code}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm}"
  form:
    layout: vertical
    labelPlacement: top
  modal-form:
    width: 680px
    centered: true
    destroyOnHidden: true
  toolbar:
    height: 36px
    gap: 8px
    marginBottom: 16px
---

## Overview

**ZeroExo Admin 管理后台** — 以 Ant Design 5.x 为基底的统一管理系统。设计语言追求专业、清晰、高效，避免过度装饰。卡片式布局，白色容器 + 浅灰背景，通过 ConfigProvider theme 全局注入设计令牌。

## 实施方式

所有设计令牌通过以下方式统一注入，禁止逐文件硬编码：

### 1. ConfigProvider theme (App.tsx)

```tsx
<ConfigProvider locale={locale} theme={{
  algorithm: theme.defaultAlgorithm,
  token: {
    borderRadius: 6,                  // 默认圆角
    colorPrimary: '#1677ff',
    colorSuccess: '#52c41a',
    colorWarning: '#fa8c16',
    colorError: '#ff4d4f',
    colorInfo: '#1677ff',
    colorText: '#1a1a2e',
    colorTextSecondary: '#595959',
    colorTextTertiary: '#bfbfbf',
    colorBorder: '#f0f0f0',
    colorBorderSecondary: '#e8e8e8',
    colorBgLayout: '#f5f5f5',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#fafafa',
    fontSize: 14,
    fontSizeHeading1: 28,
    fontSizeHeading2: 20,
    fontSizeHeading3: 16,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...",
    controlHeight: 32,
    controlHeightLG: 44,
    controlHeightSM: 24,
    marginXS: 4, marginSM: 8, margin: 16, marginMD: 24, marginLG: 32,
    paddingXS: 4, paddingSM: 8, padding: 16, paddingMD: 24, paddingLG: 32,
  },
  components: {                          // 统一组件默认属性
    Table: { headerBg: '#fafafa' },
    Card: { paddingLG: 16, paddingSM: 8 },
    Button: { controlHeightSM: 24, controlHeight: 32, controlHeightLG: 44 },
  },
}}>
```

### 2. CSS 变量 (index.less)

```less
:root {
  --color-primary: #1677ff;
  --color-text-secondary: #595959;
  --color-border: #f0f0f0;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  // ... 完整列表见 index.less
}
```

### 3. JS 设计令牌 (design-tokens.ts)

```tsx
import { color, radius, spacing } from '@/design-tokens';
// 页面内联样式通过此文件引用令牌，禁止硬编码
```

## Colors

色彩系统通过 ConfigProvider 全局注入，CSS 变量提供后备。

- **Primary (#1677ff):** 主色 — 按钮、链接、关键交互
- **Success (#52c41a):** 成功状态 — 标签、进度完成
- **Warning (#fa8c16):** 警告状态 — 待处理、警告标签
- **Error (#ff4d4f):** 错误状态 — 删除、错误标签
- **Text Primary (#1a1a2e):** 主文本色 — 标题、正文
- **Text Secondary (#595959):** 辅助文本 — 描述、元数据、占位符
- **Border (#f0f0f0):** 边框色 — 卡片边框、分割线
- **Bg Page (#f5f5f5):** 页面背景色
- **Bg Container (#ffffff):** 容器背景 — 卡片、弹窗

## Typography

系统原生字体，字号 4 级阶梯：

| Token | Size | Weight | 用途 |
|-------|------|--------|------|
| h1 | 28px | 200 | 品牌标题（登录/注册页） |
| h2 | 20px | 500 | 页面标题、统计数值 |
| h3 | 16px | 500 | 卡片标题、区块标题 |
| body | 14px | 400 | 正文默认 |
| caption | 12px | 400 | 辅助文字、标签 |
| small | 11px | 400 | 极小标注 |

## Layout & Spacing

4px 基准网格：

- 页面内卡片间距：`marginTop: 16px`，`Row gutter: [16, 16]`
- 卡片内间距：`padding: 16px`
- 列表项间距：`gap: 8px`
- 表单标签与控件间距：`marginBottom: 8px`

## Elevation & Shadows

- **Shadow 1:** `0 2px 8px rgba(0,0,0,0.08)` — 卡片悬停、小弹窗
- **Shadow 2:** `0 4px 16px rgba(0,0,0,0.12)` — 弹窗、下拉菜单
- **Shadow 3:** `0 8px 24px rgba(0,0,0,0.16)` — 移动端 FAB

## Shapes

| Token | Value | 用途 |
|-------|-------|------|
| xs | 2px | 代码块内元素 |
| sm | 4px | 卡片、标签、徽标、统计卡片、输入框 |
| md | 6px | 按钮、表格、Select (默认) |
| lg | 8px | 弹窗、大按钮 |

## Components

### 页面容器
- 所有页面使用 `PageContainer`（@ant-design/pro-components）包裹，`ghost` 模式
- 页面标题 + 操作按钮放在 `header.extra`

### 统计卡片
- 使用 `StatisticCard`（@ant-design/pro-components）
- `statistic` 属性传入 icon / title / value / suffix

### 数据表格
- 表格统一使用 antd `Table`，`size="small"`，`showSizeChanger: true`，`showTotal: (t) => \`共 ${t} 条\``
- 搜索栏统一使用 `Input` + `SearchOutlined` prefix，`width: 240px`
- 分页配置通过 `ConfigProvider` 全局统一
- `UnifiedTable` 组件已废弃并删除
- **操作列位置**：所有表格的操作列必须放在**最后一列**（`columns` 数组末尾），宽度 `width: 48`，按钮为 1:1 主色方块（32×32）+ `EllipsisOutlined`，包裹 `className="row-actions"`，默认 `opacity: 0`，hover 表行淡入显示
- **表格分类**：
  - **数据类表格**（`className="data-table"`）：行高 2 倍（td padding-top/bottom: 20px），适用于日志、用户、积分、定价、申请审核等
  - **媒体类表格**（`className="media-table"`）：保持紧凑行高（padding-top/bottom: 8px），适用于公共提示词等包含图片的表格
- **全局表格内边距**：所有数据表格（未加 data-table 类，如用户列表、计费明细、资源表等）统一提升 cell 内边距 —— `td: 20px 上下`、`th: 16px 上下`（index.less 全局 `.ant-table` 规则，与 data-table 同级生效）；`.media-table` 特异性更高，保持 8px 不受影响
- **单元格内元素内边距**：表格单元格内的标签（`.ant-tag`）、按钮（`.ant-btn`、`.row-action-btn`）、链接（`a`）统一 `padding: 5px`，使内容更透气（index.less 全局 `.ant-table-tbody > tr > td` 规则）
- **操作按钮**：统一使用 `Dropdown` + `menu.onClick` 模式，按钮添加 `className="row-action-btn"` + `onClick={(e) => e.stopPropagation()}`

### 弹窗
- 使用 `Modal`（antd），`centered` 居中（已通过 ConfigProvider `modal={{ defaultCentered: true }}` 全局配置），`destroyOnHidden` 关闭销毁
- 宽度：编辑类 680px，详情类 720px
- **媒体预览弹窗**：`width: 1200px`，`maxWidth: 95vw`，body padding 为 0，媒体内容高度 `85vh`

### 表单
- 使用 `Form`（antd），`layout="vertical"`，标签在上控件在下
- 保存按钮通过 `onOk` 触发，统一 `okText` / `cancelText`

### 按钮
- 主要操作：`type="primary"`，默认尺寸
- 危险操作：`danger` 属性
- 刷新/次要操作：`icon` 配合文字

### 批量删除工具栏
- 统一使用 `BatchDeleteToolbar`（`src/components/user-resources/BatchDeleteToolbar.tsx`）
- 替代原 AssetToolbar / PromptToolbar / ProjectToolbar

### 提示词表单
- 公共提示词和用户提示词统一使用 `Modal` + `Form layout="vertical"` 框架
- 字段：title, content, category, tags
- 公共提示词额外字段：images, source, sourceName, sourceUrl, license

### 图片上传
- 上传时优先创建本地 blob URL 用于即时预览，后台异步上传到云存储
- 上传成功后，替换 blob URL 为真实 storageKey
- 上传失败时保留本地预览，不自动删除（用户可手动删除或重试）
- 使用 antd `Upload` 组件，`showUploadList={false}`，自定义 `customRequest`

### 图片预览
- **统一使用 Ant Design `Image` 组件**，点击图片自动调用内置图片查看器
- 图片查看器支持：放大、缩小、旋转、键盘导航等原生功能
- **禁止** 使用自定义图片预览Modal，保持视觉一致性
- 缩略图尺寸：列表内 48px，表单内 80px，详情页封面 320px

### 视频预览
- 使用 Ant Design `Modal` 组件，大尺寸预览
- Modal 配置：`width: 1200px`，`maxWidth: 95vw`，body padding 为 0
- 视频容器高度：`85vh`，`background: '#000'`
- 视频属性：`controls`，`autoPlay`，`muted`，`loop`
- **禁止** 对视频添加过度的圆角、阴影等装饰

### 动效规范
- **全局禁用** 输入框、选择器、按钮的过渡动画（`transition: none !important`）
- 仅保留页面加载时的 `fadeIn` 淡入动画（仅 Card 组件）
- **移除** 所有 focus outline 和 box-shadow，避免视觉干扰
- **禁止** 在交互元素上添加 `transform`、`translateY` 等位移效果
- 表格行操作按钮使用 hover 显示（无动画过渡）

### 搜索框
- 统一使用 `Input` + `SearchOutlined` prefix 模式（`<Input prefix={<SearchOutlined />} />`），**禁止使用 `Input.Search`** 组件
- 样式：`width: 240px`，`allowClear`
- 分类下拉筛选与搜索框在同一行，`display: flex; gap: 12px; align-items: center`

### 分类/筛选下拉（Toolbar 上下文）
- 统一使用 `Select` 组件，`placeholder` 文字简洁（如"分类""素材类型""项目类型"）
- 样式：`width: 140px`，`allowClear`
- 选项通过 `options` prop 传入
- 禁止在 Toolbar 中使用无 width 的 Select（会导致布局错乱）

### 删除确认（遵循 Ant Design「足不出户」原则）
- 删除操作尽量不打断用户心流，区分可撤销和不可撤销操作
- **可撤销操作**（如删除草稿、临时文件、公共提示词收藏）→ 直接执行 + `message.success` + 提供「撤销」按钮
- **不可撤销操作**（如删除用户、永久删除政策、删除品牌设置）→ 使用 **`Popconfirm`** 轻量确认，保持当前页面
- 仅在复杂场景（如删除时需要填写原因）保留 `Modal.confirm`
- 批量删除必须在确认文案中显示具体数量（如`确定删除选中的 N 个...吗？`）
- `Modal.confirm` 参考规范：
  ```tsx
  Modal.confirm({
    title: '确认删除',
    content: '确定删除此记录吗？此操作不可恢复。',
    centered: true,
    okType: 'danger',
    okText: '确定删除',
    cancelText: '取消',
    onOk: async () => { /* 执行删除 */ },
  });
  ```

### 批量操作
- 所有列表页必须支持行选择（`rowSelection`）和批量删除功能
- 选中行后，在 Toolbar 中显示"删除选中（N 个）"按钮
- 批量删除使用 `Modal.confirm` 确认，文案显示具体数量

### 弹窗位置
- 所有 `Modal` 和 `Modal.confirm` 必须设置 `centered: true`（屏幕居中显示）
- 编辑/创建类弹窗：`width: 680px`
- 详情类弹窗：`width: 720px`
- 确认类弹窗：`width: 520px`
- **媒体预览弹窗**：`width: 1200px`，`maxWidth: 95vw`，无标题，无footer，body padding 为 0
- 不可逆操作使用 `Popconfirm` 轻量确认（遵循 Ant Design「足不出户」原则）

### 图标库
- 首选 `@ant-design/icons` 作为主要图标来源，线性简约风格
- 当 `@ant-design/icons` 缺少所需图标时，允许使用 `lucide-react` 或 `bootstrap-icons` 作为补充
- 图标风格：线性简约，默认与主题文字配色一致（`color: inherit`）
- hover 时使用背景色变化，**禁止使用缩放动画**（已全局禁用 transition）
- 图标尺寸：工具栏 14px，列表内操作 12px，大标题 16px
- 避免同一页面混用三种图标库，尽量统一使用同一种来源

### 布局系统
- 桌面端：`ProLayout`（@ant-design/pro-components），`layout="side"`，`fixSiderbar`
- 移动端：`Drawer`（placement="left", size=280）+ 浮动 FAB 按钮
- 页面内容：统一使用 `PageContainer`（ghost 模式），避免直接使用裸 `Card` 作为页面容器
- 页面标题 + 操作按钮放在 `header.extra`
- **布局壳模式**：所有页面使用 `Tabs + inline 内容` 模式，**禁止使用 `Outlet` 路由跳转模式**（遵循 Ant Design「足不出户」原则：Tab 切换不应导致页面跳转）
- 避免不必要的手写面包屑导航（侧边栏导航已清晰标识当前位置）

### 页面布局标准（公共提示词页模板）
所有管理列表页必须遵循以下统一布局结构，以 `public-prompts.tsx` 为标准模板：

#### 页面壳结构
```tsx
<PageContainer
  title="页面标题"
  subTitle={`共 ${total} 条`}
  ghost
  extra={[
    <Button key="refresh" icon={<ReloadOutlined />} onClick={handleRefresh}>刷新</Button>,
    <Button key="create" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建</Button>,
  ]}
>
  {/* 统计卡片（可选，特殊页面如积分管理） */}
  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
    <Col xs={12} sm={8} md={4}>
      <Statistic title="指标名" value={value} prefix={<IconOutlined style={{ color: 'var(--color-primary, #1677ff)' }} />} />
    </Col>
  </Row>
  {/* 筛选栏 */}
  <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
    <Input placeholder="搜索..." prefix={<SearchOutlined />} value={keyword}
      onChange={(e) => setKeyword(e.target.value)} style={{ width: 240 }} allowClear />
    <Select placeholder="分类" allowClear style={{ width: 140 }}
      options={CATEGORY_OPTIONS} value={category}
      onChange={(v) => { setCategory(v); setPage(1); }} />
    <Button onClick={handleClear}>清空</Button>
    <div style={{ flex: 1 }} />
    <Button icon={<ReloadOutlined />} onClick={handleRefresh}>刷新</Button>
    <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建</Button>
  </div>
  {/* 数据表格 */}
  <Table ... />
  {/* 弹窗 */}
  <Modal ... />
</PageContainer>
```

#### 筛选栏规范
- 搜索框：`Input` + `SearchOutlined` prefix，`width: 240px`，`allowClear`
- 分类下拉：`Select`，`width: 140px`，`allowClear`
- 筛选栏行内布局：`display: flex; gap: 12px; alignItems: center`
- 清空按钮：放在筛选栏左侧或右侧
- 操作按钮（刷新/新建）：放在筛选栏最右侧
- 使用 `flex: 1` 占位符将操作按钮推到最右侧

#### 操作列规范
- 所有列表页操作列统一使用 `Dropdown` + 更多按钮模式，位于**最后一列**
- 操作列宽度统一 `width: 48`
- 按钮样式：`type="primary"`，`width/height: 32`（1:1 方块），`icon={<EllipsisOutlined />}`，包裹在 `className="row-actions"` 中
- 操作项按逻辑分组：主要操作 → 分割线 → 危险操作
- Hover 显示：通过全局 CSS `.resource-table .row-actions { opacity: 0 }` + `.ant-table-tbody > tr:hover .row-actions { opacity: 1 }` 控制，表格需添加 `className="data-table resource-table"`

#### 统计卡片规范（积分管理等特殊页面）
- 使用 `Row gutter={[16, 16]}` + `Col xs={12} sm={8} md={4}` 布局
- `Statistic` 组件，标题 + 数值 + 图标前缀
- 图标颜色统一使用 CSS 变量：`var(--color-primary, #1677ff)`、`var(--color-success, #52c41a)`、`var(--color-warning, #fa8c16)`、`var(--color-error, #ff4d4f)`
- 卡片样式：无边框、无投影、无圆角

#### 空状态规范
- 无选中数据时显示居中的空状态提示
- 使用大图标 + 提示文字，如：`UserOutlined` + "请选择用户"
- 空状态样式：`textAlign: 'center', padding: '48px 0', color: 'var(--color-text-tertiary, #bfbfbf)'`

#### 状态标签规范
- 统一使用预设颜色：`blue` / `green` / `orange` / `red` / `purple` / `default`
- 样式：`style={{ margin: 0, fontSize: 11, borderRadius: 'var(--radius-sm, 4px)' }}`
- 标签内边距紧凑，使用 `margin: 0` 避免额外间距

#### CSS 颜色变量使用规范
- **禁止** 直接硬编码颜色值（如 `#1677ff`、`#ff4d4f`）
- **必须** 使用 CSS 变量：
  - 主色：`var(--color-primary, #1677ff)`
  - 成功：`var(--color-success, #52c41a)`
  - 警告：`var(--color-warning, #fa8c16)`
  - 错误：`var(--color-error, #ff4d4f)`
  - 文本主色：`var(--color-text-primary, #1a1a2e)`
  - 文本辅色：`var(--color-text-secondary, #595959)`
  - 文本弱化：`var(--color-text-tertiary, #bfbfbf)`
  - 边框：`var(--color-border, #f0f0f0)`
  - 背景页：`var(--color-bg-page, #f5f5f5)`
  - 背景容器：`var(--color-bg-container, #ffffff)`
  - 背景提升：`var(--color-bg-elevated, #fafafa)`

#### 表格样式规范
- 统一 `size="small"` 基础行高
- `scroll={{ x: 'max-content' }}` 横向滚动
- 分页：`showSizeChanger: true, showTotal: (t) => \`共 ${t} 条\``
- 表头背景透明：`background: transparent !important`
- 单元格无分隔线：`border-bottom: none !important`
- 行悬停背景：`var(--color-bg-hover, #fafafa)`
- **操作列固定末尾**：位于所有数据列之后，`width: 48`，hover 显示更多按钮
- **表格行高分类**：
  - 数据类表格（`.data-table`）：td padding-top/bottom: 20px（约 2 倍行高），th 16px
  - 媒体类表格（`.media-table`）：保持紧凑 padding 8px
- **全局表格内边距**：所有未加 data-table 类的数据表格（用户列表、计费明细、资源表等）由 index.less 全局 `.ant-table` 规则统一提升 —— `td: 20px 上下`、`th: 16px 上下`
- **单元格内元素内边距**：单元格内的标签（`.ant-tag`）、按钮（`.ant-btn`、`.row-action-btn`）、链接（`a`）统一 `padding: 5px`，内容更透气
- **操作按钮**：hover 表行淡入显示，使用 `Dropdown` + `menu.onClick` 模式
  - CSS：`.resource-table .row-actions { opacity: 0 }` + `.ant-table-tbody > tr:hover .row-actions { opacity: 1 }`
  - 按钮：主色 1:1 方块（32×32）+ `EllipsisOutlined`，hover 时背景高亮
- **列排序（前端排序）**：所有数据表格支持点击列头升序/降序
  - 时间列：`sorter: (a, b) => new Date(a.x).getTime() - new Date(b.x).getTime()`
  - 数值列：`sorter: (a, b) => a.x - b.x`
  - 文本列：`sorter: (a, b) => a.x.localeCompare(b.x)`（中文用 `localeCompare(b.x, 'zh-Hans-CN')`）
  - 布尔列：`sorter: (a, b) => Number(a.x) - Number(b.x)`
  - 动态列（DynamicResourceTable）：按值类型通用排序（number 相减，其余字符串 localeCompare），`render === 'actions'` 的列不排序
- **表头吸顶（sticky）**：所有数据表格统一 `sticky`（滚动到一定距离表头堆叠固定），配合 `bordered`
- **固定列**：统一 `bordered` + `sticky`；操作列 `fixed: 'right'`（需配合 `scroll.x`）；列头与内容不对齐或列重复时指定固定列宽度 `width`；建议 `scroll.x` 为大于表格宽度的固定值或百分比，非固定列宽度之和不要超过 `scroll.x`；留一列不设宽度以适应弹性布局

#### 弹窗规范
- 详情弹窗：`width: 680px`，`centered: true`，`destroyOnHidden: true`
- 编辑弹窗：`width: 680px`，`centered: true`，`destroyOnHidden: true`
- 确认弹窗：使用 `Modal.confirm`，`centered: true`，`okType: 'danger'`
- **媒体预览弹窗**：`width: 1200px`，`maxWidth: 95vw`，body padding 为 0，媒体高度 `85vh`
- Descriptions 组件：**禁止** `bordered` 属性
- Form 组件：`layout="vertical"`，标签在上

#### 模型分类 Tab 规范（全局共识）
所有"模型 / 资源类型分类切换"必须使用 antd `Tabs` 组件，**禁止**使用按钮组或自研 span 标签模拟。参照：API 渠道、定价配置、AI 品牌模型列表页同款。

- **位置**：Tab 位于内容区顶部，独占一行；`style={{ marginBottom: 0 }}`
- **Tab label 结构**：图标 + 文字，`<span><Icon style={{ marginRight: 4, verticalAlign: -2 }} />文字</span>`
- **图标规范**：必须与 API 渠道同款，统一使用 `@ant-design/icons`，**禁止 lucide-react 图标**；图标为 1:1 方块（默认 14px），映射固定：`BarsOutlined`(全部) / `MessageOutlined`(llm) / `PictureOutlined`(image) / `VideoCameraOutlined`(video) / `AudioOutlined`(audio) / `QuestionCircleOutlined`(unclassified)
- **数量统计**：需要展示数量时，在文字后追加中文全角括号，如 `全部（12）`、`文本模型（5）`
- **下方布局顺序**（自上而下，保持 16px 间距节奏）：
  1. **搜索 + 操作行**（`marginTop: 12px`）：`display: flex; gap: 12px; alignItems: center`，搜索框 `Input + SearchOutlined prefix + width: 240 + allowClear`（默认尺寸，禁止 `size="small"`、禁止 `Input.Search`），`<div style={{ flex: 1 }} />` 将操作按钮推至最右；操作按钮统一默认尺寸
  2. **批量操作行**（带统计，`marginBottom: 16px`）：显示 `已选 N 项` / `当前页 M 项 / 共 K 项` 统计 + 批量操作按钮（选中后显示）
- **Tab 切换**：同步重置分页与选中状态
- **示例**：
```tsx
<Tabs
  style={{ marginBottom: 0 }}
  activeKey={activeType}
  onChange={(key) => { setActiveType(key); setPage(1); }}
  items={TABS.map((tab) => ({
    key: tab.key,
    label: <span><Icon style={{ marginRight: 4, verticalAlign: -2 }} />{tab.label}（{tab.count}）</span>,
  }))}
/>
```

### ProTable 淘汰说明
- **禁止新页面使用 `ProTable`**，统一使用标准 `Table` 组件
- 现有 ProTable 页面需逐步迁移至标准 Table 模式
- 标准 Table 优势：
  - 完全可控的渲染逻辑
  - 支持表头嵌入筛选器
  - 更轻量的依赖
  - 与现有 CSS 样式系统更好集成

### Drawer 抽屉
- 统一 `placement="right"` 方向（仅移动端菜单使用 `left`）
- 宽度：详情面板 480px，全屏面板 960px
- `closable={false}`，通过 `extra` 属性放置关闭按钮

### Button 按钮
- 尺寸规范：工具栏操作按钮统一默认尺寸（height: 32px，与用户列表同款，禁止 `size="small"`），大按钮 `large`（height: 44px）
- 类型规范：主要操作 `type="primary"`，次要操作 `type="default"`，文本链接 `type="link"`
- 危险操作：统一添加 `danger` 属性，配合 `type="primary"` 或 `type="default"`
- 刷新操作：统一 `icon={<ReloadOutlined />}` + 文字"刷新"

### Tag 标签
- 状态标识：使用预设颜色名（如 `color="blue"`、`color="green"`、`color="orange"`）
- 分类标识：使用预设颜色名，避免使用自定义色值
- 风格：`style={{ margin: 0, fontSize: 11 }}`，圆角 `var(--radius-sm, 4px)`

### Card 卡片
- 所有页面内容卡片统一使用 `borderRadius: 'var(--radius-sm, 4px)'`（4px）
- 避免使用 `bodyStyle`（已弃用），改用 `styles.body`
- body padding 标准：
  - 页面内容卡片：`padding: 16px`
  - 表格容器卡片：`padding: 0`（表格紧贴边缘）
  - 筛选/工具条卡片：`padding: '12px 16px'`（紧凑型）

### 表格（Table）
- 统一 `size="small"`（基础高度 40px/行，数据表格经全局 padding 提升后约 56px/行）
- `pagination: { showSizeChanger: true, showTotal: (t) => \`共 ${t} 条\` }`
- 列表页必须支持行选择（`rowSelection`）
- 自定义表格组件（`DynamicResourceTable`、`UnifiedTable`）应保持相同的 pagination 和 size 配置
- **所有数据表格统一启用**：`bordered`（边框）+ `sticky`（表头滚动吸顶堆叠）
- **所有数据表格支持列排序**：时间/数值/文本/布尔列按类型配置 `sorter`（前端排序），操作列不排序
- **操作列固定**：`fixed: 'right'` + `width: 48`，需配合 `scroll.x`

## Data Visualization (ECharts)

### 主题规范
- **主色**：`var(--color-primary)` (#1677ff)
- **图表字体**：`var(--font-family)`（与全局字体一致）
- **坐标轴颜色**：`var(--color-border)`
- **Tooltip 背景**：`var(--color-bg-surface)` (#ffffff)

### 强制规范
- **禁止**：每个图表单独硬编码颜色
- **必须**：所有图表使用统一的 ECharts 主题文件

### 色板预设
```typescript
// 图表系列颜色（按顺序循环使用）
const CHART_COLORS = [
  '#1677ff',  // primary
  '#52c41a',  // success
  '#fa8c16',  // warning
  '#722ed1',  // purple
  '#13c2c2',  // cyan
  '#eb2f96',  // magenta
  '#faad14',  // gold
  '#2f54eb',  // deep-blue
];
```

### 基础配置模板
```typescript
// 统一的 ECharts 主题配置（src/theme/echarts-theme.ts）
export const baseChartOption: EChartsOption = {
  tooltip: {
    backgroundColor: 'var(--color-bg-surface)',
    borderColor: 'var(--color-border)',
    textStyle: { color: 'var(--color-text-primary)' },
  },
  grid: { left: 50, right: 20, top: 40, bottom: 40 },
  xAxis: {
    axisLine: { lineStyle: { color: 'var(--color-border)' } },
    axisLabel: { color: 'var(--color-text-tertiary)', fontSize: 12 },
  },
  yAxis: {
    axisLine: { show: false },
    axisLabel: { color: 'var(--color-text-tertiary)', fontSize: 12 },
    splitLine: { lineStyle: { color: 'var(--color-border)', type: 'dashed' } },
  },
  legend: {
    textStyle: { color: 'var(--color-text-secondary)', fontSize: 12 },
    bottom: 0,
  },
};
```

### 图表尺寸规范
- EChartsCard 高度：统一 `280px`
- 自定义卡片（如模型排行）：统一 `280px`，内容溢出时 body 区域滚动
- 图表间距：`marginTop: 16px`，独立一行布局
- 图表卡片可并排时优先并排（`Row gutter={[16,16]}` + `Col xs={24} lg={12}`），避免页面单调（如：服务状态+模型使用排行、用户增长+AI 调用、Token 消耗+资源增长）

## 运营分析统计口径

### 模型使用排行
- **必须使用真实统计数据，禁止写死**。数据源：`aiGeneration` 表按 `model` 聚合，`GET /admin/analytics/model-distribution`
- **只统计成功调用**：`where: { status: 'success' }`，排除 failed / cancelled
- **必须包含 AI 测试（ai-test）的调用**：`POST /admin/ai/chat` 成功响应后必须落库一条 `AiGeneration` 记录（`kind='text'`、`status='success'`、`params: { _isTest: true }`、`costTokens = usage.total_tokens`），保证测试中使用的模型也计入排行；写入失败仅记 warn，不得影响响应
- 前端展示 top10（按调用次数降序），卡片高度 `280px`，模型名过长截断，右侧显示调用次数，进度条按最大值归一化（最小 2% 可见）

### Token 消耗趋势
- 数据源：`aiGeneration` 表按天聚合 `costTokens`，`GET /admin/analytics/token-trend`
- **支持模型维度**：接口接受可选 `?model=xxx` 参数，传模型时仅聚合该模型，不传时聚合全部
- 前端图表右上角提供模型下拉（`Select size="small" width: 180`，选项 = 全部模型 + 模型使用排行 top10），切换即重新请求；自动刷新时必须保持当前选中模型（用 ref 缓存，避免闭包捕获旧值）
- 图表 series 名显示当前模型（`tokenModel || '全部模型'`），tooltip 展示 `tokens` 数值

## Do's and Don'ts

- DO: 使用 `ConfigProvider.theme` 统一颜色/圆角/间距
- DO: 使用 CSS 变量 `var(--color-*)` 替代硬编码色值
- DO: 所有列表页使用标准 `Table` 组件（`UnifiedTable` / `ProTable` 已废弃）
- DO: 所有表单使用 `Modal` + `Form layout="vertical"` + `destroyOnHidden`
- DO: 优先使用 `@ant-design/icons` 图标，`@ant-design/icons` 缺失时可用 `lucide-react` 或 `bootstrap-icons` 补充
- DO: 搜索框统一使用 `Input` + `SearchOutlined` prefix，宽度 240px
- DO: Toolbar 中 Select 统一设置 `width: 140px` + `allowClear`
- DO: 所有 `Modal` 和 `Modal.confirm` 设置 `centered: true`
- DO: 所有删除操作使用 `Modal.confirm`，内容包括操作后果说明
- DO: 所有列表页支持行选择 + 批量删除
- DO: 图片预览使用 Ant Design `Image` 组件的内置查看器
- DO: 视频预览使用大尺寸 Modal（1200px，媒体高度 85vh）
- DO: 表格行操作按钮使用 hover 显示机制
- DO: 模型使用排行 / Token 消耗趋势必须使用真实统计数据（aiGeneration 聚合），模型使用排行必须包含 AI 测试调用且只统计成功记录
- DO: Token 消耗趋势支持按模型维度查看（`?model=` 参数 + 图表右上角模型下拉）
- DON'T: 混用多个 borderRadius 值（统一使用 sm=4px, md=6px, lg=8px）
- DON'T: 在页面级直接使用 `#f0f0f0`、`#8c8c8c` 等硬编码色值
- DON'T: 同类组件使用不同的 UI 框架（如全部使用 antd Form）
- DON'T: 同一概念数据（如"提示词"）存在多套表单 UI 和字段定义
- DON'T: 使用 `Input.Search` 组件（统一使用 `Input` + `SearchOutlined` prefix）
- DON'T: 使用 `Popconfirm` 执行删除操作（统一使用 `Modal.confirm`）
- DON'T: 使用 `Popover` 执行不可逆操作
- DON'T: Toolbar 中 Select 缺少 width 属性（会导致布局错乱）
- DON'T: 在输入框、选择器、按钮上添加 transition 动画（已全局禁用）
- DON'T: 添加 focus outline 或 box-shadow（已全局移除）
- DON'T: 在交互元素上使用 transform/translateY 位移效果
- DON'T: 对视频添加过度的圆角、阴影等装饰
- DON'T: 使用自定义图片预览Modal（统一使用 Ant Design Image 组件）
