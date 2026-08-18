# Example 5：Agent 批量操作示例

演示 Agent 能力如何安全、可观测、可撤销地批量改画布：先 dry-run 校验，再以同一 `operationId` 正式执行。签名与 `canvas-op-executor.ts` / `node-runtime-contract.ts` 精确一致。

```ts
import { CanvasOpExecutor } from '@/pages/editor/editor-canvas/interactions/canvas-op-executor';
import type { CanvasOp, CanvasOperationContext, CanvasOperationObserver } from '@zeroexo/core';

// step 1 构造执行器（挂观察者用于指标/进度）
const observer: CanvasOperationObserver = {
  onPlan(m) {
    console.log('[agent] plan', m.operationId, m.opCount, m.status);
  },
  onComplete(m) {
    console.log('[agent] complete', m.operationId, m.durationMs, m.status);
  },
};
const executor = new CanvasOpExecutor(commandQueue, {
  schema, // 画布 Schema，做兜底连接校验
  observer,
  defaultContext: { actor: 'agent', source: 'agent.storyboard' },
});

// step 2 规划一组 ops：新增分镜 → 连线 → 生成器输出连到分镜
const ops: CanvasOp[] = [
  { op: 'add_node', args: { id: 'gen-1', type: 'generator', position: { x: 0, y: 0 }, title: '生成器' } },
  {
    op: 'batch',
    args: {
      label: 'storyboard-plan',
      ops: [
        { op: 'add_node', args: { id: 'sb-1', type: 'storyboard', position: { x: 400, y: 0 }, title: '分镜' } },
        { op: 'add_edge', args: { source: { nodeId: 'gen-1', pinId: 'output' }, target: { nodeId: 'sb-1', pinId: 'input' } } },
        { op: 'update_node', args: { id: 'sb-1', patch: { title: '分镜 v1' } } },
      ],
    },
  },
];

// step 3 dry-run：只产出计划，不执行任何命令；合法后同 operationId 正式执行
const token = `${crypto.randomUUID()}`;
const context: Partial<CanvasOperationContext> = {
  operationId: token,
  traceId: `storyboard-${token}`,
  actor: 'agent',
  dryRun: true,
};

const planned = await executor.executeOps(ops, context);
if (planned.status === 'rejected') {
  // 任一 op 校验失败整次 rejected，不会部分执行
  return { ok: false, reason: planned.error };
}

const executed = await executor.executeOps(ops, { ...context, dryRun: false });
return { ok: executed.status !== 'rejected', metrics: executed };
```

要点：

- **actor 必填 `'agent'`**：缺省是 `'user'`，程序化调用方必须显式传，否则协作端与指标把 Agent 操作当人工操作。
- **`operationId`/`traceId` 共享**：一次 Agent 任务的多次 `executeOps` 共用一个 `operationId`（重试去重）、一个 `traceId`（链路追踪）。
- **禁止逐条同步**：多 op 自动打包为一条 `BatchCommand('canvas-op-batch')`，历史中只占一条记录、一次 undo 全部撤销；嵌套 `batch` 递归展开。
- **幂等**：`idempotencyKey` 仅供透传，网络层按键去重，执行器不内置防重放。
- 图中的 `schema.validateConnection` 兜底连接规则；节点自治 `canConnect` 仍优先生效。