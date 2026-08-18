# ZeroExo Node Platform Design

## 目标

ZeroExo 的节点包采用 Graph Model + Node Definition + Node View + Command 的组合式架构。它借鉴 UE5 EdGraph/K2Node 的职责分离，但不在 React 中模拟 C++ 继承树：数据和能力通过契约组合，视图通过 React 组件组合，行为通过 Command/Strategy 注入。

## 分层

| 层 | 职责 | 依赖方向 |
| --- | --- | --- |
| `@zeroexo/core` | GraphModel、命令、事件、节点契约、连接 Schema | 零业务依赖 |
| Node Registry | 节点类型注册、Pin 和 Definition 分发 | 依赖 core |
| Node Runtime | 尺寸、视觉、能力、操作策略 | 依赖 core 和业务能力 |
| Node View | React 展示、交互、局部状态 | 依赖 runtime/registry |
| Command/Operation | 可撤销变更、批量执行、Agent 计划执行 | 依赖 core |
| Dev Tools | 性能面板、操作指标、压力测试 | 依赖运行时，不进入生产路径 |

## 设计模式

- Registry：按节点类型发现定义和渲染器，避免巨型条件分支。
- Strategy：`CanvasSchema`、节点工具和能力接口负责可替换规则。
- Command：所有图变更进入 `CommandQueue`，批量操作使用 `BatchCommand`。
- Composite：StackNode 的卡片模型和批量命令组合多个节点行为。
- Observer：`CanvasOperationObserver` 为 Agent、网络同步和 Dev UI 提供统一埋点。
- Capability：节点通过 `NodeCapabilities` 声明可堆叠、媒体编辑等能力，而不是由 StackNode 猜测类型。

## React 与“基类”

React 没有 UMG 那种强制继承式控件基类。项目中的 `BaseNodeView` 是视觉和 Pin 行为的组合壳，不是业务继承约束。建议：

- 通用壳使用组件组合和 hooks。
- 节点独有 UI 使用独立 View。
- 工具、尺寸、连接和编辑能力使用纯函数/策略。
- 屏幕固定胶囊菜单使用 overlay，并通过 `screen-fixed` 与画布缩放解耦。

## StackNode 规则

- 500x500 是数据计算基准，不是固定相册容器尺寸。
- 当前图片/视频的自然比例驱动 StackNode 高度，导航栏作为附加区域。
- StackNode 自身可缩放，基础尺寸由 `NodeScaleContract` 描述。
- 移出统一执行：更新卡片、生成独立节点、断开关系、放到 StackNode 前方；整组操作可撤销。
- StackNode 连入 StackNode 时，连入者合并到目标者，目标者保留最终状态，并转移源堆叠的下游边。
- 当前卡片的图片/视频/文本/音频工具通过 `targetNode` 代理到原始工具定义。

## 代码验收门槛

- Core 不依赖 React、DOM 或业务包。
- View 不直接编排跨节点数据变更，变更必须通过 Model/Command。
- 单文件只承担一个主职责；大型节点 View 应继续拆分 Model、Toolbar、Preview、Navigation。
- 新能力必须同时提供契约、实现、测试/压测入口和接入说明。
- 禁止新增按节点数量触发的前端限流；性能控制应使用批处理、帧预算、可见性和增量同步。
