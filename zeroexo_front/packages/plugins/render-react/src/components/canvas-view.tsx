/**
 * CanvasView - 画布主视图
 * 组合 Viewport + EdgeLayer + NodeLayer
 * 通过 ReactGraphStore 订阅状态,外部只需传入 store + extensions
 */

import React from 'react';
import type { NodeTypeExtension, NodeRecord, CommandQueue } from '@zeroexo/core';
import { Viewport_ } from './viewport.js';
import { NodeLayer } from './node-layer.js';
import { EdgeLayer } from './edge-layer.js';
import {
  ReactGraphStore,
  ReactGraphStoreContext,
  useGraph,
  useViewport,
  useSelection,
} from '../store.js';

export interface CanvasViewProps {
  /** 状态存储(由 createRenderStore 或 RenderReactPlugin.getStore 提供) */
  store: ReactGraphStore;
  /** 节点类型扩展(从 node-registry 插件获取) */
  extensions: Map<string, NodeTypeExtension>;
  /** 容器 ref */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** 背景 */
  background?: 'dots' | 'lines' | 'none';
  backgroundColor?: string;
  gridColor?: string;
  /** 点阵网格色(优先于 gridColor,用于 dots 模式) */
  gridDotColor?: string;
  /** 线条网格色(优先于 gridColor,用于 lines 模式) */
  gridLineColor?: string;
  gridSize?: number;
  /** 默认边色 */
  edgeColor?: string;
  /** 选中边色 */
  edgeSelectedColor?: string;
  /** 悬停边色 */
  edgeHoverColor?: string;
  /** 交互回调(由 interaction 插件注入) */
  onCanvasPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
  /** 右键菜单事件(透传给 Viewport_,用于检测点击节点/边/空白区域) */
  onCanvasContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 右键菜单项(覆盖默认的 复制/粘贴/删除,透传给 Viewport_ 的 ContextMenu; null=不显示内置菜单) */
  contextMenuItems?: import('@/shared/components/index.js').ContextMenuItem[] | null;
  /** 画布拖拽事件(Phase D2:AssetPicker 素材/外部文件拖入画布生成节点) */
  onCanvasDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onCanvasDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onNodePointerDown?: (e: React.PointerEvent, nodeId: string) => void;
  onNodePointerEnter?: (e: React.PointerEvent, nodeId: string) => void;
  onNodePointerLeave?: (e: React.PointerEvent, nodeId: string) => void;
  /** 触摸事件(用于移动端长按显示右键菜单) */
  onNodeTouchStart?: (e: React.TouchEvent, nodeId: string) => void;
  onNodeTouchEnd?: (e: React.TouchEvent, nodeId: string) => void;
  onNodeTouchMove?: (e: React.TouchEvent, nodeId: string) => void;
  onEdgePointerDown?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerEnter?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerLeave?: (e: React.PointerEvent, edgeId: string) => void;
  /** 裁切连线回调 */
  onCutEdge?: (edgeId: string) => void;
  /** resize handle 指针事件(由 interaction 插件注入) */
  onResizeHandlePointerDown?: (
    e: React.PointerEvent,
    nodeId: string,
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  ) => void;
  /** 节点数据更新回调(默认通过 CommandQueue 更新) */
  onUpdateNode?: (nodeId: string, patch: Partial<NodeRecord>) => void;
  /** 命令队列(传递给 NodeLayer → 节点渲染器,用于提交命令) */
  commandQueue?: CommandQueue;
  /** 自定义子内容(覆盖默认层,渲染在最上层,如连线预览/框选) */
  children?: React.ReactNode;
  /**
   * 底层内容(渲染在 EdgeLayer/NodeLayer 之前,最底层)。
   * 用于 GroupLayer 等需要在节点之下渲染的层(组 zIndex -10,节点 0/5/10)。
   * 通过 DOM 顺序(GroupLayer 在 NodeLayer 之前)实现层级关系(各层容器有 transform
   * 建立独立 stacking context,zIndex 只在各自 context 内有效,跨层关系由 DOM 顺序决定)。
   */
  belowNodesLayer?: React.ReactNode;
  /** 交互模式: select=选择/框选, pan=平移(手型光标)。透传给 Viewport_ 控制 cursor */
  mode?: 'select' | 'pan';
  /** 强制显示所有引脚(连线拖拽期间所有节点Pin可见) */
  forceShowPins?: boolean;
  /** 连线拖拽时高亮的目标节点 id(提示可自动连接) */
  connectionHoverNodeId?: string | null;
  /** 悬停节点 id(用于 Pin 可见性控制) */
  hoveredNodeId?: string | null;
  /** 外部触发重命名的节点 id(由工具栏按钮触发) */
  externalRenaming?: string | null;
  /** 重命名完成/取消回调 */
  onRenameFinish?: () => void;
  /** 空画布指引文案(如"右键点击画布创建节点") */
  welcomeHint?: string;
  /** 双击节点回调:缩放画布以聚焦该节点,传递实际尺寸(含 ext.defaultSize 回退) */
  onNodeDoubleClick?: (nodeId: string, width: number, height: number) => void;
}

export function CanvasView({
  store,
  extensions,
  containerRef,
  background = 'lines',
  backgroundColor = '#1a1a2e',
  gridColor = '#16213e',
  gridDotColor,
  gridLineColor,
  gridSize = 32,
  edgeColor,
  edgeSelectedColor,
  edgeHoverColor,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasWheel,
  contextMenuItems,
  onCanvasContextMenu,
  onCanvasDrop,
  onCanvasDragOver,
  onNodePointerDown,
  onNodePointerEnter,
  onNodePointerLeave,
  onNodeTouchStart,
  onNodeTouchEnd,
  onNodeTouchMove,
  onEdgePointerDown,
  onEdgePointerEnter,
  onEdgePointerLeave,
  onCutEdge,
  onResizeHandlePointerDown,
  onUpdateNode,
  commandQueue,
  children,
  belowNodesLayer,
  mode = 'select',
  forceShowPins,
  connectionHoverNodeId,
  hoveredNodeId,
  externalRenaming,
  onRenameFinish,
  welcomeHint,
  onNodeDoubleClick,
}: CanvasViewProps): React.ReactElement {
  const graph = useGraph(store);
  const viewport = useViewport(store);
  const selection = useSelection(store);

  // 性能:handleUpdateNode 必须 useCallback 稳定化(引用稳定才让 NodeItem memo 生效),
  // 否则 CanvasView 每次重渲染都产生新引用,穿透 NodeItem 的 memo 比较器导致全量节点重渲染。
  const handleUpdateNode = React.useCallback(
    (nodeId: string, patch: Partial<NodeRecord>) => {
      if (onUpdateNode) {
        onUpdateNode(nodeId, patch);
        return;
      }
      // 默认通过 store.updateNodeData 更新节点 data(支持撤销)
      // position 变更由 interaction 插件通过 MoveNodeCommand 处理,这里不处理
      if (patch.data && typeof patch.data === 'object') {
        store.updateNodeData(nodeId, patch.data as Record<string, unknown>);
      }
      // title 变更通过 renameNode(同时更新 node.title 和 node.data.title)
      if (patch.title !== undefined) {
        store.renameNode(nodeId, patch.title);
      }
    },
    [onUpdateNode, store],
  );

  // 空画布指引:首次交互(点击/拖入/创建节点)后不再显示
  const hintDismissed = React.useRef(false);
  const handleCanvasPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      hintDismissed.current = true;
      onCanvasPointerDown?.(e);
    },
    [onCanvasPointerDown],
  );

  return (
    <ReactGraphStoreContext.Provider value={store}>
      <Viewport_
        viewport={viewport}
        containerRef={containerRef}
        background={background}
        background_color={backgroundColor}
        grid_color={gridColor}
        grid_dot_color={gridDotColor}
        grid_line_color={gridLineColor}
        grid_size={gridSize}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onCanvasPointerUp}
        onWheel={onCanvasWheel}
        contextMenuItems={contextMenuItems}
        onContextMenu={onCanvasContextMenu}
        onDrop={onCanvasDrop}
        onDragOver={onCanvasDragOver}
        mode={mode}
      >
      {/* 底层:GroupLayer 等(组在节点之下,DOM 顺序决定层级) */}
      {belowNodesLayer}
      <EdgeLayer
        edges={graph.edges}
        nodes={graph.nodes}
        extensions={extensions}
        store={store}
        selectedIds={selection.selectedEdgeIds}
        selectedNodeIds={selection.selectedNodeIds}
        edgeColor={edgeColor}
        edgeSelectedColor={edgeSelectedColor}
        edgeHoverColor={edgeHoverColor}
        onEdgePointerDown={onEdgePointerDown}
        onEdgePointerEnter={onEdgePointerEnter}
        onEdgePointerLeave={onEdgePointerLeave}
        onCutEdge={onCutEdge}
      />
      <NodeLayer
        nodes={graph.nodes}
        store={store}
        extensions={extensions}
        selectedIds={selection.selectedNodeIds}
        hoveredId={hoveredNodeId}
        forceShowPins={forceShowPins}
        connectionHoverNodeId={connectionHoverNodeId}
        onUpdateNode={handleUpdateNode}
        commandQueue={commandQueue}
        onNodePointerDown={onNodePointerDown}
        onNodePointerEnter={onNodePointerEnter}
        onNodePointerLeave={onNodePointerLeave}
        onResizeHandlePointerDown={onResizeHandlePointerDown}
        onNodeTouchStart={onNodeTouchStart}
        onNodeTouchEnd={onNodeTouchEnd}
        onNodeTouchMove={onNodeTouchMove}
        externalRenaming={externalRenaming}
        onRenameFinish={onRenameFinish}
        mode={mode}
        onNodeDoubleClick={onNodeDoubleClick}
      />
      {/* 覆盖层:连线预览/框选等(最上层) */}
      {children}
      {/* 空画布指引 */}
      {welcomeHint && graph.nodes.length === 0 && !hintDismissed.current && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span style={{
            color: 'rgba(255,255,255,0.2)',
            fontSize: 15,
            userSelect: 'none',
            letterSpacing: 0.5,
          }}>
            {welcomeHint}
          </span>
        </div>
      )}
    </Viewport_>
    </ReactGraphStoreContext.Provider>
  );
}
