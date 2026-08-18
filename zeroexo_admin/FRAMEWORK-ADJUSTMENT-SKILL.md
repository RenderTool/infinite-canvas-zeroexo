# 前端项目框架调整经验沉淀 Skill

> 适用场景：现有 Ant Design 5.x 前端项目存在风格冲突、组件用法不一致、废弃 API 警告等问题，需要系统性地统一框架规范。
>
> 目标项目：zeroexo_admin（已完成）、zeroexo_front（待执行）

## 一、问题诊断清单

在开始调整前，先全面扫描项目中的以下问题类型：

### 1.1 废弃 API 扫描

| 检查项 | 搜索关键词 | 替换方案 |
|--------|-----------|---------|
| Modal `destroyOnClose` | `destroyOnClose` | `destroyOnHidden` |
| Card `bodyStyle` | `bodyStyle` | `styles.body` |
| Input.Search | `Input.Search` | `Input` + `SearchOutlined` prefix |
| Popconfirm | `Popconfirm` | `Modal.confirm` |

### 1.2 多图标库混用扫描

| 图标库 | 搜索关键词 | 处理方式 |
|--------|-----------|---------|
| `@ant-design/icons` | `from '@ant-design/icons'` | 首选，保留 |
| `lucide-react` | `from 'lucide-react'` | 允许使用，`@ant-design/icons` 缺失时作为补充 |
| `bootstrap-icons` | `bootstrap-icons` / `bi-` | 允许使用，保留 CSS 导入 |

### 1.3 组件用法变体扫描

| 组件 | 不同变体 | 统一方案 |
|------|---------|---------|
| 搜索框 | `Input.Search` vs `Input` + `SearchOutlined` | 统一 `Input` + `SearchOutlined` prefix |
| 删除确认 | `Popconfirm` vs `Modal.confirm` vs `window.confirm` | 统一 `Modal.confirm` |
| 弹窗位置 | `centered` 未设置 vs 已设置 | 统一 `centered: true` |
| 图标库 | `lucide-react` + `bootstrap-icons` + `@ant-design/icons` | 统一 `@ant-design/icons` |
| 布局容器 | 裸 `Card` vs `PageContainer` | 统一 `PageContainer`（ghost 模式） |
| 表格 | 多套自定义表格组件 | 统一 `UnifiedTable` 或 `DynamicResourceTable` |
| 表单布局 | 水平/垂直混用 | 统一 `layout="vertical"`，标签在上 |

### 1.4 控制台警告扫描

运行项目后在浏览器控制台观察：
- React 告警（deprecated props、invalid children）
- 重复 key 警告
- 非受控/受控组件切换警告

## 二、标准化执行步骤

### Step 1: 建立 DESIGN.md 规范文档

使用 Google `design.md` 格式（参见 `references/templates/design/DESIGN.md`），定义：

1. **色彩系统**: primary, success, warning, error, text-primary, text-secondary, text-tertiary, border, bg-page, bg-container
2. **排版系统**: h1-h3, body, caption, small, label 的字号/字重/字族
3. **圆角层级**: none(0), xs(2), sm(4), md(6), lg(8)
4. **间距体系**: xs(4), sm(8), md(16), lg(24), xl(32)
5. **组件规范**: 每个组件的样式、行为、使用约束
6. **Do's and Don'ts**: 作为 AI 护栏

### Step 2: 统一 ConfigProvider 主题配置

在 `App.tsx` 中通过 `ConfigProvider` 全局注入：

```tsx
<ConfigProvider theme={{
  algorithm: theme.defaultAlgorithm,
  token: {
    borderRadius: 6,
    colorPrimary: '#1677ff',
    colorTextSecondary: '#595959',
    // ... 完整 token 列表
  },
  components: {
    Table: { headerBg: '#fafafa' },
    Card: { paddingLG: 16, paddingSM: 8 },
    Button: { controlHeightSM: 24, controlHeight: 32, controlHeightLG: 44 },
  },
}}>
  <App />
</ConfigProvider>
```

### Step 3: 扫描替换废弃 API

使用 `grep -r` 全局搜索并替换：

```bash
# 搜索废弃 API
grep -r "destroyOnClose" src/ --include="*.tsx" --include="*.ts"
grep -r "bodyStyle" src/ --include="*.tsx" --include="*.ts"
grep -r "Input\.Search" src/ --include="*.tsx" --include="*.ts"
grep -r "Popconfirm" src/ --include="*.tsx" --include="*.ts"
```

### Step 4: 统一图标库

1. 确认 `package.json` 中仅保留 `@ant-design/icons`
2. 移除 `lucide-react` 和 `bootstrap-icons` 依赖
3. 全局搜索替换图标导入路径
4. 移除 `index.less` 中的 `bootstrap-icons` CSS 导入

图标映射表（常用）：

| lucide-react | @ant-design/icons |
|-------------|-------------------|
| `Search` | `SearchOutlined` |
| `Trash2` | `DeleteOutlined` |
| `Plus` | `PlusOutlined` |
| `RefreshCw` | `ReloadOutlined` |
| `X` | `CloseOutlined` |
| `ChevronDown` | `DownOutlined` |
| `Menu` | `MenuOutlined` |
| `User` | `UserOutlined` |
| `LogOut` | `LogoutOutlined` |
| `Globe` | `GlobalOutlined` |
| `Check` | `CheckOutlined` |
| `AlertTriangle` | `WarningOutlined` |
| `Info` | `InfoCircleOutlined` |
| `Edit3` | `EditOutlined` |
| `Eye` | `EyeOutlined` |
| `Download` | `DownloadOutlined` |
| `Upload` | `UploadOutlined` |
| `Image` | `PictureOutlined` |

### Step 5: 统一搜索框

全局替换 `Input.Search` 为 `Input` + `SearchOutlined` prefix：

```tsx
// 之前
<Input.Search
  placeholder="搜索..."
  value={keyword}
  onChange={(e) => setKeyword(e.target.value)}
/>

// 之后
<Input
  placeholder="搜索..."
  prefix={<SearchOutlined style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }} />}
  value={keyword}
  onChange={(e) => setKeyword(e.target.value)}
  allowClear
  style={{ width: 240 }}
/>
```

### Step 6: 统一删除确认弹窗

全局替换 `Popconfirm` 为 `Modal.confirm`：

```tsx
// 之前
<Popconfirm title="确定删除？" onConfirm={handleDelete}>
  <Button danger>删除</Button>
</Popconfirm>

// 之后
<Button
  danger
  onClick={() => {
    Modal.confirm({
      title: '确认删除',
      content: '确定删除此记录吗？此操作不可恢复。',
      centered: true,
      okType: 'danger',
      okText: '确定删除',
      cancelText: '取消',
      onOk: () => handleDelete(),
    });
  }}
>
  删除
</Button>
```

### Step 7: 统一弹窗位置

全局搜索 `Modal` 和 `Modal.confirm`，确保所有弹窗添加 `centered: true`。

### Step 8: 统一列表组件

1. 创建统一的表格组件（如 `UnifiedTable.tsx`）
2. 所有列表页使用同一组件，确保：
   - `size="small"`
   - `pagination: { showSizeChanger: true, showTotal: (t) => \`共 ${t} 条\` }`
   - 支持 `rowSelection` 批量选择
   - 统一的搜索筛选 + 操作栏布局

### Step 9: 统一页面布局

1. 所有页面使用 `PageContainer` 包裹
2. 页面标题 + 操作按钮放在 `header.extra`
3. 工具栏高度统一 32px，间距 gap 8px

### Step 10: 验证与收尾

1. 运行项目，检查控制台无废弃 API 警告
2. 逐一检查每个页面：
   - 搜索框样式一致
   - 删除弹窗居中且样式一致
   - 图标风格统一
   - 布局间距一致
3. 更新 DESIGN.md 记录所有规范

## 三、zeroexo_admin 项目实际调整经验

### 3.1 项目概况

- 框架：React 18 + Ant Design 5.x + TypeScript
- 路由：React Router v6
- 国际化：react-i18next
- 构建：Vite

### 3.2 发现的问题清单

| 问题类别 | 具体问题 | 严重程度 | 涉及文件数 |
|---------|---------|---------|-----------|
| 废弃 API | Modal `destroyOnClose` 弃用 | 中 | 3 |
| 废弃 API | Card `bodyStyle` 弃用 | 低 | 1 |
| 废弃 API | `useForm` 未绑定 Form 元素 | 高 | 2 |
| 图标混用 | `lucide-react` + `bootstrap-icons` + `@ant-design/icons` 三套混用 | 高 | 10+ |
| 搜索框变体 | `Input.Search` 和 `Input` + `SearchOutlined` 混用 | 中 | 5+ |
| 删除弹窗变体 | `Popconfirm` 和 `Modal.confirm` 混用 | 中 | 4+ |
| 布局不一致 | 部分页面使用裸 `Card`，部分使用 `PageContainer` | 中 | 3+ |
| 表单布局不一致 | 部分水平布局，部分垂直布局 | 中 | 2+ |
| 弹窗位置不一致 | 部分 `centered`，部分未设置 | 中 | 5+ |
| 表格组件不一致 | 多套自定义表格组件 | 低 | 2 |

### 3.3 关键修复记录

#### 修复 1: 图片上传预览问题

**问题**: 新建提示词后图片无法显示。

**原因**: 
- `customRequest` 方式上传后，`onSuccess` 回调传入的 URL 格式与后端返回不一致
- 后端图片存储路径错误（公共路径未正确映射）

**解决方案**:
1. 使用 `beforeUpload` 拦截上传，通过 `FileReader` 生成 data URL 即时预览
2. 后台异步上传到云存储
3. 上传成功后替换 data URL 为真实 storageKey
4. 修复后端存储路径，确保公共路径图片无需认证即可访问

**经验**: C 端应用图片上传应优先本地预览（data URL / blob URL），后台异步上传，避免用户等待。

#### 修复 2: useForm 未连接警告

**问题**: `Warning: Instance created by useForm is not connected to any Form element`

**原因**: 在 Modal 未打开时调用 `form.setFieldsValue()`，Form 组件尚未渲染。

**解决方案**:
1. 使用 `useEffect` 监听 Modal 的 `open` 状态
2. 仅在 Modal 打开后设置表单值
3. 移除 `Form.useWatch`（在 Form 不可见时无法工作）

```tsx
useEffect(() => {
  if (open && record) {
    // 确保 Modal 已渲染后再设置值
    requestAnimationFrame(() => {
      form.setFieldsValue(record);
    });
  }
}, [open, record]);
```

#### 修复 3: Dashboard 与 Analytics 合并

**问题**: Dashboard 和 Analytics 页面功能重叠。

**决策**: 合并为统一的 Analytics 页面，包含：
- 服务状态（原 Dashboard 的零散服务信息）
- 数据分析（原 Analytics 的图表统计）
- 删除 Dashboard 页面

#### 修复 4: 非管理员重定向

**问题**: 非管理员登录后可以看到所有页面数据。

**解决方案**: 创建独立 Apply 页面，`AdminGuard` 组件对非管理员重定向到 `/apply`。

### 3.4 设计规范同步更新

调整过程中同步更新 `DESIGN.md`，确保：
1. 修正后的 `text-secondary` 颜色值（从 `#8c8c8c` 改为 `#595959`）
2. 新增组件规范（搜索框、图标、弹窗确认、批量操作等）
3. 更新 Do's and Don'ts 列表

## 四、通用经验总结

### 4.1 项目启动时的最佳实践

1. **立项即建立 DESIGN.md**：使用 Google design.md 格式定义设计规范
2. **ConfigProvider 统一主题**：通过 Ant Design 的 ConfigProvider 全局注入 token
3. **统一组件库**：项目初期就确定唯一的图标库、弹窗组件、搜索框组件
4. **组件封装**：对常用布局（搜索工具栏、表格、批量删除）进行统一封装

### 4.2 重构时的发现模式

当发现一个组件有不一致用法时，通常意味着还有更多同类问题：

```
发现一个 Input.Search → 全局搜索 Input.Search 找到所有
发现一个 Popconfirm → 全局搜索 Popconfirm 找到所有
发现一个 lucide-react 导入 → 全局搜索所有图标库导入
发现一个 未centered 的 Modal → 全局搜索所有 Modal 用法
```

### 4.3 危险信号清单

- [ ] 项目中有多套图标库
- [ ] 搜索框在不同页面样式不同
- [ ] 删除弹窗风格不统一
- [ ] 控制台有 deprecated 警告
- [ ] 同类页面使用不同布局容器
- [ ] 表单布局（水平/垂直）不统一
- [ ] 颜色值存在多处硬编码

### 4.4 工作量估算

对于中小型管理后台（~30 个页面）：

| 阶段 | 预估工时 | 产出 |
|------|---------|------|
| 问题诊断 | 1-2 小时 | 问题清单 |
| 建立 DESIGN.md | 1 小时 | 设计规范文档 |
| ConfigProvider 配置 | 0.5 小时 | 统一主题注入 |
| 废弃 API 替换 | 1-2 小时 | 无警告运行 |
| 图标库统一 | 2-3 小时 | 统一图标风格 |
| 组件变体统一 | 3-5 小时 | 统一组件用法 |
| 布局统一 | 2-3 小时 | 统一页面布局 |
| 验证与收尾 | 1-2 小时 | 最终确认 |

## 五、Infinite Context 提示词模板

将此 Skill 文档作为上下文提供给 LLM 时，使用以下提示词模板：

```
你正在对一个基于 React + Ant Design 5.x + TypeScript 的前端管理后台项目进行框架调整。

## 项目背景
{项目简要描述}

## 已知问题
{问题清单，从问题诊断清单中筛选适用项}

## 规范文档
{将 DESIGN.md 完整内容粘贴在此}

## 任务要求
1. 严格按照 DESIGN.md 中的规范执行
2. 先全面扫描问题，再逐项修复
3. 每项修复遵循以下模式：
   - 扫描全局 → 确认所有实例 → 统一替换 → 验证
4. 修复完成后更新 DESIGN.md 记录新的规范
5. 所有弹窗居中，所有删除使用 Modal.confirm，所有图标使用 @ant-design/icons

## 禁止事项
- 禁止使用 Input.Search
- 禁止使用 Popconfirm
- 优先使用 @ant-design/icons，缺失时可用 lucide-react 或 bootstrap-icons 补充
- 禁止使用 bodyStyle（改用 styles.body）
- 禁止使用 destroyOnClose（改用 destroyOnHidden）
- 禁止硬编码颜色值（使用 CSS 变量或 ConfigProvider token）
```

## 六、相关文件索引

| 文件 | 说明 |
|------|------|
| `DESIGN.md` | 项目设计规范文档（最终确认版） |
| `src/App.tsx` | ConfigProvider 统一主题配置入口 |
| `src/design-tokens.ts` | JS 层面设计令牌常量 |
| `src/index.less` | CSS 变量定义文件 |
| `src/components/UnifiedTable.tsx` | 统一表格组件 |
| `src/components/user-resources/BatchDeleteToolbar.tsx` | 批量删除工具栏组件 |
| `references/templates/design/DESIGN.md` | Google design.md 标准模板 |
| `references/templates/skill/FRAMEWORK-ADJUSTMENT-SKILL.md` | 本 Skill 文档模板 |