# Example 3 & 4：StackNode 卡片接入 + 完全自定义 UI 节点

## Example 3 StackNode 卡片接入

让自定义节点成为 StackNode 可收纳卡片只需 `stackable: true`；要支持「当前卡片工具被 StackNode 复用」，给同类型节点提供工具集即可。StackNode 通过 `targetNode` 把宿主节点解析为当前卡片对应的源节点后，调用该类型节点的 `getTools` / `getPins`。

要点：

1. `capabilities.stackable === true` 与 `mediaKinds` 声明（`['image']` / `['video']` / `['text']` 等）。
2. `createDefaultData` 返回可并入卡片的结构；卡片快照语义以 `stackSelectedNodes` / `collectCard` 为准（见 `node-capability-guide.md` §2）。
3. 工具定义中如果作用于卡片内容，用 `targetNode(hostNode, ctx)` 拿当前卡片节点再取字段：

```tsx
// 示例：宿主（stack）上的替换工具，作用于当前卡片
import type { NodeRecord, ToolContext, ToolDefinition } from '@zeroexo/core';

export function makeCardTools(
  getTarget: (host: NodeRecord, ctx: ToolContext) => NodeRecord,
): ToolDefinition[] {
  return [
    {
      id: 'card:replace',
      label: '替换',
      title: '替换当前卡片媒体',
      icon: 'replace',
      // 可见性与执行都以目标节点为准
      visible: (host, ctx) => {
        const t = getTarget(host, ctx);
        return t != null && t.type !== 'text';
      },
      run: (host, ctx) => {
        const t = getTarget(host, ctx);
        // 打开图片编辑对话框（由 app 层注入 openImageDialog，type='replace'）
        ctx.openImageDialog?.(t, 'replace');
      },
    },
  ];
}
```

- 若业务节点想复用 StackNode 已有的收纳/移出/合并语义，直接在节点层调用 `packages/plugins/nodes/src/nodes/stacked-media-model.ts` 的纯数据函数 + 对应 `BatchCommand`（`collectCard` / `ejectCard` / `mergeStacks`），保持命令可撤销、边可转移。

## Example 4 完全自定义 UI 节点

不借用 NodeShell，节点全自绘：`viewContract.useShellChrome: false` 且各状态效果设为 `'custom'`。典型：音频波形节点、全屏预览容器。

```tsx
import type { NodeViewContract, NodeRendererProps } from '@zeroexo/core';

const CUSTOM_VIEW_CONTRACT: NodeViewContract = {
  selectionEffect: 'custom',       // NodeShell 不再画选中 outline，由视图自绘
  focusEffect: 'custom',
  hoverEffect: 'custom',           // NodeLayer 跳过默认阴影
  connectionHoverEffect: 'custom',
  useShellChrome: false,           // 整节点全自绘（含标题栏）
};

export function createWaveformRenderer() {
  return (props: NodeRendererProps) => {
    const { node, isSelected, isHovered, forceShowPins } = props;
    const d = node.data as { samples?: number[] };
    return (
      <div
        style={{
          width: '100%', height: '100%',
          boxSizing: 'border-box',
          background: isSelected ? '#1f2937' : '#0f172a',
          border: `${isSelected ? 2 : 1}px solid ${isHovered ? '#38bdf8' : '#334155'}`,
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'monospace', color: '#7dd3fc',
        }}
      >
        {/* 自绘波形：samples 渲染 SVG polyline；懒渲染可在低缩放 LOD 下换占位 */}
        <svg width="90%" height="60%">
          <polyline
            points={(d?.samples ?? [0]).map((s, i) => `${i * 4},${30 - s * 28}`).join(' ')}
            fill="none" stroke="#38bdf8" strokeWidth="2"
          />
        </svg>
      </div>
    );
  };
}
```

配套 `NodeTypeExtension`：

```tsx
export function createWaveformExtension(): NodeTypeExtension {
  return {
    type: 'example-waveform',
    displayName: '示例波形',
    category: 'Examples',
    color: '#38bdf8',
    // 特化外观：不参与全局外观配置与基准尺寸恢复，但仍参与 LOD 与位置类操作
    specialAppearance: true,
    runtime: {
      definition: {
        schemaVersion: 1,
        size: { basis: { width: 320, height: 96, referenceSize: 500 }, mode: 'locked', preserveAspectRatio: true },
        visual: { appearance: 'custom', selectionMode: 'custom' },
      },
    },
    defaultSize: { width: 320, height: 96 },
    resizable: false,
    viewContract: CUSTOM_VIEW_CONTRACT,
    getPins: () => [],
    createDefaultData: () => ({ samples: [] }),
    renderNode: createWaveformRenderer(),
  };
}
```

注意：

- `specialAppearance: true` 意味着节点不吃全局主题化外观改动（`node-visual-system.md` §7 细节）。
- 选择集/点击行为仍需正常广播；自绘状态只是替换「视觉」，不要替换「行为契约」。
- 自绘节点也要遵守 LOD 降级：低缩放时切换到简化占位，不能拖垮帧率。