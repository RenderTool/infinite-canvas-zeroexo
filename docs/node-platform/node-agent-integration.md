# Agent 与程序化操作画布的基础设施接入指南

本文档面向 Agent 能力、AI 生成、导入器等程序化调用方，说明如何安全、可观测、可撤销地操作画布。

所有签名均与源码严格一致，涉及文件（相对 `zeroexo_front/`）：

| 模块 | 路径 |
| --- | --- |
| 操作上下文 / 指标 / 观测器 | `packages/core/src/node-runtime-contract.ts` |
| Schema 校验 / 连接决策 | `packages/core/src/canvas-schema.ts` |
| 画布操作执行器 | `src/pages/editor/editor-canvas/interactions/canvas-op-executor.ts` |
| 命令队列 / 内置命令 | `packages/core/src/command/command-queue.ts`、`packages/core/src/command/builtins.ts` |

核心原则：**Agent 的每次画布改动，都应包装成一次 `CanvasOpExecutor.executeOps` 调用**，由执行器统一完成 Schema 校验、批量事务打包、`onPlan/onComplete` 指标上报，并经由 `CommandQueue` 进入撤销/重做历史。

## 1. 操作上下文：CanvasOperationContext

`packages/core/src/node-runtime-contract.ts` 定义了一次画布操作的身份信息：

```ts
export type CanvasActor = 'user' | 'agent' | 'import' | 'stress';

export interface CanvasOperationContext {
  operationId: string;
  traceId: string;
  actor: CanvasActor;
  source?: string;
  projectId?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  parentOperationId?: string;
}
```

字段语义：

- `operationId`：一次操作的唯一 ID。Agent 每次决策产出的一组 ops 应共用一个 `operationId`。
- `traceId`：跨网络 / 命令 / 渲染链路的追踪 ID。一次 Agent 任务的多次 `executeOps` 可共享同一 `traceId`。
- `actor`：操作来源。`user` 为人工操作；`agent` 为 Agent / AI 能力；`import` 为导入器；`stress` 为压测脚本。**程序化调用方必须显式传 `agent`，禁止默认落为 `user`**（`executeOps` 的 actor 缺省值为 `'user'`）。
- `source`：具体能力标识（如 `agent.storyboard`、`ai.one-click-copy`），用于区分同一个 actor 下的不同子能力。
- `projectId`：所属项目。
- `dryRun`：只校验并产出计划，不执行任何命令（见 §4.3）。
- `idempotencyKey`：网络重试去重键。**注意：执行器仅透传、不实现去重**（见 §4.5）。
- `parentOperationId`：复合操作的父操作 ID。一次 Agent 任务拆成多次 `executeOps` 时，子操作用它关联父操作。

节点运行时也消费同一 actor 语义。`NodeRuntimeContext`（同文件）：

```ts
export interface NodeRuntimeContext {
  commandQueue: CommandQueue;
  graph: { nodes: NodeRecord[]; edges: EdgeRecord[] };
  actor: CanvasActor;
  operationId: string;
}
```

节点定义通过 `createCommands(node, context)` 生成命令时，应依据 `context.actor` 决定是否允许/降级该次操作。

## 2. 指标与观测：CanvasOperationMetrics / CanvasOperationObserver

```ts
export interface CanvasOperationMetrics {
  operationId: string;
  traceId: string;
  actor: CanvasActor;
  opCount: number;
  commandCount: number;
  nodeCountBefore?: number;
  nodeCountAfter?: number;
  edgeCountBefore?: number;
  edgeCountAfter?: number;
  durationMs: number;
  status: 'planned' | 'executed' | 'rejected' | 'failed';
  error?: string;
}

export interface CanvasOperationObserver {
  onPlan?(metrics: CanvasOperationMetrics): void;
  onComplete?(metrics: CanvasOperationMetrics): void;
}
```

上报规则（由执行器保证）：

- `opCount`：传入的 ops 条数；`commandCount`：实际生成的可执行命令数（嵌套 `batch` 展开后仍计为内层命令数）。
- `nodeCountBefore/After`、`edgeCountBefore/After`：执行前后画布统计。`dryRun` 下 `After === Before`。
- `status` 取值：
  - `planned`：dry-run 或执行成功前计划阶段（dry-run 的最终状态也是 `planned`）。
  - `executed`：真实执行成功。
  - `rejected`：校验失败 / 无可用命令，`error` 携带原因。
  - `failed`：保留给执行期异常（当前执行器版本不会主动产生）。
- `onPlan` 在计划产出后触发（空 ops 也触发）；`onComplete` 在结束阶段触发，覆盖成功（`executed`）、dry-run（`planned`）与 `rejected` 三种收尾。

## 3. Schema 校验：CanvasSchema / ConnectionDecision

`packages/core/src/canvas-schema.ts`：

```ts
export interface ConnectionContext {
  source: { nodeId: string; pinId: string };
  target: { nodeId: string; pinId: string };
  sourceNode?: NodeRecord;
  targetNode?: NodeRecord;
}

export interface ConnectionDecision {
  allowed: boolean;
  reason?: string;
  action?: 'connect' | 'collect-into-target' | 'merge-stacks' | 'reject';
}

export interface CanvasSchema {
  validateConnection(context: ConnectionContext): ConnectionDecision;
  normalizeBatch?(ops: readonly unknown[]): readonly unknown[];
  getNodeActions?(context: NodeActionContext): NodeAction[];
  validateNode?(node: NodeRecord): { valid: boolean; errors?: string[] };
  validateEdge?(edge: EdgeRecord): { valid: boolean; errors?: string[] };
}
```

`ConnectionDecision.action` 语义：

- `connect`：普通连线，允许。
- `collect-into-target`：把源收集进目标节点（领域动作，如素材收纳）。
- `merge-stacks`：堆叠节点合并（领域动作）。
- `reject`：禁止连接，通常伴随 `allowed: false` 与 `reason`。

`action` 是领域语义提示，**不应被普通连线 UI 静默解释为普通边**；执行器只读取 `allowed` 决定放行与否，领域动作的落地由宿主层处理。

执行器实际消费的校验点：

- `add_node` op → `schema.validateNode(...)`（结构校验失败则整次操作 `rejected`）。
- `add_edge` op → `schema.validateConnection({ source: { nodeId, pinId: source.pinId ?? 'output' }, target: { nodeId, pinId: target.pinId ?? 'input' } })`；`allowed === false` 时整次操作 `rejected`，`reason` 透传为 `error`。
- `normalizeBatch`、`getNodeActions`、`validateEdge` 为宿主层按需调用的可选钩子，执行器不主动调用。

未传 schema 时默认使用 `allowAllCanvasSchema`（`validateConnection: () => ({ allowed: true, action: 'connect' })`）。

## 4. CanvasOpExecutor

`src/pages/editor/editor-canvas/interactions/canvas-op-executor.ts`。

### 4.1 CanvasOp 联合类型（全部 op 结构）

```ts
export interface AddNodeOp {
  op: 'add_node';
  args: {
    id: string;
    type: string;
    position: { x: number; y: number };
    size?: { width: number; height: number };
    title?: string;
    data?: Record<string, unknown>;
  };
}

export interface UpdateNodeOp {
  op: 'update_node';
  args: {
    id: string;
    patch: Record<string, unknown>;
  };
}

export interface RemoveNodeOp {
  op: 'remove_node';
  args: {
    id: string;
  };
}

export interface AddEdgeOp {
  op: 'add_edge';
  args: {
    id?: string;
    source: { nodeId: string; pinId?: string };
    target: { nodeId: string; pinId?: string };
  };
}

export interface RemoveEdgeOp {
  op: 'remove_edge';
  args: {
    id: string;
  };
}

export interface DuplicateNodeOp {
  op: 'duplicate_node';
  args: {
    id: string;
  };
}

export interface ResizeNodeOp {
  op: 'resize_node';
  args: {
    id: string;
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
  };
}

export interface MoveNodeOp {
  op: 'move_node';
  args: {
    id: string;
    delta: { x: number; y: number };
  };
}

export interface BatchOp {
  op: 'batch';
  args: {
    ops: CanvasOp[];
    label?: string;
  };
}

export type CanvasOp =
  | AddNodeOp
  | UpdateNodeOp
  | RemoveNodeOp
  | AddEdgeOp
  | RemoveEdgeOp
  | DuplicateNodeOp
  | ResizeNodeOp
  | MoveNodeOp
  | BatchOp;
```

op → 命令映射与默认值（`toCommand`）：

- `add_node` → `AddNodeCommand`，`size` 缺省 `{ width: 200, height: 80 }`，`title` 缺省 `''`，`data` 缺省 `{}`。
- `update_node` → `UpdateNodeDataCommand`（`patch` 浅合并进 `node.data`）。
- `remove_node` → `RemoveNodeCommand`；`remove_edge` → `RemoveEdgeCommand`。
- `add_edge` → `AddEdgeCommand`，`id` 缺省 `createId('edge')`，pin 缺省 `'output'` / `'input'`。
- `duplicate_node` → `DuplicateNodeCommand`；`move_node` → `MoveNodeCommand`；`resize_node` → `ResizeNodeCommand`。
- `batch` → 递归展开子 ops 生成 `BatchCommand`（见 §4.4）。
- 未知 op 返回 `null`，导致该次操作 `rejected`（`'Unsupported canvas operation'` / `'No supported canvas operations'`）。

### 4.2 executeOps 签名与执行规则

```ts
export interface CanvasOpExecutorOptions {
  schema?: CanvasSchema;
  observer?: CanvasOperationObserver;
  defaultContext?: Partial<CanvasOperationContext>;
}

export class CanvasOpExecutor {
  constructor(commandQueue: CommandQueue, options: CanvasOpExecutorOptions = {});

  async executeOps(
    ops: CanvasOp[],
    context: Partial<CanvasOperationContext> = {},
  ): Promise<CanvasOperationMetrics>;
}
```

`context` 缺省字段从 `defaultContext` 回退，再回退到内置缺省值（`operationId`/`traceId` 自动生成，`actor: 'user'`）。

执行路径：

- **空 ops**：仅触发 `onPlan`，直接返回 `status: 'planned'`。
- **单 op**：校验 → 转命令 → `commandCount = 1` → `onPlan` → 非 dry-run 时 `commandQueue.execute(cmd)` → `onComplete`。
- **多 op（≥2）**：逐个校验并转命令收集 → `commandCount = cmds.length` → `onPlan` → 若 `cmds.length === 0` 则 `rejected` → 非 dry-run 时以单条 `BatchCommand(cmds, 'canvas-op-batch')` 执行 → `onComplete`。
- 任一 op 校验失败：整次操作立即 `rejected`，**不会部分执行**。

### 4.3 dry-run：只产出计划，不执行命令

`dryRun: true` 时执行器**不会调用 `commandQueue.execute`**，画布状态不变；`onPlan` 照常触发，最终 `status` 为 `'planned'`（`onComplete` 同样触发，此时 `nodeCountAfter === nodeCountBefore`）。

典型用法：Agent 先以 dry-run 校验整组 ops 是否合法（节点结构、连线规则），通过后再以相同 `operationId` 正式执行。

### 4.4 批量事务与嵌套 batch 递归

- 顶层多 op 自动打包为 `BatchCommand(cmds, 'canvas-op-batch')`——整组 ops 在历史中只占**一条**记录，一次 `undo` 全部撤销（见 §5）。
- `batch` op 内部递归调用 `toCommand` 展开 `args.ops`，子 batch 会生成**嵌套** `BatchCommand`；内层命令数计入顶层 `commandCount`。子 ops 全部不可用时返回 `null`。

```ts
await executor.executeOps([
  { op: 'add_node', args: { id: 'a', type: 'shot', position: { x: 0, y: 0 } } },
  {
    op: 'batch',
    args: {
      label: 'agent-sub-plan',
      ops: [
        { op: 'add_node', args: { id: 'b', type: 'shot', position: { x: 300, y: 0 } } },
        { op: 'add_edge', args: { source: { nodeId: 'a' }, target: { nodeId: 'b' } } },
      ],
    },
  },
], { actor: 'agent' });
```

### 4.5 幂等键仅透传，无去重

`idempotencyKey` 会被原样写入 `CanvasOperationContext` 并随 metrics 暴露给 observer，但**执行器自身不维护去重表、不丢弃重复键**。网络层 / Agent 宿主负责幂等（例如按键记录已应用的 `operationId`），不要把 `idempotencyKey` 当成执行器内置的防重放保障。

## 5. BatchCommand 原子性与 undo/redo

`packages/core/src/command/builtins.ts`：

```ts
export class BatchCommand implements Command {
  id: string;
  private readonly commands: Command[];

  constructor(commands: Command[], id = 'batch');

  execute(state: GraphModel, context: CommandContext): GraphModel; // 顺序执行子命令
  undo(state: GraphModel, context: CommandContext): GraphModel;    // 逆序撤销子命令
}
```

`Command` 契约（`packages/core/src/command/command-queue.ts`）：

```ts
export interface Command {
  id: string;
  execute(state: GraphModel, context: CommandContext): GraphModel;
  undo(state: GraphModel, context: CommandContext): GraphModel;
}
```

`CommandQueue` 关键 API：`execute(command)`、`undo()`、`redo()`、`canUndo()`、`canRedo()`、`getState()`；历史容量默认 50 条，支持注册合并策略（`setMergeStrategy` / `addMergeStrategy`）。

原子性语义：

- 一次 `executeOps`（多 op 或 `batch` op）在历史中是一条 `BatchCommand`；`undo` 逆序回放子命令的 `undo`，因此"加 50 节点"这类操作一次撤销全部还原，不会残留半个批次。
- `execute` 顺序应用子命令；**当前实现不提供失败回滚**——若子命令抛异常，批次停留在中间状态。因此 Agent 应在执行前用 dry-run 充分校验，把运行时失败概率压到最低。

## 6. 完整示例：一次 Agent 操作流程

规划 ops → dry-run 校验 → 执行 → 观测 metrics：

```ts
import { CanvasOpExecutor, type CanvasOp } from '@/pages/editor/editor-canvas/interactions/canvas-op-executor';
import type { CanvasOperationMetrics } from '@zeroexo/core';

const executor = new CanvasOpExecutor(commandQueue, {
  schema: storyboardSchema,
  observer: {
    onPlan: (m) => telemetry.track('canvas.op.planned', m),
    onComplete: (m) => telemetry.track('canvas.op.completed', m),
  },
  defaultContext: { actor: 'agent', source: 'agent.storyboard' },
});

// 1. 规划 ops：Agent 决策产物，共用一个 operationId/traceId
// （createId 为示意；运行期可用 crypto.randomUUID() 等生成）
const operationId = createId('op');
const traceId = createId('trace');
const ops: CanvasOp[] = [
  { op: 'add_node', args: { id: 'shot-1', type: 'shot', position: { x: 40, y: 120 }, title: '开场' } },
  { op: 'add_node', args: { id: 'shot-2', type: 'shot', position: { x: 320, y: 120 }, title: '冲突' } },
  { op: 'add_edge', args: { source: { nodeId: 'shot-1' }, target: { nodeId: 'shot-2' } } },
];

// 2. dryRun 校验：不修改画布，只验证并产出计划
const planned = await executor.executeOps(ops, {
  operationId, traceId, actor: 'agent', dryRun: true,
});
// planned.status === 'planned'; commandCount === 3; 画布节点/边数不变

// 3. 正式执行：整组 ops 打包为单条 BatchCommand，一次 undo 全部还原
const executed = await executor.executeOps(ops, {
  operationId, traceId, actor: 'agent',
});
// executed.status === 'executed'; nodeCountAfter = nodeCountBefore + 2; edgeCountAfter = edgeCountBefore + 1

// 4. 观测：onPlan/onComplete 已由 observer 统一上报；失败时 error 携带原因
if (executed.status !== 'executed') {
  // executed.status === 'rejected'，executed.error 给出校验失败原因
  agentLogger.warn('canvas op rejected', executed);
}
```

## 7. 埋点最佳实践

- **统一经 observer 上报**：`onPlan` 记计划、`onComplete` 记结果，不要在业务代码里散落打点。
- **区分 status**：`planned`（dry-run）/ `executed`（成功）/ `rejected`（校验拒绝）；用 `error` 记录原因，便于 Agent 自纠后重试。
- **用 `opCount` vs `commandCount`** 对比"规划了 N 条 op"与"实际落库 M 条命令"（嵌套 batch 展开会计入）。
- **actor / source 必须真实**：Agent 调用传 `actor: 'agent'` 与 `source` 能力名，保证报表能区分人工与程序化操作。
- **关联复合操作**：一次 Agent 任务的多次 `executeOps` 共享 `traceId`，子操作填 `parentOperationId`，主操作填 `operationId`。
- **同键复用**：dry-run 与正式执行用同一 `operationId`，便于将"计划 → 执行"配对分析。

## 8. 禁止事项

- **禁止逐个 op 单独调用 `executeOps`**：N 条 op 会生成 N 条历史记录与 N 组 `onPlan/onComplete`，既无法一次 undo 原子撤销，又污染指标；中途失败还会留下"执行了一半"的脏画布。整组 ops 一次传入，由执行器打包为单条 `BatchCommand`。
- **禁止绕过 `commandQueue`**：不要用 `setStateSilent`、直接改写 state 或任何绕过执行器的方式提交 Agent 改动——那会脱离撤销/重做历史与埋点链路（`setStateSilent` 仅用于拖拽等瞬态场景，且不产生命令历史）。Agent 的画布写入唯一入口是 `CanvasOpExecutor.executeOps`。
- **禁止手工 `new BatchCommand(...)` 后直接执行**：批处理、校验、埋点由 `executeOps` 统一负责；直接操作命令对象会跳过 `validateOp` 与 observer 上报。
- **禁止依赖 `idempotencyKey` 防重**：执行器只透传不去重，重复提交仍会重复执行；幂等由网络层或 Agent 宿主自行保证。

## 9. 参考文件

- `zeroexo_front/packages/core/src/node-runtime-contract.ts` — 上下文 / 指标 / 观测器 / actor
- `zeroexo_front/packages/core/src/canvas-schema.ts` — Schema / 连接决策 / 节点动作
- `zeroexo_front/src/pages/editor/editor-canvas/interactions/canvas-op-executor.ts` — 执行器实现
- `zeroexo_front/packages/core/src/command/command-queue.ts` — 命令队列与撤销/重做
- `zeroexo_front/packages/core/src/command/builtins.ts` — 内置命令与 `BatchCommand`
- 实际用法示例：`zeroexo_front/src/pages/editor/editor-canvas/interactions/ai-generation.ts`（`addReference` / `oneClickCopy` 通过 `executeOps` 写画布）
