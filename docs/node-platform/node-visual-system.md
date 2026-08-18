# Node 视觉系统指南

本文档说明 ZeroExo 节点平台的视觉体系：主题 token、`useTheme` API、NodeShell 状态视觉、Pin/Node 默认值、无边线原则、动效节奏、LOD 降级与图标规范。正文为中文、API/代码为英文，签名与源码精确一致。

相关源码：

- `zeroexo_front/packages/shared/src/index.ts` — 主题 token 类型与 `DARK_THEME` / `LIGHT_THEME`
- `zeroexo_front/packages/plugins/theme/src/theme-context.tsx` — `ThemeProvider` / `useTheme`
- `zeroexo_front/packages/core/src/node-view-contract.ts` — `NodeViewContract`
- `zeroexo_front/packages/core/src/node-runtime-contract.ts` — `NodeMotionContract`
- `zeroexo_front/packages/plugins/render-react/src/components/node-shell.tsx` — NodeShell
- `zeroexo_front/packages/plugins/render-react/src/components/node-layer.tsx` — 状态视觉与 LOD
- `zeroexo_front/packages/plugins/render-react/src/pin-defaults.ts` — `PinDefaults` / `NodeDefaults`

---

## 1. 主题 Token

主题数据集中在 `@zeroexo/shared`（`packages/shared/src/index.ts`），按「画布 / 节点 / 工具栏 / 组 / 边」分 5 类 token，`ThemeConfig` 聚合为一整个主题。

### 1.1 类型定义

```ts
export type ThemeMode = 'light' | 'dark';

/** 画布 token(画布背景 + 网格) */
export interface CanvasTokens {
  background: string;        // 画布背景色
  gridColor: string;         // 网格主线色(向后兼容,等于 gridLine)
  gridColorSubtle: string;   // 网格副线色(更淡,用于次级网格)
  gridDot: string;           // 点阵网格色(rgba 带 alpha,比线条更显眼)
  gridLine: string;          // 线条网格色(rgba 带 alpha,更淡)
}

/** 节点 token(节点外观 + outline + pin) */
export interface NodeTokens {
  fill: string;                  // 节点默认底色(所有类型共用)
  defaultColor: string;          // 节点默认底色(legacy,与 fill 同义;保留以兼容旧字段)
  outlineColor: string;          // 节点默认 outline 色(非选中)
  outlineSelectedColor: string;  // 选中态 outline 色
  hoverColor: string;            // 悬停态 outline 色
  titleColor: string;            // 标题栏文字色
  titleBackground: string;       // 标题栏底色
  contentBackground: string;     // 内容区底色
  pinDefaultColor: string;       // pin 默认色
}

/** 工具栏 token(悬浮工具栏 + 底部工具栏 + 侧边栏) */
export interface ToolbarTokens {
  background: string;      // 工具栏底色
  panel: string;           // 面板/浮层底色(半透明,用于弹窗、侧边栏等)
  border: string;          // 工具栏边框色
  text: string;            // 主文字色
  textMuted: string;       // 次要文字色(标签/提示)
  accent: string;          // 强调色(按钮激活/选中)
  danger: string;          // 危险色(删除/警告)
  editorSurface: string;   // 编辑器表面色(编辑器容器背景)
  editorPaper: string;     // 编辑器纸张色(纸张内容区背景)
}

/** 组 token(组容器外观) */
export interface GroupTokens {
  background: string;             // 组默认底色(带透明)
  outlineColor: string;           // 组 outline 色(非选中)
  outlineSelectedColor: string;   // 组选中态 outline 色
  titleColor: string;             // 组标题色
}

/** 边 token(连线) */
export interface EdgeTokens {
  color: string;         // 默认边色
  selectedColor: string; // 选中态边色
  hoverColor: string;    // 悬浮态边色
  pendingColor: string;  // 临时连线色(拖拽中)
}

/** 主题配置(分 4 类 token + edge) */
export interface ThemeConfig {
  mode: ThemeMode;
  canvas: CanvasTokens;
  node: NodeTokens;
  toolbar: ToolbarTokens;
  group: GroupTokens;
  edge: EdgeTokens;
}
```

### 1.2 内置主题

```ts
export const DARK_THEME: ThemeConfig = { /* stone 暖色调 + 红色强调 */ };
export const LIGHT_THEME: ThemeConfig = { /* 米白纸感 + 同款红色强调 */ };
export const THEMES: Record<ThemeMode, ThemeConfig> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};
```

关键语义色（两主题共用强调色系）：

| 用途 | DARK | LIGHT |
| --- | --- | --- |
| 选中 outline / 强调 `accent` / 选中边 | `#e94560` | `#e94560` |
| 悬停 outline / 悬停边 | `#f06580` | `#f06580` |
| 节点默认底 `node.fill` | `#1c1917` | `#f0ece4` |
| 内容区底 `contentBackground` | `#161412` | `#fafaf7` |
| 工具栏面板 `toolbar.panel` | `rgba(22,20,18,0.96)` | `rgba(248,246,242,0.96)` |
| 危险色 `toolbar.danger` | `#ff6b6b` | `#dc2626` |
| 默认边色 `edge.color` | `rgba(255,255,255,0.55)` | `rgba(0,0,0,0.35)` |
| 组选中 outline | `#e94560` | `#e94560` |

另有 `DEFAULT_THEME` 常量（`@deprecated`），仅保留 `background` / `gridColor` / `nodeDefaultColor` / `selectedColor` / `hoverColor` / `edgeColor` 六个旧字段，新代码一律使用 `ThemeConfig` / `DARK_THEME` / `LIGHT_THEME`。

---

## 2. useTheme API（`packages/plugins/theme/src/theme-context.tsx`）

```ts
export interface ThemeContextValue {
  theme: ThemeConfig;                 // 当前主题完整 token 数据
  mode: ThemeMode;                    // 当前主题模式
  setMode: (mode: ThemeMode) => void; // 设置主题模式(受控时仅触发 onModeChange,非受控时同步内部 state)
  toggle: () => void;                 // 在 dark <-> light 之间切换
}

export interface ThemeProviderProps {
  initialMode?: ThemeMode;            // 非受控初始模式(默认 'dark')
  mode?: ThemeMode;                   // 受控模式(传入则受控,内部不维护 state)
  onModeChange?: (mode: ThemeMode) => void;
  children: React.ReactNode;
}
```

- **受控 / 非受控双模式**：传 `mode` 受控；不传则内部 `useState` 管理，且首次渲染从 `localStorage`（key `'zeroexo:themeMode'`）恢复已保存模式，无记录时回退 `initialMode`（默认 `'dark'`）。
- `setMode`：非受控时同步内部 state 并写回 `localStorage`；两种模式都会调用 `onModeChange?.(next)`。
- `theme` 恒等于 `THEMES[currentMode]`。

```ts
/** 业务消费 hook,必须在 ThemeProvider 内使用(Provider 外抛错) */
export function useTheme(): ThemeContextValue

/** 内部 hook,Provider 外返回 null(用于 AnimatedThemeToggler 优雅降级) */
export function useThemeContext(): ThemeContextValue | null
```

`useTheme` 在 Provider 外调用会 `throw new Error('useTheme must be used within ThemeProvider')`（开发期 fail-fast）；需要优雅降级时用 `useThemeContext`。配套的 `AnimatedThemeToggler` 使用 View Transitions API 做主题切换动画。主题 token 也从 `@zeroexo/plugin-theme` 透传（`DARK_THEME` / `LIGHT_THEME` / `THEMES` 及全部 token 类型），业务方一处导入即可。

---

## 3. NodeShell 状态视觉

节点状态视觉归属由 `NodeViewContract`（`packages/core/src/node-view-contract.ts`）声明，挂在 `NodeTypeExtension.viewContract`，按节点类型生效：

```ts
export interface NodeViewContract {
  getBounds?: (node: NodeRecord) => { width: number; height: number };
  selectionEffect?: 'default' | 'custom';        // 选中视觉:默认 NodeShell outline;custom 时视图自绘
  focusEffect?: 'default' | 'custom';            // focus(双击聚焦)视觉,同上
  hoverEffect?: 'default' | 'custom';            // hover 视觉,同上
  connectionHoverEffect?: 'default' | 'custom';  // 连线拖拽悬停视觉(蓝色指示),同上
  useShellChrome?: boolean;                      // 是否由 NodeShell 提供标题栏等铬件(默认 true;false 时节点全自绘)
}
```

语义：`'default'` 由 NodeShell 统一渲染状态效果（选中红框 / 连线悬停蓝框 / hover 阴影 / 标题栏）；`'custom'` 时 NodeShell 跳过该效果，由节点视图自绘。省略时全部走 `'default'`（存量节点零改动）。渲染链路：`NodeItem`（node-layer）把 `ext.viewContract` 注入 `NodeViewContractContext`，`NodeShell` 消费。

### 3.1 渲染规则（`node-shell.tsx`）

`NodeShell` 中三个 `custom` 开关决定是否跳过默认效果：

```ts
const selectionCustom = viewContract?.selectionEffect === 'custom';
const connectionCustom = viewContract?.connectionHoverEffect === 'custom';
const hoverCustom = viewContract?.hoverEffect === 'custom';
```

- **互斥优先级**：连线悬停（蓝 `#4a9eff`，1px）> 选中（红，2px），单一元素渲染（CSS outline），**无叠加态**：

```ts
const shellOutlineWidth = connectionHover && !connectionCustom
  ? 1
  : (!selectionCustom && (node.outlineWidth ?? (isSelected ? 2 : (nodeDefaults.outlineWidth ?? 0))));
const shellOutlineColor = connectionHover && !connectionCustom
  ? '#4a9eff'
  : (!selectionCustom
    ? (node.outlineColor
      ?? (isSelected ? (nodeDefaults.outlineSelectedColor ?? '#e94560') : (nodeDefaults.outlineColor ?? '#0f3460')))
    : nodeDefaults.outlineColor ?? '#0f3460');
```

- **hover 阴影**：NodeShell 内 `(isHovered && !hoverCustom) ? '0 2px 4px rgba(0,0,0,0.06)' : tileMode ? 'none' : '0 1px 1px rgba(0,0,0,0.03)'`；外层 `NodeItem` 另有 `(isHovered && ext?.viewContract?.hoverEffect !== 'custom') ? '0 2px 6px rgba(0,0,0,0.08)'` 的统一阴影（tileMode 不投影，避免图片拆解切片拼合缝隙观感）。
- **外壳底色优先级**：`node.backgroundColor` > `node.nodeColor` > `nodeDefaults.fillColor` > prop `color`（兼容旧调用方显式传色）。
- **标题栏颜色**：选中态（且非 custom）取 `nodeDefaults.titleSelectedColor ?? 'rgba(233,69,96,0.95)'`；否则 `nodeDefaults.titleColor ?? (isLight ? '#1c1917' : 'rgba(245,245,244,0.9)')`。
- **useShellChrome**：`viewContract?.useShellChrome !== false` 且存在 `title` / `titleIcon` / `titleSize` 时才渲染外挂标题栏（`NODE_TITLE_HEIGHT = 18`，用 `invK` 与 `nodeScale` 反缩放保持屏幕恒定）。
- **z-index 自动提升**（NodeItem）：选中 10 > 悬停 5 > 普通 0；`NodeResizeHandle` 20、标题栏 31、pin 容器 30。

内置 7 种业务节点中，text/generator/image/video/audio 均声明全套 `'default'` + `useShellChrome: true`；`stacked-media` 声明 `{ selectionEffect: 'default', connectionHoverEffect: 'default', hoverEffect: 'default' }`（省略 `focusEffect` 与 `useShellChrome`，走默认）。

### 3.2 NodeViewContract.getBounds

```ts
/**
 * 参与自动排布/碰撞/框选命中的边界(相对节点 position 的世界坐标尺寸)。
 * 省略时画布使用 node.size。外观与排布边界不一致的节点(如引脚外扩/标题外挂)应提供。
 */
getBounds?: (node: NodeRecord) => { width: number; height: number };
```

`getBounds` 描述「排布边界」而非「渲染尺寸」：返回相对 `node.position` 的世界坐标尺寸。省略时画布回退到 `node.size`；外观实际占用与 `node.size` 不一致的节点（引脚外扩、标题外挂等）必须显式提供，否则自动排布 / 碰撞 / 框选命中会按错误的矩形计算。

---

## 4. Pin / Node 默认值（`packages/plugins/render-react/src/pin-defaults.ts`）

Pin 默认配置与 Node 默认样式都走「Provider + Hook」的三层优先级模式。

### 4.1 PinDefaults

```ts
export interface PinDefaults {
  color?: string;                            // 默认 Pin 颜色(支持 rgba;undefined 时 pin.color/dataType 决定)
  shape?: 'circle' | 'square';               // 默认 Pin 形状(undefined 用 'circle')
  size?: number;                             // 默认 Pin 尺寸(像素;undefined 用 12)
  opacity?: number;                          // 默认 Pin 透明度(0-1;undefined 用 1)
}

export const PinDefaultsProvider = PinDefaultsContext.Provider;
export function usePinDefaults(): PinDefaults
```

三层优先级（高 → 低）：

1. 节点级覆盖：`node.pinColor` / `node.pinShape` / `node.pinSize`
2. 全局默认：`PinDefaultsContext.value`
3. Pin 级：`pin.color` / `pin.shape` / `pin.size` / `dataType` 内置色

NodeShell 合并引脚时即按此顺序（`node.pinColor ?? pinDefaults.color ?? p.color`）。未 provide 时使用空默认（等价全 undefined，回退到 pin 级）。未提供时默认圆点尺寸 `12`、磁吸圆半径为 `2.2 × pin 直径`（屏幕恒定，经 `invK` / `nodeScale` 反缩放）。

### 4.2 NodeDefaults

```ts
export interface NodeDefaults {
  borderRadius?: number;          // 默认圆角(世界坐标像素;undefined 时 NodeShell 回退到 8)
  outlineWidth?: number;          // 默认外轮廓厚度(世界坐标像素;undefined 时 NodeShell 回退到 1)
  outlineColor?: string;          // 默认外轮廓颜色(非选中)
  outlineSelectedColor?: string;  // 选中态外轮廓颜色(undefined 时回退内置默认 #e94560)
  fillColor?: string;             // 默认底色(undefined 时回退 color prop / 内置默认)
  titleColor?: string;            // 标题栏颜色(未选中)
  titleSelectedColor?: string;    // 标题栏选中态颜色
  contentTextColor?: string;      // 内容区文本颜色
  titleBackground?: string;       // 标题栏底色(undefined 时回退 canvas 背景色)
}

export const NodeDefaultsProvider = NodeDefaultsContext.Provider;
export function useNodeDefaults(): NodeDefaults
```

三层优先级（高 → 低）：

1. 节点级覆盖：`node.borderRadius` / `node.outlineWidth` / `node.outlineColor` / `node.backgroundColor` / `node.nodeColor`
2. 全局默认：`NodeDefaultsContext.value`（由 app 层从 `canvasConfig` + `theme.node` 注入）
3. NodeShell / `DefaultNodeContent` 内置硬编码默认

设计约束：**render-react 不依赖 plugin-theme**，颜色 token 由 app 层读取 `theme.node` 后注入，保持渲染包与主题解耦。

---

## 5. 无边线原则

节点外壳不使用 `border`，一律用 **CSS `outline`** 表达轮廓。依据（`node-shell.tsx` 源码注释）：

> CSS outline 替代 border：不占布局空间，支持透明 rgba，跟随圆角。

派生规则：

1. **不占布局空间**：outline 不参与盒模型，节点尺寸变化不会引起布局抖动；选中描边（2px 红色）不会挤压内容区。
2. **支持透明 rgba**：`rgba(233,69,96,0.95)` 等半透明选中/悬停色可直接使用。
3. **跟随 border-radius**：outline 沿圆角绘制，与 `borderRadius`（默认 8，`tileMode` 下为 0）一致。
4. **无叠加态**：连线悬停蓝与选中红互斥（单一元素渲染），避免蓝/红叠加态；hover 阴影由 `box-shadow` 承担（NodeShell `0 2px 4px`、NodeItem `0 2px 6px`，过渡 `0.15s cubic-bezier(0.22,1,0.36,1)`）。
5. **选中光晕由外层 box-shadow 负责**，outline 只负责描边本身；`outlineOffset`（默认 0）可让描边外扩。

`DefaultNodeContent`（无 renderer 时的兜底内容）同样遵循：自带单层 outline（NodeItem 外层不画 outline）。

---

## 6. 动效节奏

### 6.1 契约：NodeMotionContract

```ts
// packages/core/src/node-runtime-contract.ts
export interface NodeMotionContract {
  switch?: 'none' | 'fade' | 'crossfade' | 'slide';  // 内容/卡片切换动画类型
  durationMs?: number;                               // 动画时长(毫秒)
  reducedMotionFallback?: 'none' | 'fade';           // 系统「减弱动态效果」时的回退
}

export interface NodeVisualContract {
  appearance: 'shell' | 'custom';
  selectionMode: NodeSelectionMode;
  hover?: NodeStateStyle;
  selected?: NodeStateStyle;
  disabled?: NodeStateStyle;
  focus?: NodeStateStyle;
  motion?: NodeMotionContract;
  themeTokens?: Record<string, string>;
}
```

`motion` 声明在 `NodeVisualContract` 上（`NodeDefinition.visual.motion`）。`switch` 描述节点内容切换（如 StackNode 换卡）的动画类型，`durationMs` 给出统一时长基准，`reducedMotionFallback` 声明系统开启减弱动态效果时的降级（`'none'` 关闭或 `'fade'` 保留淡入淡出）。

### 6.2 实际节奏基准（与契约对齐的实现）

| 位置 | 节奏 |
| --- | --- |
| NodeShell outline/阴影过渡 | `0.15s cubic-bezier(0.22,1,0.36,1)`（`box-shadow` 与 `outline-color`） |
| NodeItem 外层阴影 | `0.15s cubic-bezier(0.22,1,0.36,1)` |
| 工具栏按钮 hover | `background 0.15s, color 0.15s` |
| StackNode 卡片切换 | `SWITCH_ANIM_MS = 300`（`stacked-media-node-view.tsx`；动画期间所有卡片渲染静帧缩略图、视频暂停渲染） |
| 视口动画 | `animateViewport(targetX, targetY, targetK, durationMs = 300)`（render-react store） |
| 主题切换 | `AnimatedThemeToggler` 使用 View Transitions API |

> 约定：节点级交互过渡以 `150ms` 为默认基准，卡片/内容切换以 `300ms` 为基准；具体数值应优先通过 `NodeMotionContract.durationMs` 声明，供统一调节。

---

## 7. LOD 降级与图标规范

### 7.1 低缩放 LOD（`node-layer.tsx`）

```ts
// P1-3: 低缩放 LOD (k < 0.35) — 渲染轻量占位(色块+标题),不渲染节点内容
const isLowZoom = invK > 1 / 0.35; // invK = 1/k, 所以 k < 0.35 时 invK > 2.857
```

- 视口缩放 `k < 0.35` 时，`NodeItem` 不渲染节点内容（视频/图片/音频等重型内容），改为色块 + 标题占位：`data-node-lod="placeholder"`，底色取 `node.backgroundColor ?? node.nodeColor ?? nodeDefaults.fillColor ?? ext?.color ?? '#16213e'`。
- 占位仍保留交互（pointer 事件、双击聚焦、`node.locked` 禁用、`node.opacity`），选中红框 `0 0 0 1px #e94560`、hover 阴影照常。
- `BlockCanvasLayer`（`block-canvas-layer.tsx`）提供色块级 LOD（`lodLevel=2`）设计：用 **1 个 `<canvas>` 元素 + `drawImage` 批量绘制**全部节点的色块/缩略图（替代 N 个 DOM），`ImageBitmap` 预解码移出主线程、视口剔除、单帧批量绘制，选中节点由 DOM 缩略图级渲染覆盖。

### 7.2 其他性能相关视觉控制

- **遮挡裁剪（culling）**：`NodeLayer` 用空间索引 `queryRect` 跳过视口外节点 DOM（`OVERSCAN_RATIO = 0.2`），缩放/平移帧内只做矩形相交判断。
- **GPU 加速缩放**：等比缩放（`uniform` 或 `lockAspectRatio`）时用 `transform: scale` 替代 width/height 过渡，避免 layout 重算导致文字模糊；非等比节点（切分/裁剪切片）回退真实尺寸渲染。
- **`specialAppearance`**：特化外观节点（气泡音频、StackNode）不参与全局外观配置与尺寸计算操作（基准尺寸恢复等），但仍参与 LOD 降级与位置类操作（排列/对齐/分布），外观由节点视图自行特化渲染，忽略 `NodeDefaults` 全局默认。

### 7.3 图标规范

1. **禁止 emoji**：项目约定图标一律用图标库或 SVG（`node-tools.tsx` 注释「图标用 lucide-react（符合项目约定：禁止 emoji）」）。
2. **`icon` 字段类型为 `unknown`**（`ToolDefinition.icon`）：`string` 视为 icon name（渲染层用 icon font/svg 渲染），其他值由渲染层断言为 `ReactNode` 直接渲染（`node-hover-toolbar.tsx` 的 `resolveIcon`）。
3. **零依赖图标**：`image-editor/tools.tsx` 自研内联 SVG，统一规格：`width/height 16`、`viewBox '0 0 24 24'`、`fill 'none'`、`stroke 'currentColor'`、`strokeWidth 2`、`strokeLinecap/linejoin 'round'`，颜色跟随 `currentColor` 适配主题。
4. **动态图标**：状态相关图标由函数返回（如 resize 的锁/开锁切换 `queries?.isFreeResize?.(node) ? <LockOpenIcon /> : <LockIcon />`）。
5. **主题色取用**：业务图标颜色优先取 `theme.toolbar.textMuted` / `theme.node.fill` 等 token，禁止硬编码明暗两套色值。
