# Example 1 & 2：最小文本节点 + 媒体节点

两个自包含节点类型，演示 `NodeTypeExtension` 的最小完整写法、Pin 与 dataType、`createDefaultData`、尺寸约束、`Capability` 声明与工具栏注入。依赖：`@zeroexo/core`、`@zeroexo/plugin-node-registry`、`@zeroexo/plugin-nodes`。

## step 1 定义视图

```tsx
// examples-views.tsx
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import { createPinHandlers, BaseNodeView } from '@zeroexo/plugin-nodes';
import type { ConnectionController } from '@zeroexo/plugin-connection';

const NOTE_PINS: Pin[] = [
  { id: 'input', name: 'Input', direction: 'input', dataType: 'text', color: '#ee9d3d' },
  { id: 'output', name: 'Output', direction: 'output', dataType: 'text', color: '#ee9d3d' },
];

export function createNoteRenderer(controller: ConnectionController | null) {
  // NodeRendererProps 不含引脚事件回调，用 createPinHandlers 构造
  return (props: NodeRendererProps) => {
    const { node, pins, isSelected, isHovered, title, ...rest } = props as any;
    const handlers = createPinHandlers(controller, node.id);
    return (
      <BaseNodeView
        node={node}
        pins={pins}
        isSelected={isSelected}
        isHovered={isHovered}
        title={String(node.title ?? 'note')}
        color="#ee9d3d"
        connectionController={controller}
        {...handlers}
      >
        <div style={{ padding: 8, color: '#333' }}>
          {String((node.data as { content?: string })?.content ?? '')}
        </div>
      </BaseNodeView>
    );
  };
}
```

注意：`BaseNodeViewProps` 的字段（`title`、`color`、`connectionController`、`children` 等）以 `packages/plugins/nodes/src/index.tsx` 导出为准；引脚回调通过 `createPinHandlers(controller, node.id)` 解构注入。

## step 2 定义扩展

```tsx
// examples-extensions.tsx
import type { NodeTypeExtension, NodeRuntimeContract } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';

/** 标准 node runtime：自由缩放 + 500 设计基准 + NodeShell 外观 */
function createNodeRuntime(defaultSize: { width: number; height: number }): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...defaultSize, referenceSize: 500 },
        mode: 'free',
        preserveAspectRatio: false,
      },
      visual: { appearance: 'shell', selectionMode: 'runtime' },
    },
  };
}

export interface NoteNodeData {
  content: string;
}

export function createNoteExtension(controller: ConnectionController | null): NodeTypeExtension {
  return {
    type: 'example-note',
    displayName: '示例便签',
    category: 'Examples',
    color: '#ee9d3d',
    icon: 'note',

    capabilities: { stackable: true, capabilities: ['text'] },
    runtime: createNodeRuntime({ width: 220, height: 120 }),
    defaultSize: { width: 220, height: 120 },
    resizable: true,
    minSize: { width: 120, height: 60 },

    getPins: () => NOTE_PINS,

    // 必须返回视图预期的完整结构，防止老数据/空数据崩溃
    createDefaultData: (): NoteNodeData => ({ content: 'New note' }),

    canConnect(source, target) {
      if (target.direction === 'input' && target.pinId === 'input' && source.direction === 'output') {
        return { valid: true };
      }
      return { valid: false, reason: 'note: only text output accepted' };
    },

    getTools(node, ctx) {
      return [
        {
          id: 'note:clear',
          label: '清空',
          title: '清空内容',
          icon: 'clear',
          run: (n, c) =>
            c.commandQueue.execute({
              id: 'UpdateNodeCommand',
              nodeId: n.id,
              patch: { data: { ...((n.data ?? {}) as object), content: '' } },
            }),
        },
      ];
    },

    renderNode: createNoteRenderer(controller),
  };
}
```

## step 3 媒体节点变体

媒体节点只差三处：`dataType` 用 `'image'`、`capabilities` 声明 `mediaKinds`、锁宽高比。

```tsx
export function createMediaExtension(controller: ConnectionController | null): NodeTypeExtension {
  const MEDIA_PINS: Pin[] = [
    { id: 'media', name: 'Media', direction: 'output', dataType: 'image', color: '#3c87b3' },
  ];
  return {
    type: 'example-media',
    displayName: '示例图片',
    category: 'Examples',
    color: '#3c87b3',
    capabilities: { stackable: true, mediaKinds: ['image'], capabilities: ['media', 'replace'] },
    runtime: createNodeRuntime({ width: 320, height: 180 }),
    defaultSize: { width: 320, height: 180 },
    resizable: true,
    lockAspectRatio: true, // 图片/视频节点通常锁定宽高比
    getPins: () => MEDIA_PINS,
    createDefaultData: () => ({ content: '', label: '' }),
    renderNode: createMediaRenderer(controller),
  };
}
```

## step 4 注册

```tsx
// 在 editor install 完成之后（use-editor-state.ts 的 createDefaultEditor 之后）
ed.plugins.nodes.registerAll(
  [createNoteExtension(ed.plugins.connection?.getController() ?? null),
   createMediaExtension(ed.plugins.connection?.getController() ?? null)],
  'app',
);

// 需要 canConnect 连线控制器读取扩展时，再注入访问器
const nodeRegistry = ed.core.plugins.get('node-registry');
if (nodeRegistry && ed.plugins.connection) {
  ed.plugins.connection
    .getController()
    .setExtensionAccessor((nodeId: string) =>
      nodeRegistry.get(ed.store.getGraph().nodes.find((n) => n.id === nodeId)?.type ?? ''),
    );
}
```

验证：打开节点菜单（Examples 分类）→ 创建便签 → 输入文字 → 拖动 output 连到其他 text pin → 悬浮工具栏出现「清空」→ 撤销。