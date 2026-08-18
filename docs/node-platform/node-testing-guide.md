# Node 测试与压测指南（Node Testing Guide）

本文档说明 ZeroExo 节点平台的测试分层、命令写法、视觉回归、协作测试、1000+ 节点压力脚本、素材 seed 约定与基准报告格式。正文为中文、API/代码为英文，命令与源码入口精确一致。

相关源码：

- 单元测试配置：`zeroexo_front/vitest.config.ts`（jsdom、`@` → `src`、`@zeroexo/core` → `packages/core/src/index.ts` 别名）
- 核心测试：`packages/core/src/editor.test.ts`、`command/command-queue.test.ts`、`command/builtins.test.ts`、`bus/event-bus.test.ts`、`plugin/plugin-host.test.ts`
- 领域测试：`packages/plugins/nodes/src/nodes/stacked-media-model.test.ts`
- 压力脚本：`zeroexo_front/tools/node-stress/generate-node-stress-fixture.mjs`
- 调试面板：`src/features/dev/performance/dev-performance-panel.tsx`（`import.meta.env.DEV` 挂载）

---

## 1. 测试分层与命令

```bash
# 全量单测（turbo 并行，覆盖 packages/* 与 src/）
pnpm test:unit

# 单文件热更新
pnpm vitest run packages/plugins/nodes/src/nodes/stacked-media-model.test.ts

# 覆盖率（v8，文本 + html 报告到 coverage/）
pnpm test:coverage
```

分层约定：

| 层 | 测试内容 | 环境 | 要点 |
| --- | --- | --- | --- |
| Core（`packages/core`） | Graph 命令、事件总线、插件宿主 | 纯 node（vitest jsdom 兜底） | 不依赖 React/DOM 的真实行为 |
| 领域 Model（`packages/plugins/*`） | 纯数据层算法（堆叠、尺寸派生、边转移） | 纯 node | 直接构造 `NodeRecord`/`GraphModel` 输入 |
| View | React 组件交互 | jsdom + Testing Library | 少量、聚焦交互与状态，不重复测 Model |
| E2E/视觉 | 浏览器渲染 | Playwright 等 | 见 §3 |

## 2. 契约测试写法（Model 与 Command）

领域算法必须脱离浏览器单测。核心不变量是 **命令 `execute` / `undo` 对称性**：`undo(execute(graph))` 应还原到原始图（顺序无关时按 id 排序后深比较）。

参考 `stacked-media-model.test.ts` 的三类断言：

```ts
it('switches active card and resizes in one undoable command', () => {
  const result = activateStackCard(node, data, 1);
  const after = result.command.execute(createGraph(node), context);

  expect((after.nodes[0]!.data as { activeIndex: number }).activeIndex).toBe(1);
  expect(after.nodes[0]!.size).toEqual({ width: 500, height: 1056 });
  // 关键：一次 undo 回到初始图
  expect(result.command.undo(after, context)).toEqual(createGraph(node));
});

it('stacks selected nodes atomically and skips unsupported ones', () => {
  // 能力过滤：generator 不 stackable → 跳过
  expect(result!.skippedIds).toEqual(['gen1']);
  // 边转移：源节点下游边转移到新 StackNode，源边删除
  expect(after.edges.some((e) => e.source.nodeId === result!.stackNodeId)).toBe(true);
  expect(after.edges.some((e) => e.source.nodeId === 'img1')).toBe(false);
  // 整组 undo 还原（顺序不同，按 id 排序深比较）
  expect(byId(restored.nodes)).toEqual(byId(graph.nodes));
});
```

写新命令时至少覆盖：

- **原子性**：一次 `BatchCommand` 内完成全部子命令，`undo` 必须完全还原（节点顺序、边、`data` 深比较）。
- **边界**：空输入（`stackable.length === 0` 返回 `null`）、缺数据（`getStackDisplayHeight(…, {})` 返回 `null`）、非法比例。
- **资源完整性**：不产生悬挂边、不残留孤儿节点、不泄露旧 id。
- **可观测性**：命令构造阶段可用 `CanvasOperationContext` 注入 actor/trace，压测角色（`stress`）应有对应测试路径。

## 3. 视觉回归

视觉基线（`node-visual-system.md`）确立后，截图应锁定为对比基线：

- 每个节点类型至少一张默认态截图 + 选中态截图 + disabled/悬停态截图。
- 截图基准尺寸以 `NodeScaleContract.basis` 为准（StackNode 用 500 宽基准，卡片切换后高度按自然比例派生）。
- 回归断言建议锁定：主题 token 值（`DARK_THEME`/`LIGHT_THEME`）、`outlineWidth`、`borderRadius`、Pin 默认值（`PinDefaults`/`NodeDefaults`）。
- 正式构建无法观测（`import.meta.env.DEV` 外不着色），视觉回归脚本要显式注入 dev 开关。

## 4. 协作测试

协作层基于 Yjs/WebSocket（`@hocuspocus/provider`）。测试要点：

- **双端往返**：A 端 `executeOps` → 同步 → B 端收到相同 `operationId/traceId` 的变更；B 端 undo 后两端状态一致。
- **冲突矩阵**：同一点位新建、同节点连不同 pin、双端同时 eject 同一卡片。
- **幂等语义**：`CanvasOperationContext.idempotencyKey` 由执行器**透传但不实现去重**（见 `node-agent-integration.md` §4.5），协作测试不得假设调用方层面有幂等保证，需要在网络层做重试去重测试。
- **撤销收敛**：一端 undo 在另一端必须表现为可观测的图变更，不能只改本地。

## 5. 1000+ 节点压力脚本

脚本位于 `zeroexo_front/tools/node-stress/generate-node-stress-fixture.mjs`，生成纯 JSON fixture（不依赖 React）：

```bash
node tools/node-stress/generate-node-stress-fixture.mjs \
  --count 1000 --seed 42 --mode dense-grid \
  --materials "image|https://cdn.example.com/a.jpg,video|https://cdn.example.com/b.mp4,audio|https://cdn.example.com/c.mp3,text|https://cdn.example.com/d.txt" \
  --output .tmp/stress-1000.json
```

参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--count` | 1000 | 节点数量（Fixtures 规模） |
| `--seed` | `Math.random()` 派生 | 生成种子，复现同一份图 |
| `--columns` | 推导 | 网格列数 |
| `--stackRate` | 推导 | 堆叠节点占比（生成 `stacked-media` 与卡片） |
| `--mode` | `grid` | `chain` 首尾链路 / `grid` 网格邻接 / `dense-grid` 网格 + 跨列连线（性能截图用）/ `complete` 全连接（极端边密度） |
| `--materials` | 内置 | 素材引用表，格式 `kind\|url`，逗号分隔；**保留真实素材 URL，不伪造占位数据** |

生成器会为媒体节点写入真实 `data.content` 引用，token/pin 与内置类型一致，可直接交给编辑器加载并压测渲染链路。

## 6. 素材 seed 约定

- `--seed` 固定（文档示例用 `42`）以保证本地与 CI 复现同一张图；同一 seed + 同一 mode + 同一 count 必须产出字节级相同 fixture（生成器内部为纯函数）。
- `--materials` 中的素材 URL 代表「引用关系」，不要求真实可达；性能测量的是渲染与同步成本，不受网络资源可达性影响。
- 压测性能报告必须带上 seed 与 mode，否则数据不可比。

## 7. 基准报告格式

每次基准测量产出以下块（markdown），放入 `node-performance-guide.md` 的更新记录或独立报告：

```markdown
## 基准（<date>）

- 环境：Node <ver> / Chromium <ver> / OS <ver>
- Commit：<short-sha>
- Fixture：`--count 1000 --seed 42 --mode dense-grid`
- 交互脚本：<describe realuser actions, e.g. select 3 nodes -> stack -> undo>

| 指标 | 数值 | 目标 |
| --- | --- | --- |
| 初始加载与布局（ms） |  | < 2000 |
| 全选 + 堆叠 100 节点（ms） |  | < 500 |
| 单命令 execute/undo 往返（ms） |  | < 16 |
| 1000 节点低缩放 LOD FPS |  | >= 60 |
| 全量 Media 节点 FPS |  | >= 30 |
| JS Heap（MB） |  | < 600 |

- 结论：<通过 / 未通过，附差距分析>
- 附件：截图（`dense-grid` 整体 + 选中态 + 堆叠后）
```

数据来源：Dev Performance Panel（左上角）在 `import.meta.env.DEV` 下显示的 FPS、帧耗时、JS Heap 与同步状态；瓶颈分类（渲染/布局/脚本/网络）以面板分类为准。

## 8. 禁止事项

- 禁止在测试中依赖「节点数量触发的前端限流」（平台明确禁止此类限流，见 `node-platform-design.md`）。
- 禁止用真素材请求阻塞单测；URL 引用即有效 fixture。
- 禁止只测 View 不测命令对称性；undo 不还原即视为命令 bug。
- 禁止在压测报告中省略 `--seed` 与 `--mode`。