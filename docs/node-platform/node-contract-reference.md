# Node Contract Reference

## Node Definition

```ts
interface NodeDefinition {
  schemaVersion: number;
  size?: NodeScaleContract;
  measure?: NodeElementMeasureContract;
  visual?: NodeVisualContract;
  overlay?: OverlayContract;
  capabilities?: NodeCapabilities;
}
```

`size.basis` 描述设计基准，`mode` 为 `free`、`uniform` 或 `locked`，`preserveAspectRatio` 只表示默认策略，不限制业务节点自行实现更复杂的尺寸算法。

`visual` 统一描述 hover、selected、disabled、focus 和切换动画。节点可以选择 `shell` 或 `custom`，因此堆叠、音频、分镜和脚本节点可以拥有完全不同的视觉语言。

`overlay.scaleMode`：

- `screen-fixed`：胶囊、工具提示、浮动菜单不随画布缩放改变屏幕尺寸。
- `world-scaled`：属于节点内容的装饰元素随节点一起缩放。

## Capability

```ts
interface NodeCapabilities {
  stackable?: boolean;
  mediaKinds?: string[];
  capabilities?: string[];
}
```

能力是开放字符串集合。推荐使用领域前缀，例如 `media.crop`、`media.replace`、`stack.merge`，避免用节点类型名称硬编码业务行为。

## Canvas Schema

`CanvasSchema.validateConnection` 返回 `allowed`、`reason` 和可选 `action`。连接规则应先由源/目标节点自治策略决定，再由全局 Schema 做兜底。`collect-into-target` 和 `merge-stacks` 是领域动作，不应被普通连线 UI 静默解释为普通边。

## Tool target

工具显示在宿主节点上但操作当前 Stack item 时使用：

```ts
targetNode(hostNode, context): NodeRecord
```

工具栏必须对 `visible`、`active`、`title`、`icon`、`menu` 和 `run` 全部使用解析后的目标节点。

## Operation Context

Agent 和协作同步统一使用 `CanvasOperationContext`：

- `operationId`：一次用户或 Agent 操作。
- `traceId`：跨网络/命令/渲染链路追踪。
- `actor`：`user`、`agent`、`import` 或 `stress`。
- `dryRun`：只验证和生成计划，不提交命令。
- `idempotencyKey`：网络重试去重。
- `parentOperationId`：复合操作关联。

`CanvasOpExecutor` 对操作做 Schema 校验、批量命令封装并发出 `onPlan/onComplete` 指标。
