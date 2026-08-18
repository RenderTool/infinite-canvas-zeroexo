# Node Authoring Guide

## 新节点接入路径

1. 在节点包中创建数据类型、默认数据和 Pin 定义。
2. 创建一个纯 Model 模块，负责数据变换和 Command 构造。
3. 创建 View，优先复用 `BaseNodeView`；独特视觉声明 `appearance: 'custom'`。
4. 在 Registry 扩展中提供 `runtime`、`capabilities`、`getPins`、`renderNode` 和工具集。
5. 将跨节点操作写成可撤销 Command，并为 Agent 提供对应 CanvasOp。
6. 增加最小单元测试、压力测试数据源和一页接入文档。

## 推荐包体结构

```text
nodes/<type>/
  <type>-types.ts
  <type>-model.ts
  <type>-runtime.ts
  <type>-view.tsx
  <type>-toolbar.tsx
  <type>.test.ts
index.ts
```

文件名按职责搜索比按 UI 组件搜索更容易。不要把数据解析、命令构造、媒体加载和完整 View 持续堆在一个文件中。

## Agent 基础设施

Agent 不直接修改 GraphModel。它应生成 `CanvasOp[]`，带上 `actor: 'agent'`、`traceId` 和 `idempotencyKey`，先 `dryRun` 获取计划，再提交同一批操作。失败、拒绝和耗时均通过 Observer 记录。

## 兼容策略

项目处于早期阶段，架构改造以基线快照为回滚点，不新增旧数据适配层。新的数据契约必须带 `schemaVersion`，但不为历史格式维护永久分支。
