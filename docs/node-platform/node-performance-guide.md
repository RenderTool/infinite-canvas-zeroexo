# Node Performance Guide

## 性能原则

- WebSocket 协作不按“节点数超过 500”限流。
- 使用命令批处理、增量 Graph 更新、可见性/LOD、帧预算和边索引控制成本。
- 网络同步按操作批次和字段增量组织，渲染按变更节点调度。
- 所有限制必须是可配置的资源保护阈值，并区分警告、降级和拒绝。

## 1000 节点压力数据

运行：

```bash
node tools/node-stress/generate-node-stress-fixture.mjs --count 1000 --seed 42 --mode dense-grid --output .tmp/stress-1000.json
```

参数支持 `--seed`、`--columns`、`--stackRate` 和 `--materials`。素材格式为 `image|url,video|url,audio|url,text|url`，生成器会保留真实素材引用，不把媒体转成假占位数据。

模式：

- `chain`：首尾链路。
- `grid`：网格相邻连线。
- `dense-grid`：网格邻接加跨列连线，适合性能截图。
- `complete`：全连接，专门测试极端边密度。

## Dev Performance Panel

开发模式左上角面板提供节点数、边数、FPS、帧耗时、JS Heap、同步状态和瓶颈分类。正式构建通过 `import.meta.env.DEV` 不挂载该面板。

后续应继续接入：可见节点数、命令队列长度、同步批次大小、最近一次操作耗时、Worker/主线程占用和空间索引命中率。
