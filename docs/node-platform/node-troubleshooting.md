# Node 故障排查指南（Node Troubleshooting）

本文档按「注册 / Pin / 工具 / 资源 / 协作 / 性能 / 命令」七类整理最常见问题与排查路径。所有错误文案与源码一致，可从报错快速定位到根因。

相关源码：

- 注册中心：`packages/plugins/node-registry/src/index.ts`
- 注册入口：`packages/plugins/nodes/src/index.tsx`、`src/features/canvas-nodes/extensions.tsx`、`src/pages/editor/editor-canvas/use-editor-state.ts`
- 渲染：`packages/plugins/render-react/src/components/node-shell.tsx`、`node-layer.tsx`、`node-hover-toolbar.tsx`
- 连线：`packages/plugins/connection/src/connection-controller.ts`（`canConnect` 双端钩子）
- 执行器：`src/pages/editor/editor-canvas/interactions/canvas-op-executor.ts`

---

## 1. 注册失败

### 1.1 重复注册

报错：

```
Node type "storyboard" already registered by "app"
```

根因：`register`/`registerAll` 对重复 `type` 直接抛错（`node-registry` 的 `register` 内 `throw new Error(...)`）。`registeredBy` 是注册来源（插件 id 或 `'app'`），措辞里的 `app`/插件名会告诉你谁先注册。

排查：

1. 全局搜 `type: '<名>'` 确认有几个注册点（内置 `packages/plugins/nodes/src/index.tsx` + app 层工厂 `src/features/canvas-nodes/extensions.tsx`）。
2. `ed.plugins.nodes.types()` 在 dev 里打印已注册列表（或直接把 `registeredBy` 打出来）。
3. 若工厂被 `registerAll` 重复调用（如 React StrictMode 双执行、热更新重复 import），在工厂外套一层幂等保护即可。

### 1.2 未 install 就注册

报错：

```
PluginNodesPlugin not installed: call editor.install(plugin) first
```

或（依赖顺序错）：

```
PluginNodesPlugin requires NodeRegistryPlugin to be installed first
```

根因：`getRegistry()` 在 `PluginNodesPlugin.install()` 之前调用；或 plugins 未按 `['node-registry', 'connection']` 依赖顺序安装。

排查：注册调用必须放在 `editor.install(...)`、`ed.plugins.nodes` 就绪之后（见 `use-editor-state.ts` 的 `createDefaultEditor(...)` → install → `registerAll` 顺序）。

### 1.3 注册了但不在节点菜单

- category 以 `_hidden` 开头 → 不进普通菜单（内置 `ai-placeholder` 即如此）。
- `displayName` 无匹配 → 菜单搜索评分：完全匹配 100 / 前缀 80 / 包含 60，全 0 不显示；`categories()`/`categoryTree()` 核对分类名与层级。
- 工厂未进 `registerAll` 的数组 → 只出现了一半扩展。

## 2. Pin 不通（连不上 / 连线被拒）

调用链：默认规则（自连、方向、重复）→ 源/目标 `canConnect` 双端钩子（任一拒绝即拒绝）→ `CanvasSchema.validateConnection` 兜底。

排查顺序：

1. **方向**：连接始终以 `output → input` 语义调用，`source` 必须为 output、`target` 为 input；输出连输出/输入连输入会被默认规则拦截。
2. **dataType**：`canConnect` 里比对 `pin.dataType`（如 image 的 out 只接受 `'image'` 类型 in）。用 `getPins(node)` 打印实际 dataType，别拿 displayName 判断。
3. **pinId 不一致**：`EdgeRecord.source.pinId` 必须与 `getPins` 返回的 `pin.id` 完全一致——StackNode 按卡片切换动态换 pin，旧连线引用的 pinId 可能已不存在。
4. **自节点钩子**：`canConnect` 返回 `{ valid: false, reason }` 会直接展示 reason；返回 `void` 表示中立（继续后续校验）。排查时把双端钩子都打上日志。
5. **重连既有边**：换 pin 后旧边残留，先清旧边再测新连线。

## 3. 工具不显示 / 点了没反应

工具由 `node-hover-toolbar.tsx` 消费 `ext.getTools(node, ctx)`：

1. **悬浮工具栏触发条件**：工具栏通常 hover/选中才显示；`visible` 返回 `false` 会隐藏（如 image 无内容时隐藏裁剪）。逐项检查 `visible` 布尔。
2. **`targetNode` 代理**：StackNode 的工具作用于当前卡片——`visible/title/icon/menu/run` 必须全部基于 `targetNode(hostNode, ctx)` 解析后的目标节点，否则看到宿主工具却操作错对象。
3. **`active` 高亮**：调用了但没高亮，多半是 `active` 判定与状态字段对不上。
4. **`run` 无效果**：工具只提交命令的话看命令是否真的进 `CommandQueue`；如果依赖 `ctx.openImageDialog`/`openEditor` 而宿主页面未注入，`run` 会静默失败（可选注入缺失）。
5. **菜单渲染异常**：返回了 `menu` 会渲染成下拉而不是普通按钮——不是 bug，但 UI 会判定为「不一样」；确认 `label` 非空、`icon` 类型为渲染层可解释形式（string 视为 icon name，其他为 ReactNode）。

## 4. 资源丢失（图片挂了 / 内容没了）

1. **blob/临时 URL**：`data.content` 存 `blob:` 或内存 URL 会在刷新后失效。持久化层不负责还原 blob；需要把资源转持久 URL（上传队列 `plugin-upload-queue`）后再存引用。
2. **老数据缺字段**：`createDefaultData()` 必须返回视图预期的完整结构，空 `data` 要用工厂补齐，禁止渲染层在 `undefined` 上直接取字段（框架只保证 `data?: unknown`）。
3. **卡片数据与源节点解耦**：Stack 收纳后卡片持 `sourceNodeId` + 拷贝内容快照；源节点被移除。若图片「消失」先确认是不是源被安全删除、卡片快照字段丢了。
4. **边转移遗漏**：删除/堆叠时若出现悬挂边（边指向已不存在节点），检查是否走了统一命令（`stackSelectedNodes`/`ejectCard`/`mergeStacks` 都做边转移）；手写删除命令只删节点不删边时会留悬挂边。

## 5. 协作冲突

1. **幂等**：`idempotencyKey` 只透传不去重（`canvas-op-executor`）。「重试后出现两次执行」不是 bug，是网络层需要自己去重。
2. **actor 语义**：Agent/导入器必须显式传 `actor: 'agent'`，缺省会落成 `'user'`（`executeOps` 的 actor 缺省值为 `'user'`），导致协作端按用户操作处理。
3. **撤销乱序**：跨端 undo 用 `operationId`/`traceId` 核对链路；命令必须整组走 `BatchCommand` 保证原子性与顺序，禁止逐条独立推同步。
4. **并发同点操作**：一端新建一端删除同一节点 id（`genId` 撞名），确认 id 生成唯一，冲突时以 CRDT/Yjs 合并结果为准并复查悬挂边。

## 6. 性能瓶颈

定位顺序（配合 Dev Performance Panel，`import.meta.env.DEV` 下左上角）：

1. **边渲染**：`--mode complete` 全连接是极端边密度场景；浪费在边上就进边索引/降级路径。
2. **全量重渲**：帧耗时高但「阻塞任务」分类高——检查是否整图重渲而不是按变更节点调度。
3. **媒体缩略图**：Media 节点慢先查是否每帧解码原图；应走缩略图缓存与 LOD（低缩放降级）。
4. **同步批次**：每操作一批次同步，禁止按节点循环即时同步（`node-performance-guide.md` 的增量 Graph 更新）。
5. **无前端限流**：平台禁止「按节点数触发的前端限流」，任何阈值都必须是可配置资源保护（警告/降级/拒绝三档）。

## 7. 命令与撤销异常

- **undo 不还原**：命令必须满足 `undo(execute(graph)) === 原图`；纯数据命令在 `stacked-media-model.test.ts` 有对称性断言，新命令照此补测。顺序无关时按 id 排序后深比较。
- **半途失败**：多步变更必须 `BatchCommand`；中间子命令失败要能整体回滚，不许留下半提交状态。
- **命令不进历史**：`renderNode` 内部调用 `updateNode` 只适合本节点轻量属性（重命名）；跨节点/领域变更必须 `commandQueue.execute(cmd)` 提交，否则无撤销记录且在协作端不可见。

## 8. 最小排障清单

| 症状 | 第一检查项 |
| --- | --- |
| 注册抛「already registered」 | `registeredBy` 是谁；重复 registerAll |
| registerAll 抛「not installed」 | install 顺序 |
| 菜单找不到节点 | `_hidden` 分类 / 搜索评分 0 |
| 连不上 | output→input、dataType、pinId 一致 |
| 工具不显示 | `visible` / hover 触发 / `targetNode` |
| 图片刷新后消失 | blob URL 未转持久 |
| 撤销不还原 | 命令对称性、BatchCommand |
| 帧率低 | 边索引 / 全量重渲 / 缩略图 |
| 协作重复执行 | 幂等键只透传，网络层去重 |