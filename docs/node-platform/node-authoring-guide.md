# ZeroExo 自定义节点创作指南（Node Authoring Guide）

> 本文档从零讲解如何创建并注册一个自定义节点。所有接口签名均与当前源码精确一致，可对照以下文件核实：
>
> - 扩展契约：`zeroexo_front/packages/core/src/extensions/types.ts`
> - 视图契约：`zeroexo_front/packages/core/src/node-view-contract.ts`
> - 运行时契约：`zeroexo_front/packages/core/src/node-runtime-contract.ts`
> - 数据模型：`zeroexo_front/packages/core/src/model/types.ts`
> - 注册中心：`zeroexo_front/packages/plugins/node-registry/src/index.ts`
> - 注册入口（内置节点集）：`zeroexo_front/packages/plugins/nodes/src/index.tsx`
> - 注册入口（app 层扩展工厂）：`zeroexo_front/src/features/canvas-nodes/extensions.tsx` 与 `zeroexo_front/src/pages/editor/editor-canvas/use-editor-state.ts`
> - 主题配色：`zeroexo_front/packages/shared/src/index.ts`

---

## 1. 概念：一个节点由什么组成

画布中的数据模型是 `NodeRecord`，框架只记录位置、类型、尺寸和内容：

```ts
export interface NodeRecord {
  id: string;
  type: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  data?: unknown;                       // 业务内容，框架不关心
  parentId?: string | null;
  childrenIds?: string[];
  bounds?: Rect;
  boundsDirty?: boolean;
  zIndex?: number;
  title?: string;
  siblingOrder?: number;
  logicalIndex?: number;
  hidden?: boolean;
  locked?: boolean;
  backgroundColor?: string;
  borderRadius?: number;
  outlineColor?: string;
  outlineWidth?: number;
  outlineOffset?: number;
  opacity?: number;
  titleBackgroundColor?: string;
  contentBackgroundColor?: string;
  nodeColor?: string;
  theme?: 'light' | 'dark';
  // Pin 节点级统一覆盖(优先级高于 pin.color/shape/size)
  pinColor?: string;
  pinShape?: 'circle' | 'square';
  pinSize?: number;
}
```

一个「自定义节点」= 三部分：

| 部分 | 载体 | 职责 |
| --- | --- | --- |
| 类型元数据 | `NodeTypeExtension` | type/displayName/category/color、Pin 定义、尺寸约束、能力声明 |
| 视图 | `renderNode`（可选 `renderProperties`） | React 组件，负责展示与交互 |
| 运行时行为 | `runtime`、`canConnect`、`getTools` | 缩放/外观契约、连线规则、工具栏工具 |

注册一个节点类型 = 构造一个 `NodeTypeExtension` 对象并调用注册中心的 `register`（批量用 `registerAll`）。

---

## 2. NodeTypeExtension 字段说明

完整签名（`packages/core/src/extensions/types.ts`）：

```ts
export interface NodeTypeExtension {
  type: string;
  displayName: string;
  category: string;
  color: string;
  icon?: string;

  /** 领域能力声明与运行时行为，View 不应读取未声明的节点字段。 */
  capabilities?: NodeCapabilities;
  runtime?: NodeRuntimeContract;

  getPins?(node: NodeRecord): Pin[];
  renderNode?: NodeRenderer;
  renderProperties?: PropertiesRenderer;
  createDefaultData?(): unknown;
  defaultSize?: { width: number; height: number };
  validate?(node: NodeRecord): { valid: boolean; errors?: string[] };

  /** 是否允许 resize(默认 false,需显式启用) */
  resizable?: boolean;
  /** 最小尺寸约束 */
  minSize?: { width: number; height: number };
  /** 最大尺寸约束 */
  maxSize?: { width: number; height: number };
  /** 是否锁定宽高比(图片/视频节点通常为 true) */
  lockAspectRatio?: boolean;

  /**
   * 特化外观节点(如气泡音频节点/资源浏览器节点)。
   * 不参与全局外观配置与尺寸计算操作(基准尺寸恢复等)，但仍参与 LOD 降级与位置类操作。
   */
  specialAppearance?: boolean;

  /** 节点视图契约(可选,MVVM)。声明排布边界与各状态视觉的渲染归属。 */
  viewContract?: NodeViewContract;

  canConnect?(
    source: { nodeId: string; pinId: string; direction: 'input' | 'output' },
    target: { nodeId: string; pinId: string; direction: 'input' | 'output' },
  ): { valid: boolean; reason?: string } | void;

  getTools?(node: NodeRecord, ctx: ToolContext): ToolDefinition[];
}
```

逐字段说明：

### 2.1 基础元数据

- **`type: string`（必填）**——类型标识，全局唯一。重复注册会抛错：`Node type "${type}" already registered by "${registeredBy}"`。
- **`displayName: string`（必填）**——节点菜单/标题栏显示名。注册中心按它做模糊搜索评分（完全匹配 100 / 前缀 80 / 包含 60）。
- **`category: string`（必填）**——分类名。**支持层级分类**，用 `/` 分隔（如 `'AI/Image'`），注册中心 `categoryTree()` 会按 `/` 拆分构建分类树。`'_hidden'` 开头的分类不会出现在普通节点菜单（如内置的 ai-placeholder）。
- **`color: string`（必填）**——节点主题色。当 `NodeRecord` 未设置 `nodeColor` 时，NodeShell 用它作为边框/标题栏等默认色。
- **`icon?: string`**——可选图标名（渲染层解释为 icon font/svg）。

### 2.2 数据与引脚

- **`getPins?(node: NodeRecord): Pin[]`**——返回该节点的引脚定义（见 §3）。可以基于节点数据动态返回（例如堆叠节点随卡片类型变化）。
- **`renderNode?: NodeRenderer`**——节点主渲染器，类型为：

  ```ts
  export type NodeRenderer = (props: NodeRendererProps) => unknown;

  export interface NodeRendererProps {
    node: NodeRecord;
    pins: Pin[];
    isSelected: boolean;
    isHovered: boolean;
    updateNode: (patch: Partial<NodeRecord>) => void;
    /** 命令队列(用于提交命令,如 ResizeNodeCommand,支持撤销/重做) */
    commandQueue?: CommandQueue;
    /** 1/viewport.k(画布缩放的倒数),用于标题栏等元素的屏幕恒定尺寸反缩放 */
    invK?: number;
    /** 强制显示所有引脚(连线拖拽期间所有节点Pin可见) */
    forceShowPins?: boolean;
    /** 外部触发重命名(由工具栏按钮触发) */
    externalRenaming?: boolean;
    /** 重命名完成/取消回调 */
    onRenameFinish?: () => void;
    /** 节点缩放比例(与 defaultSize 的比值,如 2 表示宽高各放大 2 倍) */
    pinScaleX?: number;
    pinScaleY?: number;
  }
  ```

  注意 `NodeRendererProps` **不包含引脚事件回调**。内置节点集的做法是：插件 `install` 时从 `PluginContext` 获取 `ConnectionController`，通过闭包传入渲染器，再用 `createPinHandlers(controller, node.id)` 构造引脚回调（见 §5/§8）。
- **`renderProperties?: PropertiesRenderer`**——属性面板渲染器（可选）：

  ```ts
  export interface PropertiesRendererProps {
    node: NodeRecord;
    updateNode: (patch: Partial<NodeRecord>) => void;
  }
  export type PropertiesRenderer = (props: PropertiesRendererProps) => unknown;
  ```

- **`createDefaultData?(): unknown`**——新建节点时初始化 `node.data` 的工厂函数。**必须返回视图预期的完整结构**，避免老数据/空数据崩溃。
- **`validate?(node: NodeRecord): { valid: boolean; errors?: string[] }`**——可选校验钩子。

### 2.3 尺寸约束

- **`defaultSize?: { width: number; height: number }`**——新建节点时的默认尺寸。
- **`resizable?: boolean`**——是否允许缩放。**默认 `false`，必须显式开启**，否则画布不显示 resize handle。
- **`minSize` / `maxSize?: { width: number; height: number }`**——缩放上下限。
- **`lockAspectRatio?: boolean`**——是否锁定宽高比（图片/视频节点通常为 `true`）。

### 2.4 specialAppearance

**`specialAppearance?: boolean`**——特化外观节点（如气泡音频节点、StackNode 资源浏览器）。此类节点：
- 不参与全局外观配置与尺寸计算操作（如基准尺寸恢复）；
- 仍参与 LOD 降级与位置类操作（排列/对齐/分布）；
- 外观由节点视图自行特化渲染，忽略 `NodeDefaults` 全局默认。

### 2.5 viewContract（NodeShell 渲染归属，详见 §5）

```ts
export interface NodeViewContract {
  /** 参与自动排布/碰撞/框选命中的边界(相对节点 position 的世界坐标尺寸)。省略时画布使用 node.size。 */
  getBounds?: (node: NodeRecord) => { width: number; height: number };
  /** 选中视觉:默认 NodeShell outline;custom 时视图自绘 */
  selectionEffect?: 'default' | 'custom';
  /** focus(双击聚焦)视觉,同上 */
  focusEffect?: 'default' | 'custom';
  /** hover 视觉,同上 */
  hoverEffect?: 'default' | 'custom';
  /** 连线拖拽悬停视觉(蓝色指示),同上 */
  connectionHoverEffect?: 'default' | 'custom';
  /** 是否由 NodeShell 提供标题栏等铬件(默认 true 保留;false 时节点全自绘) */
  useShellChrome?: boolean;
}
```

省略 `viewContract` 时全部走 `'default'`（存量节点零改动）。

### 2.6 canConnect（连线规则）

```ts
canConnect?(
  source: { nodeId: string; pinId: string; direction: 'input' | 'output' },
  target: { nodeId: string; pinId: string; direction: 'input' | 'output' },
): { valid: boolean; reason?: string } | void;
```

调用约定：
- 调用时机：`ConnectionController.validate` 通过默认规则（自连/方向/重复）之后。
- **调用方向：始终以 `output → input` 语义调用，`source` 为输出端，`target` 为输入端。**
- 双端钩子：源节点与目标节点的 `canConnect` 都会被调用（若不同），任一拒绝即拒绝。
- 返回值语义：
  - `{ valid: false, reason }` 拒绝连线（reason 会显示给用户）；
  - `{ valid: true }` 显式允许（仍会调用对端钩子）；
  - `void/undefined` 中立（继续后续校验）。

典型用途：image 节点 out 只能连 image dataType 的 in；业务节点限制最大输入连接数；分镜节点只允许剧本节点连入（见 §8 示例）。

### 2.7 capabilities 与 runtime

```ts
export interface NodeCapabilities {
  stackable?: boolean;      // 是否可被 StackNode 收纳
  mediaKinds?: string[];    // 媒体类型(如 ['image']、['video']、['audio']、['text'])
  capabilities?: string[];  // 开放字符串集合,推荐领域前缀: 'media.crop'、'media.replace'、'stack.merge'
}
```

- `capabilities` 是**声明**，不是实现。**View 不应读取未声明的节点字段**（契约注释原文）。
- `runtime?: NodeRuntimeContract` 描述节点运行时行为（尺寸/外观契约、命令构造、测量边界）：

```ts
export interface NodeRuntimeContract {
  definition?: NodeDefinition;
  createCommands?: (node: NodeRecord, context: NodeRuntimeContext) => Command[];
  getMeasureBounds?: (node: NodeRecord) => { width: number; height: number };
}

export interface NodeDefinition {
  schemaVersion: number;
  size?: NodeScaleContract;
  measure?: NodeElementMeasureContract;
  visual?: NodeVisualContract;
  overlay?: OverlayContract;
  capabilities?: NodeCapabilities;
}

export interface NodeScaleContract {
  basis: NodeSizeBasis;                       // { width; height; referenceSize? }
  mode: NodeScaleMode;                        // 'free' | 'uniform' | 'locked'
  min?: { width: number; height: number };
  max?: { width: number; height: number };
  preserveAspectRatio?: boolean;
}

export interface NodeVisualContract {
  appearance: 'shell' | 'custom';             // 外壳渲染 or 全自绘
  selectionMode: NodeSelectionMode;           // 'runtime' | 'custom'
  hover?: NodeStateStyle;
  selected?: NodeStateStyle;
  disabled?: NodeStateStyle;
  focus?: NodeStateStyle;
  motion?: NodeMotionContract;                // switch: 'none'|'fade'|'crossfade'|'slide'
  themeTokens?: Record<string, string>;
}

export interface NodeRuntimeContext {
  commandQueue: CommandQueue;
  graph: { nodes: NodeRecord[]; edges: EdgeRecord[] };
  actor: CanvasActor;                         // 'user' | 'agent' | 'import' | 'stress'
  operationId: string;
}
```

内置节点的标准工厂（`packages/plugins/nodes/src/index.tsx` 的 `createNodeRuntime`）：

```ts
function createNodeRuntime(
  defaultSize: { width: number; height: number },
  options: { mode?: 'free' | 'uniform' | 'locked'; appearance?: 'shell' | 'custom'; preserveAspectRatio?: boolean } = {},
): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...defaultSize, referenceSize: 500 },
        mode: options.mode ?? 'free',
        preserveAspectRatio: options.preserveAspectRatio ?? false,
      },
      visual: {
        appearance: options.appearance ?? 'shell',
        selectionMode: 'runtime',
      },
    },
  };
}
```

### 2.8 getTools（悬浮工具栏工具集，详见 §6）

```ts
getTools?(node: NodeRecord, ctx: ToolContext): ToolDefinition[];
```

返回该节点类型的工具栏工具定义数组，由渲染层 `NodeHoverToolbar` 组件调用。`icon` 为 `unknown` 类型（core 不依赖 React，约定：string 视为 icon name，其他由渲染层断言为 ReactNode 渲染）。

---

## 3. Pin 定义

```ts
/** 引脚定义(UE5 风格命名: Pin) */
export interface Pin {
  id: string;
  name: string;
  direction: 'input' | 'output';
  color?: string;
  dataType?: string;
  /** 形状('circle'|'square';undefined 用 'circle') */
  shape?: 'circle' | 'square';
  /** 尺寸(像素;undefined 用 12) */
  size?: number;
}
```

- **`id`**：同节点内唯一，连线（`EdgeRecord`）用它作为 `source.pinId` / `target.pinId`。
- **`direction`**：`'input'`（左，可被连入）/ `'output'`（右，可连出）。
- **`dataType`**：语义类型（如 `'text'`、`'image'`、`'float'`）。作为 `dataType` 未提供 `color` 时的内置色来源（legacy 色表见 `@zeroexo/shared` 的 `PORT_COLORS`：exec `#ffffff`、bool `#b3474b`、int/float `#3cb371`、string `#ee9d3d`、object `#3c87b3`、struct `#2ecc71`、enum `#9b59b6`、array `#7f8c8d`、any `#95a5a6`）。

**Pin 外观三层优先级**（高 → 低，见 `packages/plugins/render-react/src/pin-defaults.ts`）：

1. 节点级覆盖：`node.pinColor` / `node.pinShape` / `node.pinSize`；
2. 全局默认：`PinDefaultsProvider`（`PinDefaults`：`color` / `shape` / `size` / `opacity`）；
3. Pin 级：`pin.color` / `pin.shape` / `pin.size` / `dataType` 内置色。

示例：

```ts
const NOTE_PINS: Pin[] = [
  { id: 'input', name: 'Input', direction: 'input', dataType: 'text', color: '#ee9d3d' },
  { id: 'output', name: 'Output', direction: 'output', dataType: 'text', color: '#ee9d3d' },
];
```

---

## 4. 通过 PluginNodesPlugin.registerAll 注册

### 4.1 底层注册中心 NodeRegistryPlugin

`packages/plugins/node-registry/src/index.ts`，纯逻辑插件，id 为 `'node-registry'`。核心 API：

```ts
register(definition: NodeTypeExtension, registeredBy = 'app'): void;
unregister(type: string): void;
registerAll(definitions: NodeTypeExtension[], registeredBy = 'app'): void;
get(type: string): NodeTypeExtension | undefined;
all(): NodeTypeExtension[];
types(): string[];
byCategory(category: string): NodeTypeExtension[];
categories(): string[];
categoryTree(): CategoryNode[];
search(query: string, limit = 20): SearchResult[];
size(): number;
has(type: string): boolean;
registeredBy(type: string): string | undefined;
```

注意：`register` 遇到重复 `type` 直接抛错；`registeredBy` 用于标记注册来源（插件 id 或 `'app'`），便于排查冲突。

### 4.2 统一注册入口 PluginNodesPlugin

`packages/plugins/nodes/src/index.tsx` 的 `PluginNodesPlugin`（id `'nodes'`，依赖 `['node-registry', 'connection']`）对外暴露注册中心代理方法，是 **app 层注册自定义节点的统一入口**：

```ts
class PluginNodesPlugin implements Plugin {
  id = 'nodes';
  dependencies = ['node-registry', 'connection'];

  // install 时:取 node-registry → connection(引脚拖拽) → render-react store,
  // 创建并逐条注册内置 7 种节点(text/generator/image/video/audio/ai-placeholder/stacked-media):
  //   registry.register(ext, this.id);

  // ===== 注册中心代理(app 统一入口) =====
  getRegistry(): NodeRegistryPlugin;                       // 未 install 时抛错
  register(definition: NodeTypeExtension, registeredBy = 'app'): void;
  registerAll(definitions: NodeTypeExtension[], registeredBy = 'app'): void;
  get(type: string): NodeTypeExtension | undefined;
  all(): NodeTypeExtension[];
  search(query: string, limit = 20): SearchResult[];
  types(): string[];
  byCategory(category: string): NodeTypeExtension[];
  categories(): string[];
  categoryTree(): CategoryNode[];
  size(): number;
  has(type: string): boolean;
}
```

### 4.3 注册时机与位置

**必须等 `PluginNodesPlugin` install 之后**再调用 `registerAll`，否则 `getRegistry()` 抛错：

```
PluginNodesPlugin not installed: call editor.install(plugin) first
```

app 层标准调用点（`src/pages/editor/editor-canvas/use-editor-state.ts`，在 `createDefaultEditor(...)` 之后）：

```tsx
const ed = createDefaultEditor({ container, storageKey: 'zeroexo:graph', aiProvider });
const { commandQueue } = ed.core;
const store = ed.store;

// 在 editor install 完成后注册自定义节点
ed.plugins.nodes.registerAll(
  createMyExtensions(
    ed.plugins.connection?.getController() ?? null,
    () => ed.store,
  ),
);
```

若需要「连线控制器」读取任意节点的扩展定义（`canConnect` 用），还需要注入扩展访问器：

```tsx
const nodeRegistry = ed.core.plugins.get('node-registry');
const connectionController = ed.plugins.connection?.getController();
if (nodeRegistry && connectionController) {
  connectionController.setExtensionAccessor((nodeId: string) => {
    const node = ed.store.getGraph().nodes.find((n) => n.id === nodeId);
    if (!node) return undefined;
    return nodeRegistry.get(node.type);
  });
}
```

### 4.4 createCreationExtensions 工厂模式（推荐）

参照 `src/features/canvas-nodes/extensions.tsx`：用「工厂函数」批量构造扩展，最后用一个函数返回数组供 `registerAll` 使用。工厂内部把 `ConnectionController` / `getStore` 通过闭包注入渲染器与 `canConnect`：

```tsx
// 各剧创节点统一 runtime(自由缩放 + 标准 NodeShell 外观)
function createCreationRuntime(defaultSize: { width: number; height: number }): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...defaultSize, referenceSize: 500 },
        mode: 'free',
        preserveAspectRatio: false,
      },
      visual: {
        appearance: 'shell',
        selectionMode: 'runtime',
      },
    },
  };
}

function createCreationExtension(
  kind: CreationNodeType,
  controller: ConnectionController | null,
  nameKey: string,
  getStore: () => ReactGraphStore | null,
): NodeTypeExtension {
  return {
    type: kind,
    displayName: i18next.t(nameKey),
    category: '创作',
    color: CREATION_COLOR[kind],
    defaultSize: CREATION_DEFAULT_SIZE[kind],
    minSize: CREATION_MIN_SIZE[kind],
    resizable: true,
    capabilities: CREATION_CAPABILITIES[kind],
    runtime: createCreationRuntime(CREATION_DEFAULT_SIZE[kind]),
    viewContract: {
      selectionEffect: 'default',
      focusEffect: 'default',
      hoverEffect: 'default',
      connectionHoverEffect: 'default',
      useShellChrome: true,
    },
    getPins: () => CREATION_PINS[kind],
    canConnect,
    getTools: ...,
    createDefaultData: ...,
    renderNode: (props: NodeRendererProps) => (
      <CreationNodeView {...props} connectionController={controller} kind={kind} />
    ),
  };
}

/** 构建全部扩展列表(供 nodesPlugin.registerAll 注册) */
export function createCreationExtensions(
  controller: ConnectionController | null,
  getStore?: () => ReactGraphStore | null,
): NodeTypeExtension[] {
  return (['script', 'storyboard', 'workbench'] as CreationNodeType[]).map((kind) =>
    createCreationExtension(kind, controller, CREATION_NAME_KEY[kind], getStore ?? (() => null)),
  );
}
```

两种注册位置的取舍：

| 位置 | 方式 | 适用场景 |
| --- | --- | --- |
| app 层（`src/`） | `ed.plugins.nodes.registerAll(createXxxExtensions(...))` | 节点依赖 app 页面组件（如剧创节点的全屏编辑器） |
| 插件包内 | 插件 `install` 里 `context.getPlugin('node-registry')` 后逐条 `registry.register(ext, this.id)` | 节点完全自包含、可独立发布 |

---

## 5. NodeShell 渲染归属：viewContract 的 default/custom 与 useShellChrome

### 5.1 机制

- 渲染层（`render-react`）的 `NodeLayer` 读取扩展定义，把 `ext.viewContract` 通过 `NodeViewContractContext.Provider` 注入 `NodeShell` 与自身。
- `NodeShell`（`@zeroexo/plugin-render-react` 导出）是**通用节点外壳**：标题栏、左右引脚布局、引脚拖拽回调、选中 outline、hover 阴影等。
- `NodeShellProps` 由 `BaseNodeView` 透传（见下）。

### 5.2 各状态效果的归属

| viewContract 字段 | `'default'` | `'custom'` |
| --- | --- | --- |
| `selectionEffect` | NodeShell 渲染选中红框 outline | 节点视图自绘 |
| `focusEffect` | NodeShell 渲染 focus 视觉 | 节点视图自绘 |
| `hoverEffect` | NodeLayer 渲染 hover 阴影（`boxShadow`） | NodeLayer 跳过阴影，视图自绘 |
| `connectionHoverEffect` | NodeShell 渲染连线拖拽悬停蓝框 | 节点视图自绘 |
| `useShellChrome` | `true`（默认）：NodeShell 渲染标题栏 | `false`：整节点全自绘（含标题栏） |

渲染层关键逻辑（源码摘录）：
- `node-layer.tsx`：`boxShadow: (isHovered && ext?.viewContract?.hoverEffect !== 'custom') ? ... : 'none'`；
- `node-shell.tsx`：`const selectionCustom = viewContract?.selectionEffect === 'custom';`、`{(viewContract?.useShellChrome !== false && (title || titleIcon || titleSize)) ? (标题栏) : null}`。

### 5.3 外观优先级

NodeShell 渲染遵循三层优先级（高 → 低，`pin-defaults.ts` 注释）：

1. 节点级字段：`node.backgroundColor` / `node.nodeColor` / `node.outlineColor` / `node.outlineWidth` / `node.borderRadius` / `node.titleBackgroundColor` / `node.contentBackgroundColor` / `node.theme`；
2. 全局默认：`NodeDefaultsProvider`（`borderRadius`/`outlineWidth`/`outlineColor`/`outlineSelectedColor`/`fillColor`/`titleColor`/`titleSelectedColor`/`contentTextColor`/`titleBackground`，由 app 层从 `canvasConfig + theme` 注入）；
3. `NodeShell` / `DefaultNodeContent` 内置硬编码默认。

### 5.4 内置节点视图基类 BaseNodeView

`@zeroexo/plugin-nodes` 导出的 `BaseNodeView` 是所有业务节点的统一外壳（NodeShell 包裹 + 引脚布局 + 引脚拖拽回调），派生节点只需提供 `children`：

```tsx
export interface BaseNodeViewProps {
  node: NodeRecord;
  pins: Pin[];
  isSelected: boolean;
  isHovered: boolean;
  title: string;
  color: string;
  /** 连线控制器(install 时获取,通过闭包传入); null 则引脚不响应拖拽 */
  connectionController: ConnectionController | null;
  forceShowPins?: boolean;
  contentPadding?: React.CSSProperties['padding'];
  invK?: number;
  titleIcon?: React.ReactNode;
  titleSize?: string;
  children: React.ReactNode;
  updateNode?: (patch: Partial<NodeRecord>) => void;
  externalRenaming?: boolean;
  onRenameFinish?: () => void;
  store?: ReactGraphStore | null;
  borderRadiusOverride?: React.CSSProperties['borderRadius'];
}
```

引脚回调：`NodeRendererProps` 不含引脚事件回调，需用 `createPinHandlers(controller, node.id)` 构造：

```ts
export interface PinHandlers {
  onPinPointerDown: (e: React.PointerEvent, pin: Pin) => void;
  onPinPointerEnter: (e: React.PointerEvent, pin: Pin) => void;
  onPinPointerLeave: (e: React.PointerEvent) => void;
}
export function createPinHandlers(controller: ConnectionController | null, nodeId: string): PinHandlers;
```

此外 `@zeroexo/plugin-nodes` 还导出模块级事件总线 `nodeActionBus`（`on(type, handler)` / `emit(type, event)`），用于节点视图 ↔ 页面之间的动作广播（如剧本节点工具广播 `'script:edit'`，由全屏编辑器订阅）。

---

## 6. 工具定义 ToolDefinition / ToolContext

工具栏工具采用「数据驱动 + 策略模式」：工具定义只描述 UI（label/icon/active），业务逻辑通过 `ctx` 注入。

```ts
export interface ToolContext {
  /** 命令队列(提交命令 + getState() 读取画布) */
  commandQueue: CommandQueue;
  /** 事件总线(发布/订阅事件) */
  eventBus: EventBus;
  /** 获取当前选中节点 id 集合 */
  getSelectedNodeIds(): Set<string>;
  /** 打开节点编辑器/属性面板(可选,由渲染层注入) */
  openEditor?(node: NodeRecord): void;
  /** 打开图片编辑对话框(按 type 指定具体编辑器:crop/split/upscale/maskEdit/angle/superResolve/view/info/saveAsset/reversePrompt/replace) */
  openImageDialog?(node: NodeRecord, type: string): void;
}

export interface ToolDefinition {
  /** 工具唯一 id(同节点类型内唯一) */
  id: string;
  /** 工具栏标签(可静态可动态) */
  label: string | ((node: NodeRecord, ctx: ToolContext) => string);
  /** 鼠标悬浮提示(可静态可动态) */
  title: string | ((node: NodeRecord, ctx: ToolContext) => string);
  /** 图标(unknown 由渲染层解释;string 视为 icon name,其他视为 ReactNode) */
  icon: unknown | ((node: NodeRecord, ctx: ToolContext) => unknown);
  /** 是否处于激活态(高亮显示;如"锁比例"工具的按下状态) */
  active?: (node: NodeRecord, ctx: ToolContext) => boolean;
  /** 是否可见(条件显示;如 image 无内容时隐藏"裁剪") */
  visible?: (node: NodeRecord, ctx: ToolContext) => boolean;
  /** 是否为危险操作(红色高亮;如删除) */
  danger?: boolean;
  /** 是否为主要操作(填充强调色背景;如"生成分镜") */
  primary?: boolean;
  /** 工具分组(可选,用于 Detail 面板按组渲染;如 "基础" / "编辑" / "AI") */
  group?: string;
  /** 执行函数(策略实现,通过 ctx 访问业务能力) */
  run: (node: NodeRecord, ctx: ToolContext) => void;
  /**
   * 工具显示在宿主节点上,但作用于另一个领域目标时使用。
   * 典型场景:StackNode 显示当前媒体项的 crop/replace 工具。
   */
  targetNode?: (hostNode: NodeRecord, ctx: ToolContext) => NodeRecord;
  /** 下拉菜单项(可选;存在时渲染为下拉按钮而非普通按钮) */
  menu?: (node: NodeRecord, ctx: ToolContext) => ToolMenuItem[];
}

export interface ToolMenuItem {
  key: string;
  label?: string;
  icon?: unknown;
  divider?: boolean;
  disabled?: boolean;
  /** 点击该菜单项时执行(替代 ToolDefinition.run) */
  run?: (node: NodeRecord, ctx: ToolContext) => void;
}
```

用法要点：

- **变更必须走 `ctx.commandQueue.execute(...)`**（支持撤销/重做、入历史、触发同步）。内置命令见 `packages/core/src/command/builtins.ts`：`AddNodeCommand` / `RemoveNodeCommand` / `MoveNodeCommand` / `MoveNodesCommand` / `AddEdgeCommand` / `RemoveEdgeCommand` / `UpdateNodeDataCommand(nodeId, patch)` / `UpdateNodeTitleCommand` / `ResizeNodeCommand` / `DuplicateNodeCommand` / `BatchCommand`。
- 需要读画布用 `ctx.commandQueue.getState()`（返回 `GraphModel`）。
- 页面级动作（打开编辑器/弹窗）用 `ctx.openEditor?.` / `ctx.openImageDialog?.` 或 `ctx.eventBus.emit(...)`。
- 跨节点动作通过 `nodeActionBus` 广播，由页面订阅（见 §5.4）。
- 图标遵循项目约定用 `lucide-react`（禁止 emoji）。

---

## 7. 主题配色：NodeTokens / ThemeConfig

主题 token 数据定义在 `packages/shared/src/index.ts`，由 `@zeroexo/plugin-theme` 透传并注入 React Context。

```ts
/** 节点 token(节点外观 + outline + pin) */
export interface NodeTokens {
  /** 节点默认底色(所有类型共用) */
  fill: string;
  /** 节点默认底色(legacy,与 fill 同义) */
  defaultColor: string;
  /** 节点默认 outline 色(非选中) */
  outlineColor: string;
  /** 选中态 outline 色 */
  outlineSelectedColor: string;
  /** 悬停态 outline 色 */
  hoverColor: string;
  /** 标题栏文字色 */
  titleColor: string;
  /** 标题栏底色 */
  titleBackground: string;
  /** 内容区底色 */
  contentBackground: string;
  /** pin 默认色 */
  pinDefaultColor: string;
}

/** 主题配置(分 4 类 token + edge) */
export interface ThemeConfig {
  mode: ThemeMode;          // 'light' | 'dark'
  canvas: CanvasTokens;     // background / gridColor / gridColorSubtle / gridDot / gridLine
  node: NodeTokens;
  toolbar: ToolbarTokens;   // background / panel / border / text / textMuted / accent / danger / editorSurface / editorPaper
  group: GroupTokens;       // background / outlineColor / outlineSelectedColor / titleColor
  edge: EdgeTokens;         // color / selectedColor / hoverColor / pendingColor
}

export const DARK_THEME: ThemeConfig;   // stone 暖色调 + 红色强调(#e94560)
export const LIGHT_THEME: ThemeConfig;
export const THEMES: Record<ThemeMode, ThemeConfig> = { dark: DARK_THEME, light: LIGHT_THEME };
```

在节点视图中消费：

```tsx
import { useTheme } from '@zeroexo/plugin-theme';

function MyNodeView(props: NodeRendererProps) {
  const { theme } = useTheme(); // ThemeContextValue: { theme: ThemeConfig; mode; setMode; toggle }
  const fill = theme.node.fill;
  const pinColor = theme.node.pinDefaultColor;
  // ...
}
```

- `useTheme()` 必须在 `ThemeProvider` 内使用，否则抛错。
- 节点自身的主题色优先用 `NodeRecord.nodeColor`，未设置时回退扩展的 `color`。
- 对外观有硬性需求的节点（如自绘 UI 节点）仍建议以 `theme.node.*` 取色，保证明暗主题一致性。

---

## 8. 最小完整示例

以下示例演示 **3 个节点**：一个文本节点、一个媒体节点、一个自定义 UI（全自绘）节点。文件组织参照 `createCreationExtensions` 模式：类型 + 工厂放一个模块，注册放在编辑器初始化处。

### 8.1 类型与默认数据

```tsx
// src/features/canvas-nodes/my-node-types.ts
/** 便签节点 data */
export interface NoteNodeData {
  content: string;
  tags: string[];
  status: 'idle' | 'ready';
}

/** 媒体节点 data */
export interface MediaNodeData {
  content: string;      // storageKey 或 blob URL
  storageKey?: string;
  prompt: string;
  status: 'idle' | 'loading' | 'error' | 'success';
}

/** 自定义 UI 节点 data */
export interface PulseNodeData {
  value: number;
  unit: string;
}
```

### 8.2 扩展工厂

```tsx
// src/features/canvas-nodes/my-extensions.tsx
import type {
  NodeTypeExtension, NodeRendererProps, Pin, NodeRuntimeContract, ToolDefinition,
} from '@zeroexo/core';
import { UpdateNodeDataCommand } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { BaseNodeView, createPinHandlers, nodeActionBus } from '@zeroexo/plugin-nodes';
import type { NoteNodeData, MediaNodeData, PulseNodeData } from './my-node-types.js';

// ===== 通用 runtime 工厂(与内置 createNodeRuntime 一致) =====
function createNodeRuntime(
  defaultSize: { width: number; height: number },
  options: { mode?: 'free' | 'uniform' | 'locked'; appearance?: 'shell' | 'custom'; preserveAspectRatio?: boolean } = {},
): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...defaultSize, referenceSize: 500 },
        mode: options.mode ?? 'free',
        preserveAspectRatio: options.preserveAspectRatio ?? false,
      },
      visual: {
        appearance: options.appearance ?? 'shell',
        selectionMode: 'runtime',
      },
    },
  };
}

// ===== 默认 viewContract(标准 NodeShell) =====
const SHELL_VIEW_CONTRACT = {
  selectionEffect: 'default' as const,
  focusEffect: 'default' as const,
  hoverEffect: 'default' as const,
  connectionHoverEffect: 'default' as const,
  useShellChrome: true,
};

// ============================================================
// 节点 1：便签文本节点 —— 标准 NodeShell + BaseNodeView
// ============================================================

const NOTE_PINS: Pin[] = [
  { id: 'input', name: 'Input', direction: 'input', dataType: 'text', color: '#ee9d3d' },
  { id: 'output', name: 'Output', direction: 'output', dataType: 'text', color: '#ee9d3d' },
];

function createNoteDefaultData(): NoteNodeData {
  return { content: '', tags: [], status: 'idle' };
}

function NoteNodeView(props: NodeRendererProps & { connectionController: ConnectionController | null }) {
  const { node, pins, isSelected, isHovered, connectionController } = props;
  const data = (node.data ?? {}) as Partial<NoteNodeData>;
  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? '便签'}
      color={node.nodeColor ?? '#6b7280'}
      connectionController={connectionController}
    >
      <div style={{ padding: 8, fontSize: 12, color: '#78716c' }}>
        {data.content || '双击编辑'}
      </div>
    </BaseNodeView>
  );
}

function getNoteTools(): ToolDefinition[] {
  return [
    {
      id: 'edit',
      label: '编辑',
      title: '全屏编辑',
      icon: 'maximize',          // string 视为 icon name;也可传 ReactNode
      group: 'basic',
      run: (node) => { nodeActionBus.emit('note:edit', { nodeId: node.id }); },
    },
    {
      id: 'clear',
      label: '清空',
      title: '清空内容',
      icon: 'rotate-ccw',
      group: 'edit',
      danger: true,
      visible: (node) => Boolean((node.data as { content?: string } | null)?.content),
      run: (node, ctx) => {
        // 变更必须走命令队列(支持撤销)
        ctx.commandQueue.execute(new UpdateNodeDataCommand(node.id, { content: '' }));
      },
    },
  ];
}

export function createNoteExtension(controller: ConnectionController | null): NodeTypeExtension {
  return {
    type: 'note',
    displayName: '便签',
    category: 'Basic',
    color: '#6b7280',
    icon: 'sticky-note',
    defaultSize: { width: 320, height: 180 },
    runtime: createNodeRuntime({ width: 320, height: 180 }),
    capabilities: { stackable: true, capabilities: ['note', 'text'] },
    resizable: true,
    minSize: { width: 160, height: 90 },
    viewContract: SHELL_VIEW_CONTRACT,
    getPins: () => NOTE_PINS,
    createDefaultData: createNoteDefaultData,
    getTools: () => getNoteTools(),
    renderNode: (props: NodeRendererProps) => (
      <NoteNodeView {...props} connectionController={controller} />
    ),
  };
}

// ============================================================
// 节点 2：媒体节点 —— 锁宽高比 + 最小尺寸 + canConnect 规则
// ============================================================

const MEDIA_PINS: Pin[] = [
  { id: 'prompt', name: 'Prompt', direction: 'input', dataType: 'text' },
  { id: 'image', name: 'Image', direction: 'output', dataType: 'image' },
];

function MediaNodeView(props: NodeRendererProps & { connectionController: ConnectionController | null }) {
  const { node, pins, isSelected, isHovered, connectionController } = props;
  const data = (node.data ?? {}) as Partial<MediaNodeData>;
  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? '媒体'}
      color={node.nodeColor ?? '#9b59b6'}
      connectionController={connectionController}
      contentPadding={0}              // 无留白填充
    >
      {data.content ? (
        <img src={data.content} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: '#78716c' }}>
          拖入或粘贴媒体
        </div>
      )}
    </BaseNodeView>
  );
}

export function createMediaExtension(
  controller: ConnectionController | null,
  getStore: () => ReactGraphStore | null,
): NodeTypeExtension {
  // 分镜式连线规则:只有声明了 text 能力的节点输出才能连入本节点 input
  const canConnect: NodeTypeExtension['canConnect'] = (source, target) => {
    // 始终以 output → input 语义调用;source 为输出端,target 为输入端
    if (target.pinId !== 'prompt') return;
    const store = getStore();
    if (!store) return;
    const srcNode = store.getNode(source.nodeId);
    if (srcNode && !['note', 'text', 'generator'].includes(srcNode.type)) {
      return { valid: false, reason: '仅接受文本类节点输出' };
    }
  };

  return {
    type: 'media',
    displayName: '媒体',
    category: 'Media',
    color: '#9b59b6',
    defaultSize: { width: 620, height: 348 },
    runtime: createNodeRuntime(
      { width: 620, height: 348 },
      { mode: 'uniform', appearance: 'shell', preserveAspectRatio: true },
    ),
    capabilities: {
      stackable: true,
      mediaKinds: ['image'],
      capabilities: ['media', 'replace'],
    },
    resizable: true,
    lockAspectRatio: true,
    minSize: { width: 80, height: 80 },
    maxSize: { width: 2000, height: 2000 },
    viewContract: SHELL_VIEW_CONTRACT,
    getPins: () => MEDIA_PINS,
    canConnect,
    createDefaultData: (): MediaNodeData => ({ content: '', prompt: '', status: 'idle' }),
    renderNode: (props: NodeRendererProps) => (
      <MediaNodeView {...props} connectionController={controller} />
    ),
  };
}

// ============================================================
// 节点 3：自定义 UI 节点 —— 全自绘(appearance: custom + useShellChrome: false)
// ============================================================

function PulseNodeView(props: NodeRendererProps & { connectionController: ConnectionController | null }) {
  const { node, pins, isSelected, isHovered, connectionController } = props;
  const data = (node.data ?? {}) as Partial<PulseNodeData>;
  const color = node.nodeColor ?? '#06b6d4';
  return (
    <div
      style={{
        position: 'relative', width: '100%', height: '100%', boxSizing: 'border-box',
        // useShellChrome: false → 标题栏也自绘
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, borderRadius: 12, background: '#164e63',
        // selectionEffect: 'custom' → 选中框自绘
        outline: isSelected ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.15)',
        outlineOffset: isSelected ? 2 : 0,
        boxShadow: isHovered ? '0 2px 6px rgba(0,0,0,0.08)' : 'none', // hoverEffect: 'custom'
      }}
    >
      <span style={{ color, fontSize: 13, fontWeight: 600 }}>脉冲仪表</span>
      <span style={{ color: '#f5f5f4', fontSize: 20 }}>
        {data.value ?? 0}
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>{data.unit ?? ''}</span>
      </span>
      {/* 引脚需要自绘(connectionHoverEffect: 'custom';也可用 createPinHandlers + PinView) */}
      {pins.map((pin) => (
        <button
          key={pin.id}
          title={pin.name}
          onPointerDown={(e) => {
            e.stopPropagation();
            createPinHandlers(connectionController, node.id).onPinPointerDown(e as React.PointerEvent<HTMLButtonElement>, pin);
          }}
          style={{
            position: 'absolute',
            left: pin.direction === 'input' ? -5 : undefined,
            right: pin.direction === 'output' ? -5 : undefined,
            top: '50%', transform: 'translateY(-50%)',
            width: pin.size ?? 12, height: pin.size ?? 12, padding: 0,
            borderRadius: pin.shape === 'square' ? 2 : '50%',
            background: pin.color ?? '#a8a29e',
            border: '1px solid #0f172a', cursor: 'crosshair',
          }}
        />
      ))}
    </div>
  );
}

export function createPulseExtension(controller: ConnectionController | null): NodeTypeExtension {
  return {
    type: 'pulse',
    displayName: '脉冲仪表',
    category: 'Widgets',
    color: '#06b6d4',
    defaultSize: { width: 240, height: 200 },
    runtime: createNodeRuntime(
      { width: 240, height: 200 },
      { appearance: 'custom' },   // 全自绘
    ),
    capabilities: { stackable: false, capabilities: ['widget'] },
    resizable: false,
    specialAppearance: true,      // 不参与全局外观配置与尺寸统一
    viewContract: {
      selectionEffect: 'custom',
      focusEffect: 'custom',
      hoverEffect: 'custom',
      connectionHoverEffect: 'custom',
      useShellChrome: false,      // 标题栏自绘
    },
    getPins: () => [
      { id: 'in', name: 'In', direction: 'input', dataType: 'float', shape: 'square', size: 10 },
    ],
    createDefaultData: (): PulseNodeData => ({ value: 0, unit: 'rpm' }),
    renderNode: (props: NodeRendererProps) => (
      <PulseNodeView {...props} connectionController={controller} />
    ),
  };
}

// ============================================================
// 汇总工厂:返回全部扩展列表,供 nodesPlugin.registerAll 注册
// ============================================================

export function createMyExtensions(
  controller: ConnectionController | null,
  getStore?: () => ReactGraphStore | null,
): NodeTypeExtension[] {
  const store = getStore ?? (() => null);
  return [
    createNoteExtension(controller),
    createMediaExtension(controller, store),
    createPulseExtension(controller),
  ];
}
```

### 8.3 注册调用（编辑器初始化处）

```tsx
// src/pages/editor/editor-canvas/use-editor-state.ts(同款位置)
import { createMyExtensions } from '@/features/canvas-nodes/my-extensions.js';

// 必须在 createDefaultEditor(...) 且插件 install 之后
ed.plugins.nodes.registerAll(
  createMyExtensions(
    ed.plugins.connection?.getController() ?? null,
    () => ed.store,
  ),
);
```

注册成功后即可在右键菜单/节点选择器中搜索到新类型（搜索评分按 displayName/type/category 模糊匹配）。

---

## 9. 错误示例与常见坑

### 9.1 ❌ 在 View 中直接修改跨节点数据

```tsx
// ❌ 错误:renderNode 里绕过命令队列直接改其他节点的 data
function BadView(props: NodeRendererProps) {
  const store = useReactGraphStore();
  const onRun = () => {
    const graph = store.getGraph();
    const target = graph.nodes.find((n) => n.id === (props.node.data as { targetId?: string }).targetId);
    if (target) (target.data as Record<string, unknown>).status = 'success'; // 直接改!不可撤销!
  };
  return <button onClick={onRun}>运行</button>;
}
```

问题：变更不经过 `CommandQueue` → 无法撤销/重做、不入历史、不触发 Yjs 实时同步、不产生 `CanvasOperation` 指标，且可能与其他命令并发冲突。

```tsx
// ✅ 正确:通过命令队列提交(支持撤销)
const onRun = (node: NodeRecord, ctx: ToolContext) => {
  const graph = ctx.commandQueue.getState();
  const target = graph?.nodes.find((n) => n.id === (node.data as { targetId?: string }).targetId);
  if (target) {
    ctx.commandQueue.execute(new UpdateNodeDataCommand(target.id, { status: 'success' }));
  }
};
```

架构准则（`node-platform-design.md`）：**View 不直接编排跨节点数据变更，变更必须通过 Model/Command**。`NodeRendererProps.updateNode` 只适合本节点轻量属性更新（如重命名），跨节点/领域变更一律走命令。

### 9.2 ❌ 未声明 capabilities 就读取字段

契约原文注释：`capabilities` 是「领域能力声明与运行时行为，View 不应读取未声明的节点字段」。

```tsx
// ❌ 错误 1:createDefaultData 未提供 cards,getPins 却依赖它
getPins: (node) => {
  const cards = (node.data as { cards?: unknown[] }).cards; // 旧数据/空数据下 undefined → crash
  return cards && cards.length > 0 ? PINS_A : PINS_B;
},

// ❌ 错误 2:读取了未声明的能力字段
// 扩展声明 capabilities: ['media'],但视图假设 node.data.storageKey 一定存在
// (storageKey 属于 'replace'/'media' 能力的数据字段,未声明时不应假设)

// ✅ 正确:createDefaultData 提供完整默认结构 + 防御式解析 + 能力声明齐全
createDefaultData: (): MediaNodeData => ({ content: '', prompt: '', status: 'idle' }),
capabilities: { stackable: true, mediaKinds: ['image'], capabilities: ['media', 'replace'] },
renderNode: (props) => {
  const data = parseMediaData(props.node.data as Record<string, unknown> | undefined); // 解析函数兜底
  ...
},
```

同理：若未声明 `stackable: true` / `mediaKinds`，就不要假设节点会被 StackNode 收纳、也不要假设堆叠流程会调用你的工具（StackNode 的 `canConnect` 白名单按能力判断）。

### 9.3 ❌ type 重复注册

```tsx
registry.register(extA, 'plugin-a'); // type: 'note'
registry.register(extB, 'plugin-b'); // type: 'note' → 抛错
// Error: Node type "note" already registered by "plugin-a"
```

`type` 必须全局唯一。若与内置类型冲突，请更换类型名。用 `registry.has(type)` 或 `registeredBy(type)` 排查。

### 9.4 ❌ 忘记开启 resizable

```tsx
// ❌ 不写 resizable 就期望能缩放
{
  type: 'note',
  defaultSize: { width: 320, height: 180 },
  // resizable 缺省为 false → 画布不显示 resize handle
}

// ✅ resizable: true,需要时再加 minSize/maxSize/lockAspectRatio
```

### 9.5 ❌ 在插件 install 之前调用 registerAll

```tsx
// ❌ 在 createDefaultEditor 之前/并行调用
ed.plugins.nodes.registerAll(...); // PluginNodesPlugin 未 install → getRegistry() 抛错
```

必须在 `createDefaultEditor(...)`（完成插件安装）之后注册。

### 9.6 ❌ canConnect 忘记「output → input」语义

`canConnect` 永远以输出端为 `source`、输入端为 `target` 调用。若按「输入连出」判断方向，会出现行为与预期相反：

```tsx
// ❌ 方向写反:判断的是 target 是否是输出端
canConnect: (source, target) => {
  if (target.direction !== 'output') return { valid: false, reason: 'x' }; // 语义错误
},
// ✅ source 恒为输出端,target 恒为输入端
canConnect: (source, target) => {
  if (target.pinId !== 'prompt') return;
  ...
}
```

---

## 附：检查清单（接入新节点前）

- [ ] `type` 全局唯一，`displayName` / `category` / `color` 齐全（category 可用 `'AI/Image'` 层级）。
- [ ] `createDefaultData` 返回视图预期的**完整**结构；读取 data 前做防御式解析。
- [ ] `capabilities` 声明与实际行为一致（stackable / mediaKinds / capabilities）；View 不读取未声明字段。
- [ ] 需要缩放时显式 `resizable: true`，并按需 `minSize` / `maxSize` / `lockAspectRatio`。
- [ ] `runtime.definition` 提供 `schemaVersion: 1` 与 `size.basis`；自绘节点设 `visual.appearance: 'custom'`。
- [ ] `viewContract` 声明状态视觉归属；全自绘节点 `useShellChrome: false` 并自行绘制标题栏/outline/引脚。
- [ ] 工具栏 `getTools` 的 `run` 全部通过 `ctx.commandQueue` 提交变更。
- [ ] 在 `createDefaultEditor` 之后调用 `ed.plugins.nodes.registerAll(...)`。
- [ ] 跨节点数据变更使用 Command；Agent 场景提供对应 `CanvasOp`（`actor: 'agent'` + `traceId` + `idempotencyKey`）。
