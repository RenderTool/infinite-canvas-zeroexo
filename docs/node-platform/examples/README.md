# Node Platform Examples

面向节点作者的可运行示例集，与 `node-authoring-guide.md` / `node-capability-guide.md` / `node-agent-integration.md` 配套。代码签名与真实源码一致，可整体复制改造成业务节点。

| 文件 | 内容 |
| --- | --- |
| `basic-nodes.md` | 最小文本节点 + 媒体节点（Pin、dataType、createDefaultData、尺寸约束、工具栏） |
| `stack-and-custom-ui.md` | StackNode 卡片接入 + 完全自定义 UI 节点（`useShellChrome: false`、全自绘外壳） |
| `agent-batch-operations.md` | Agent 批量操作示例（CanvasOperationContext → executeOps → BatchCommand） |

约定：

- 所有签名以当前源码为准：`packages/core/src/extensions/types.ts`、`packages/core/src/node-view-contract.ts`、`packages/core/src/node-runtime-contract.ts`、`packages/core/src/canvas-schema.ts`。
- 节点注册一律通过 `ed.plugins.nodes.registerAll(createXxxExtensions(...))`（`PluginNodesPlugin` 统一入口）。
- View 不直接编排跨节点数据变更；跨节点/领域变更走 `CommandQueue`/`CanvasOpExecutor`。