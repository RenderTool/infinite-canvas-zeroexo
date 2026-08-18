# Node 能力复用指南

本文档面向节点作者与扩展开发者，说明 ZeroExo 中节点能力（Capability）如何声明、如何被 StackNode 等容器复用，以及工具（Tool）如何在节点类型之间代理复用。所有签名与源码精确一致，正文为中文、API/代码为英文。

相关源码：

- `zeroexo_front/packages/core/src/node-runtime-contract.ts` — `NodeCapabilities`
- `zeroexo_front/packages/core/src/extensions/types.ts` — `ToolDefinition` / `ToolContext` / `NodeTypeExtension`
- `zeroexo_front/packages/plugins/nodes/src/nodes/stacked-media-model.ts` — StackNode 纯数据层
- `zeroexo_front/packages/plugins/nodes/src/index.tsx` — 节点扩展与 `getTools`
- `zeroexo_front/packages/plugins/nodes/src/node-tools.tsx` — 各节点工具集
- `zeroexo_front/packages/plugins/image-editor/src/tools.tsx` / `types.ts` — 图片快捷工具复用
- `zeroexo_front/packages/plugins/render-react/src/components/node-hover-toolbar.tsx` — 工具栏消费端

---

## 1. 能力声明：NodeCapabilities

能力挂载在节点类型扩展上，由 `NodeTypeExtension.capabilities` 声明；同时 `NodeDefinition.capabilities`（Runtime Contract 侧）保留同名字段。

```ts
// packages/core/src/node-runtime-contract.ts
export interface NodeCapabilities {
  stackable?: boolean;
  mediaKinds?: string[];
  capabilities?: string[];
}
```

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `stackable` | `boolean?` | 是否可被收纳进 StackNode。`true` 表示该类型节点可参与多选堆叠 / 连线收纳 |
| `mediaKinds` | `string[]?` | 媒体种类声明（如 `['image']`、`['video']`）。容器据此选择预览器与下游 pin |
| `capabilities` | `string[]?` | 开放字符串集合的能力标签。约定使用领域前缀（如 `media.replace`、`stack.merge-stacks`），避免用节点类型名硬编码业务行为 |

### 1.1 内置节点能力清单（`plugins/nodes/src/index.tsx`）

| type | capabilities | 说明 |
| --- | --- | --- |
| `text` | `{ stackable: true, capabilities: ['text'] }` | 可堆叠文本 |
| `generator` | `{ stackable: false, capabilities: ['generation'] }` | 生成器不可堆叠 |
| `image` | `{ stackable: true, mediaKinds: ['image'], capabilities: ['media', 'replace', 'crop', 'split'] }` | 媒体可堆叠 |
| `video` | `{ stackable: true, mediaKinds: ['video'], capabilities: ['media', 'replace'] }` | 媒体可堆叠 |
| `audio` | `{ stackable: true, mediaKinds: ['audio'], capabilities: ['media', 'replace', 'playback'] }` | 气泡特化外观 |
| `ai-placeholder` | `{ stackable: false, capabilities: ['placeholder'] }` | 仅 AI 任务占位 |
| `stacked-media` | `{ stackable: true, mediaKinds: ['image', 'video', 'audio', 'text'], capabilities: ['stack', 'merge-stacks', 'media-edit'] }` | StackNode 自身可再被堆叠（展平并入） |

### 1.2 能力过滤与「纵深防御」

`createStackedMediaExtension` 的 `canConnect` 钩子（`plugins/nodes/src/index.tsx`）说明能力如何被消费：作为 input 端时仅接受已声明可堆叠的基础节点（`image` / `video` / `audio` / `text` / `stacked-media`），其余类型返回 `{ valid: false, reason: i18next.t('nodes.stackOnlyAcceptsMedia') }`。这是既有类型兼容矩阵之外的兜底校验，而不是唯一的准入规则。

---

## 2. 多选堆叠：stackSelectedNodes

`stackSelectedNodes` 把多个源节点原子收纳进一个新 StackNode，返回单一 `BatchCommand`（可整体撤销）与跳过摘要。位于 `packages/plugins/nodes/src/nodes/stacked-media-model.ts`，纯数据层无 React 依赖。

```ts
export interface StackSelectedResult {
  command: BatchCommand;
  stackNodeId: string;
  cards: StackCard[];
  collectedCount: number;
  skippedCount: number;
  skippedIds: string[];
}

export function stackSelectedNodes(
  position: { x: number; y: number },
  sourceNodes: NodeRecord[],
  graph: { edges: EdgeRecord[] },
  isStackable: (node: NodeRecord) => boolean,
): StackSelectedResult | null
```

### 2.1 行为语义

- **能力过滤**：仅收纳 `isStackable(node)` 判定通过的节点；`stackable.length === 0` 时返回 `null`（调用方应直接放弃）。
- **新 StackNode 实例**：`type: 'stacked-media'`、`size: { width: 620, height: 348 }`、`title: '堆叠媒体'`、`data: { cards: [], activeIndex: 0 }`。
- **源 Stack 展平**：`sourceType === 'stacked-media'` 的源节点，其 `data.cards` 逐张并入新卡片列表，且每张卡片重新生成 `id`（`genId('card')`）。
- **常规源节点**：构造 `StackCard`（拷贝 `data` / `title` / `size`），并**显式删除全部关联边**（`RemoveNodeCommand` 不清理边，悬挂边会残留数据）。
- **原子性**：全部命令打包进 `new BatchCommand(commands, 'stacked-media-stack-selected')`，任一步骤不落盘即整体不生效。

### 2.2 跳过摘要

`collectedCount` / `skippedCount` / `skippedIds` 三字段供调用方做 UI 提示（如「已收纳 5 张，跳过 2 个不支持的类型」），数据变换层不做提示本身。

### 2.3 下游边转移规则（SOURCE_OUTPUT_PIN）

各源类型的 output pin id 映射表，用于把源节点的下游边转移到新 StackNode：

```ts
/** 各源类型的 output pin id(用于把源节点的下游边转移到新 StackNode) */
const SOURCE_OUTPUT_PIN: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'output',
  'stacked-media': 'media',
};
```

转移规则（`stackSelectedNodes` 内）：

1. **源 Stack（stacked-media）**：
   - `e.source.nodeId === src.id` → `RemoveEdgeCommand(e.id)`；若 `e.target.nodeId` 未被收纳，则追加 `AddEdgeCommand({ ...e, id: genId('merged-edge'), source: { nodeId: stackNodeId, pinId: 'media' } })`。
   - `e.target.nodeId === src.id`（上游边）→ 仅 `RemoveEdgeCommand(e.id)`。
2. **常规源节点**：对每条触及源节点的边先 `RemoveEdgeCommand`；当 `e.source.nodeId === src.id` 且下游节点未被收纳（`!removedIds.has(e.target.nodeId)`）时，追加转移边：`AddEdgeCommand({ ...e, id: genId('stacked-edge'), source: { nodeId: stackNodeId, pinId: SOURCE_OUTPUT_PIN[src.type] ?? 'media' } })`。

即：**被一同收纳的下游边删除即可（关系随收纳进入卡片），未被收纳的下游必须转移到新 StackNode，避免静默丢失图语义**。

---

## 3. StackNode 收纳 / 移出 / 合并命令

所有函数均为纯函数：输入 `node` / `data` / 图状态，输出 `{ command: BatchCommand, ... }`，撤销由 commandQueue 的 undo 栈负责（`undoCollect` 除外，见 3.2）。命令名（BatchCommand 的 `name` 参数）即撤销栈中的操作标识。

### 3.1 收纳：collectCard

```ts
export interface CollectResult {
  command: BatchCommand;
  cards: StackCard[];
  cardId: string;
}

export function collectCard(
  nodeId: string,
  data: StackedMediaData,
  sourceNode: NodeRecord,
  edge: EdgeRecord,
): CollectResult
```

正向命令序列：`RemoveEdgeCommand(edge.id)` → `UpdateNodeDataCommand(nodeId, { cards, activeIndex: cards.length - 1 })` → `RemoveNodeCommand(sourceNode.id)`，打包名 `'stacked-media-collect'`。卡片取 `sourceNode.data` 拷贝，`cardId` 供视图快照撤销使用。

### 3.2 撤销收纳：undoCollect

```ts
export interface UndoCollectResult {
  command: BatchCommand;
  activeIndex: number;
}

export function undoCollect(
  nodeId: string,
  sourceNode: NodeRecord,
  edge: EdgeRecord,
  prevCards: StackCard[],
  prevActiveIndex: number,
): UndoCollectResult
```

注意：这是**快照反向命令**（恢复源节点 + 连线 + 卡片列表），**不依赖 undo 栈**，避免 5 秒撤销窗口内其他操作污染撤销历史。打包名 `'stacked-media-undo-collect'`。

### 3.3 移出：ejectCard

```ts
export interface EjectResult {
  command: BatchCommand;
  cards: StackCard[];
  activeIndex: number;
}

export function ejectCard(
  commandQueue: { getState: () => { nodes: NodeRecord[]; edges: EdgeRecord[] } },
  node: NodeRecord,
  data: StackedMediaData,
  cardIndex: number,
): EjectResult | null
```

- `card` 不存在返回 `null`。
- 新节点：`id: genId('stacked-ejected')`、`type: card.sourceType`、`title: card.title ?? ''`、`data: { ...card.data }`。
- **位置布局**（兄弟垂直队列 + 前置偏移）：
  - `SIBLING_GAP = 40`（兄弟垂直队列间距）
  - `EJECT_OFFSET_X = 40`（移出节点放置在 StackNode 前方的间距）
  - `x = node.position.x - (card.size?.width ?? 620) - EJECT_OFFSET_X`
  - `y = Math.max(node.position.y, siblingBottom + SIBLING_GAP)`（`siblingBottom` 为全部入边源节点底部的最大值，无则取 `node.position.y`）
- 命令：`UpdateNodeDataCommand`（删卡 + 钳制 `activeIndex`）+ `AddNodeCommand`，打包名 `'stacked-media-eject'`。

### 3.4 合并：mergeStacks

```ts
export interface MergeStacksResult {
  command: BatchCommand;
  cards: StackCard[];
  activeIndex: number;
}

export function mergeStacks(
  targetNode: NodeRecord,
  targetData: StackedMediaData,
  sourceNode: NodeRecord,
  incomingEdge: EdgeRecord,
  graph: { edges: EdgeRecord[] },
): MergeStacksResult
```

- **源堆叠进入目标堆叠**，目标节点保留最终领域状态：`cards = [...targetData.cards, ...sourceCards]`。
- 命令：`RemoveEdgeCommand(incomingEdge.id)` + `UpdateNodeDataCommand(targetNode.id, { cards, activeIndex })`。
- **下游边转移**：源 Stack 除 `incomingEdge` 外的全部出边，删除后重连到目标 Stack：`AddEdgeCommand({ ...edge, id: genId('merged-edge'), source: { ...edge.source, nodeId: targetNode.id } })`（保留原 pinId，StackNode 的 output pin 为 `media`）。最后 `RemoveNodeCommand(sourceNode.id)`。打包名 `'stacked-media-merge'`。

### 3.5 追加 / 替换

```ts
export interface AppendResult {
  command: BatchCommand;
  cards: StackCard[];
  activeIndex: number;
}

/** 追加多张卡片(空态上传入口),并跳到本次上传的第一张 */
export function appendCards(
  nodeId: string,
  cards: StackCard[],
  newCards: StackCard[],
): AppendResult
// activeIndex = next.length - newCards.length; 打包名 'stacked-media-append'

export interface ReplaceResult {
  command: BatchCommand;
  cards: StackCard[];
}

/** 替换指定索引的卡片内容 */
export function replaceCardContent(
  nodeId: string,
  cards: StackCard[],
  cardIndex: number,
  newCard: StackCard,
): ReplaceResult
// 打包名 'stacked-media-replace'
```

### 3.6 卡片切换与派生尺寸

```ts
export interface SwitchResult {
  patch: { cards: StackCard[]; activeIndex: number };
  activeIndex: number;
}

/** 切换活跃卡片,并在同一事务中同步派生尺寸。 */
export function activateStackCard(
  node: NodeRecord,
  data: StackedMediaData,
  index: number,
): SwitchResult & { command: BatchCommand }

/** 无 node 上下文时仅生成数据 patch,供纯数据工具使用。 */
export function switchActive(data: StackedMediaData, index: number): SwitchResult

/** 按当前素材比例推导 StackNode 高度(派生布局,而非把 500x500 设计基准固化为相册容器)。 */
export function getStackDisplayHeight(card: StackCard | undefined, width: number): number | null
// 高度 = Math.max(220, Math.round(width * (naturalHeight / naturalWidth) + STACK_NAVIGATION_HEIGHT))
// STACK_NAVIGATION_HEIGHT = 56(导航栏是 StackNode 内容的一部分,尺寸计算必须显式纳入)
```

`activateStackCard` 在同一事务内：`UpdateNodeDataCommand` 切换 `activeIndex`；当 `getStackDisplayHeight` 返回的目标高度与当前高度差 `> 2px` 时追加 `ResizeNodeCommand`（位置不变，仅高度），打包名 `'stacked-media-activate-card'`。

---

## 4. targetNode 工具代理

### 4.1 契约签名

```ts
// packages/core/src/extensions/types.ts
export interface ToolDefinition {
  id: string;
  label: string | ((node: NodeRecord, ctx: ToolContext) => string);
  title: string | ((node: NodeRecord, ctx: ToolContext) => string);
  icon: unknown | ((node: NodeRecord, ctx: ToolContext) => unknown);
  active?: (node: NodeRecord, ctx: ToolContext) => boolean;
  visible?: (node: NodeRecord, ctx: ToolContext) => boolean;
  danger?: boolean;
  primary?: boolean;
  group?: string;
  run: (node: NodeRecord, ctx: ToolContext) => void;
  /**
   * 工具显示在宿主节点上,但作用于另一个领域目标时使用。
   * 典型场景:StackNode 显示当前媒体项的 crop/replace 工具。
   */
  targetNode?: (hostNode: NodeRecord, ctx: ToolContext) => NodeRecord;
  menu?: (node: NodeRecord, ctx: ToolContext) => ToolMenuItem[];
}
```

`targetNode` 把「宿主节点上显示的 UI」与「实际作用的领域目标」解耦。工具的所有动态字段（`visible` / `active` / `title` / `icon` / `menu` / `run`）都应作用于**解析后的目标节点**，而非宿主节点。

### 4.2 StackNode 复用源类型工具的机制（`plugins/nodes/src/index.tsx`）

`createStackedMediaExtension` 的 `getTools(node, ctx)`：

```ts
getTools: (node: NodeRecord, ctx: ToolContext): ToolDefinition[] => {
  const data = parseStackedMediaData(node.data as Record<string, unknown> | undefined);
  const activeCard = data.cards[data.activeIndex];
  const tools: ToolDefinition[] = [];

  // 根据活跃卡片类型注入原始工具(排除"堆叠"自身)
  if (activeCard) {
    const sourceTools = activeCard.sourceType === 'video'
      ? getVideoTools()
      : activeCard.sourceType === 'audio'
        ? getAudioTools()
        : activeCard.sourceType === 'text'
          ? getTextTools()
          : activeCard.sourceType === 'image'
            ? getImageTools()
            : [];
    const activeTarget: NodeRecord = {
      id: activeCard.sourceNodeId ?? activeCard.id,
      type: activeCard.sourceType,
      title: activeCard.title ?? '',
      position: node.position,
      size: activeCard.size ?? node.size,
      data: activeCard.data,
    };
    for (const t of sourceTools) {
      if (t.id === 'createStackNode') continue; // 排除"堆叠"自身
      tools.push({ ...t, targetNode: () => activeTarget });
    }
  }
  // ... 追加 eject 工具
}
```

要点：

- 按活跃卡片的 `sourceType` 分发到 `getVideoTools()` / `getAudioTools()` / `getTextTools()` / `getImageTools()`，**工具定义零重复**。
- 构造一个内存态 `activeTarget`（`id` 优先取 `sourceNodeId` 回退到 `card.id`，`data` 取卡片数据），把源工具整体浅拷贝并覆写 `targetNode: () => activeTarget`。
- 排除 `id === 'createStackNode'` 的工具，避免在 StackNode 上出现「再堆叠」入口。
- 额外注入 `eject` 工具：`label: ''`（纯图标）、`title: '移出为独立节点'`、`icon: 'x-circle'`、`danger: true`、`visible: () => data.cards.length > 0`，`run` 内调用 `ejectCard(ctx.commandQueue, node, data, data.activeIndex)` 后 `ctx.commandQueue.execute(result.command)`。

### 4.3 消费端

- **`node-hover-toolbar.tsx`（render-react 通用聚合组件）**：通过 `ext.getTools(node, toolContext)` 取工具，先按 `visibleToolIds`（`ReadonlySet<string>`，配合 `imageToolbarConfig.ids` 实现「勾选工具」）过滤，再按 `tool.visible(node, toolContext)` 过滤；`label` / `title` / `icon` 用 `resolveText` / `resolveIcon` 解析，`active` 决定高亮，按钮点击执行 `tool.run(node, toolContext)`。样式跟随主题：背景 `theme.toolbar.panel`，accent 用 `ext.color`（组节点用 `theme.group.outlineSelectedColor`），危险操作用 `theme.toolbar.danger`。
- **`node-capsule-toolbar.tsx`（app 侧磁贴工具栏）**：显式解析目标节点后校验可见性与执行：

```ts
const resolveToolNode = (tool: ToolDefinition): NodeRecord => tool.targetNode?.(node!, toolContext) ?? node!;
const visibleTools = tools.filter((tool) => {
  const targetNode = resolveToolNode(tool);
  return !tool.visible || tool.visible(targetNode, toolContext);
});
```

> 约定：任何新写的工具栏消费端都应遵循「先 `targetNode` 解析、再取 `visible`/`active`/`run`」的顺序，否则 StackNode 代理工具会作用于错误的节点。

---

## 5. 图片编辑工具复用（`packages/plugins/image-editor/src/tools.tsx`）

图片快捷工具栏是可复用的泛型工具表，共 **11 个可定制工具**，用泛型 `<T>` 解耦节点数据类型（调用方注入具体 node 形状），零 `lucide-react` 依赖（自研内联 SVG 图标）。

### 5.1 类型与工具定义

```ts
export interface ToolQueries<T> {
  isFreeResize?: (node: T) => boolean;   // 是否自由比例(resize 工具用,默认 false)
}

export interface ToolHandlers<T> {
  onCopyPrompt: (node: T) => void;
  onReversePrompt: (node: T) => void;
  onUpload: (node: T) => void;
  onToggleFreeResize: (node: T) => void;
  onMaskEdit: (node: T) => void;
  onCrop: (node: T) => void;
  onSplit: (node: T) => void;
  onUpscale: (node: T) => void;
  onSuperResolve: (node: T) => void;
  onAngle: (node: T) => void;
  onViewImage: (node: T) => void;
}

export interface ToolDefinition<T> {
  id: ImageActionToolId;
  defaultVisible: boolean;
  panelLabel: string;
  label: string | ((node: T, queries?: ToolQueries<T>) => string);
  title: string | ((node: T, queries?: ToolQueries<T>) => string);
  icon: (node: T, queries?: ToolQueries<T>) => ReactNode;
  active?: (node: T, queries?: ToolQueries<T>) => boolean;
  run: (node: T, handlers: ToolHandlers<T>) => void;
}

/** 全部可定制工具定义(顺序即工具栏默认顺序) */
export const imageToolDefinitions: ToolDefinition<unknown>[] = [ /* 11 项 */ ];
```

11 个工具 id：`copyPrompt` / `reversePrompt` / `replace` / `resize` / `maskEdit` / `crop` / `split` / `upscale` / `superResolve` / `angle` / `view`（顺序即默认顺序）。`resize` 是唯一使用 `queries` 的动态工具（label/title/icon/active 均按 `isFreeResize` 切换锁/开锁图标）。

### 5.2 基础工具与默认集合（`types.ts`）

```ts
/** 基础工具 id(工具栏固定,不参与自定义) */
export type ImageBaseToolId = 'info' | 'delete' | 'saveAsset' | 'download' | 'edit';
/** 可定制工具 id(参与工具栏自定义) */
export type ImageActionToolId =
  | 'copyPrompt' | 'reversePrompt' | 'replace' | 'resize' | 'maskEdit'
  | 'crop' | 'split' | 'upscale' | 'superResolve' | 'angle' | 'view';
/** 全部工具 id */
export type ImageQuickToolId = ImageBaseToolId | ImageActionToolId;

/** 默认可见的可定制工具(defaultVisible: true) */
export const DEFAULT_VISIBLE_ACTION_IDS: ImageActionToolId[] = [
  'copyPrompt', 'reversePrompt', 'replace', 'maskEdit', 'crop', 'split', 'upscale', 'view',
];
/** 默认基础工具(固定显示) */
export const BASE_TOOL_IDS: ImageBaseToolId[] = ['info', 'delete', 'saveAsset', 'download', 'edit'];

export const DEFAULT_TOOL_IDS: ImageQuickToolId[] = [...BASE_TOOL_IDS, ...DEFAULT_VISIBLE_ACTION_IDS];
```

### 5.3 构建工具栏实例：buildImageToolbarTools

```ts
/** 工具栏实例(扁平化后的工具,供 UI 渲染) */
export interface ToolInstance {
  id: ImageQuickToolId;
  label: string;
  title: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}

export function buildImageToolbarTools<T>(
  node: T,
  handlers: ToolHandlers<T>,
  queries?: ToolQueries<T>,
  visibleIds?: ImageActionToolId[],
): ToolInstance[]
```

- 工具定义为固化表（`imageToolDefinitions` 声明为 `ToolDefinition<unknown>`），此处断言为 `ToolDefinition<T>` 以适配调用方节点类型。
- `visibleIds` 可选：仅返回这些 id 的工具（用于工具栏自定义），默认返回全部可定制工具。
- 返回扁平化的 `ToolInstance[]`：`label`/`title` 经 `resolveToolText` 解析、`icon` 即时求值、`onClick` 闭包调用 `tool.run(node, handlers)`。

### 5.4 持久化配置读写

```ts
export function normalizeImageQuickToolIds(value: unknown[]): ImageQuickToolId[]
export function readImageQuickToolsConfig(value: unknown): ImageQuickToolsConfig
export function loadImageQuickToolsConfig(): ImageQuickToolsConfig
export function saveImageQuickToolsConfig(config: ImageQuickToolsConfig): void
// TOOLS_STORAGE_KEY = 'zeroexo-image-quick-tools-v1'
// ImageQuickToolsConfig = { ids, showLabels, autoWrap, maxLines }
```

`readImageQuickToolsConfig` 兼容旧格式（纯 id 数组 → 自动补 `showLabels: true` / `autoWrap: false` / `maxLines: 2`）；`maxLines` 被钳制到 `1–5`。宿主读取配置后，把 `ids` 传入 `buildImageToolbarTools` 的 `visibleIds` 或 `NodeHoverToolbar` 的 `visibleToolIds`，即可实现「勾选工具」功能。

---

## 6. 下游边转移规则速查

| 场景 | 函数 | 规则 |
| --- | --- | --- |
| 多选堆叠（源为普通节点） | `stackSelectedNodes` | 触边全删；源出边且下游未被收纳 → 转移 `SOURCE_OUTPUT_PIN[src.type] ?? 'media'`，边 id `stacked-edge` |
| 多选堆叠（源为 Stack） | `stackSelectedNodes` | 出边删除；下游未被收纳 → 转移 pin `media`，边 id `merged-edge`；入边仅删除 |
| 合并 Stack → Stack | `mergeStacks` | 除 `incomingEdge` 外源 Stack 全部出边删除并重连到目标 Stack（保留 pinId），边 id `merged-edge` |
| 单节点收纳 | `collectCard` | 仅删传入的 `edge`，其余边不动 |
| 移出 | `ejectCard` | 不涉及连线（卡片数据即节点数据，独立成节点） |

原则：**收纳动作永远显式删除关联边**（`RemoveNodeCommand` 不清理边，悬挂边会残留数据）；**下游图关系尽可能转移到新的容器节点，避免静默丢失语义**。

---

## 7. 复用最佳实践

1. **能力优先于类型判断**：容器逻辑应读 `NodeCapabilities`（`stackable` / `mediaKinds` / `capabilities`）而非硬编码 type 列表；`isStackable` 等过滤回调由调用方注入，保持模型层可测试。
2. **工具复用走注册表 + 代理**：`getTools` 返回固化工具表，StackNode 用 `{ ...t, targetNode: () => activeTarget }` 代理到源类型工具；禁止在容器里复制粘贴工具实现。
3. **一切图变更走 BatchCommand**：收纳/堆叠/合并/移出全部返回原子 `BatchCommand`，命令名即撤销标识；`undoCollect` 这类「快照反命令」明确不依赖 undo 栈。
4. **纯数据层无 React**：`stacked-media-model.ts` 与 `image-editor/tools.tsx` 均为纯函数/纯数据模块，UI 提示（跳过摘要、toast）由调用方负责。
5. **泛型工具表以 `unknown` 声明、调用方断言**：`imageToolDefinitions: ToolDefinition<unknown>[]`，消费时断言为 `ToolDefinition<T>`，避免工具包反向依赖节点类型。
