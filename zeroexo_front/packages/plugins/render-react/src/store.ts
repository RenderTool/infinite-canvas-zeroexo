/**
 * ReactGraphStore - 将 CommandQueue 的不可变状态转换为 React 可订阅形式
 * 基于 useSyncExternalStore,零额外依赖
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { GraphModel, Viewport, NodeRecord, EdgeRecord } from '@zeroexo/core';
import {
  CommandEvents,
  GraphEvents,
  ViewportEvents,
  UpdateNodeDataCommand,
  UpdateNodeTitleCommand,
  GridSpatialIndex,
} from '@zeroexo/core';
import type { CommandQueue, EventBus, NodeSizeResolver } from '@zeroexo/core';
import { computeFocusTarget } from './focus-geometry.js';
import type { FocusBounds } from './focus-geometry.js';

export interface SelectionState {
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
}

/** 拖动瞬态偏移(nodeId → 世界坐标增量)。拖动中由 interaction 写入,渲染层 rAF 直改 DOM */
export type DragOffsets = ReadonlyMap<string, { dx: number; dy: number }>;

/** 空偏移表(常量引用,避免无拖动时反复创建) */
const EMPTY_DRAG_OFFSETS: DragOffsets = new Map();

/**
 * React 友好的状态存储
 * - graph: 节点 + 边 + 元数据(来自 CommandQueue)
 * - viewport: 视口变换(独立维护,不进命令历史)
 * - selection: 选择状态(独立维护,不进命令历史)
 */
export class ReactGraphStore {
  private graph: GraphModel;
  private viewport: Viewport;
  private selection: SelectionState;

  /** 节点索引（P0-2）：graph 变更时重建，替代各处 O(n) nodes.find() */
  private nodesById: Map<string, NodeRecord>;
  /** viewport rAF 合帧（P0-6）：一帧内多次 setViewport 只通知一次 */
  private viewportNotifyScheduled = false;
  /** viewport 动画令牌（T10）：外部 setViewport 递增打断进行中的 animateViewport，
   *  避免动画 rAF 与用户手势/小地图写入并发竞争（双击聚焦后立即滚轮 → 抖动/回跳） */
  private viewportAnimToken = 0;

  private readonly graphListeners = new Set<() => void>();
  private readonly viewportListeners = new Set<() => void>();
  private readonly selectionListeners = new Set<() => void>();

  /** P1-1: per-node 订阅者，graph 变更时只通知发生变化的节点订阅者 */
  private readonly nodeSubscribers = new Map<string, Set<() => void>>();
  /** P1-1: 最近一次 graph 变更中发生变化的节点 ID 集合 */
  private changedNodeIds: ReadonlySet<string> = new Set();
  /** 最近一次 graph 变更中发生变化的边 ID 集合 */
  private changedEdgeIds: ReadonlySet<string> = new Set();

  /** 拖动瞬态偏移表 + 订阅(rAF 合帧通知,渲染层 NodeItem/EdgeItem 直改 DOM) */
  private dragOffsets: DragOffsets = EMPTY_DRAG_OFFSETS;
  private readonly dragOffsetListeners = new Set<() => void>();
  private dragOffsetNotifyScheduled = false;

  /** P1-5: 网格空间索引 — graph 变更时自动重建 */
  private readonly spatialIndex = new GridSpatialIndex();
  /** P1-5: 节点尺寸解析器(由 app 注入,用于空间索引重建) */
  private nodeSizeResolver: NodeSizeResolver | null = null;

  constructor(private commandQueue: CommandQueue, private eventBus: EventBus) {
    this.graph = commandQueue.getState();
    this.nodesById = new Map(this.graph.nodes.map((n) => [n.id, n]));
    this.viewport = { ...this.graph.viewport };
    this.selection = { selectedNodeIds: new Set(), selectedEdgeIds: new Set() };
    // P1-5: 初始构建空间索引
    this.rebuildSpatialIndex();

    // 命令执行/撤销/重做 → graph 更新
    const onGraphChange = (): void => {
      const oldNodesById = this.nodesById;
      const oldEdges = this.graph.edges;
      this.graph = this.commandQueue.getState();
      this.nodesById = new Map(this.graph.nodes.map((n) => [n.id, n]));
      this.computeChangedIds(oldNodesById, oldEdges);
      // P1-5: 空间索引重建(仅当节点增删或引用变化时)
      this.rebuildSpatialIndex();
      this.graphListeners.forEach((l) => l());
      if (this.changedNodeIds.size > 0) {
        for (const nodeId of this.changedNodeIds) {
          const subs = this.nodeSubscribers.get(nodeId);
          if (subs) {
            for (const listener of subs) listener();
          }
        }
      }
    };
    this.eventBus.on(CommandEvents.EXECUTED, onGraphChange);
    this.eventBus.on(CommandEvents.UNDONE, onGraphChange);
    this.eventBus.on(CommandEvents.REDONE, onGraphChange);
    // 直接 graph 事件(插件可能绕过命令直接改 graph)
    this.eventBus.on(GraphEvents.NODE_ADDED, onGraphChange);
    this.eventBus.on(GraphEvents.NODE_REMOVED, onGraphChange);
    this.eventBus.on(GraphEvents.NODE_UPDATED, onGraphChange);
    this.eventBus.on(GraphEvents.EDGE_ADDED, onGraphChange);
    this.eventBus.on(GraphEvents.EDGE_REMOVED, onGraphChange);
  }

  /** P1-1: 计算变更 diff — 比较新旧 nodesById 的引用 */
  private computeChangedIds(oldNodesById: Map<string, NodeRecord>, oldEdges: EdgeRecord[]): void {
    const changedNodes = new Set<string>();
    const changedEdges = new Set<string>();
    // 检查所有节点：新增或引用变化
    for (const [id, node] of this.nodesById) {
      if (oldNodesById.get(id) !== node) {
        changedNodes.add(id);
      }
    }
    // 检查被删除的节点
    for (const id of oldNodesById.keys()) {
      if (!this.nodesById.has(id)) {
        changedNodes.add(id);
      }
    }
    // 检查边：看是否有边关联到变化的节点，或边本身新增/删除
    const oldEdgesById = new Map(oldEdges.map((e) => [e.id, e]));
    for (const edge of this.graph.edges) {
      const old = oldEdgesById.get(edge.id);
      if (old !== edge) {
        changedEdges.add(edge.id);
      }
    }
    this.changedNodeIds = changedNodes;
    this.changedEdgeIds = changedEdges;
  }

  // ===== Graph =====
  getGraph = (): GraphModel => this.graph;
  subscribeGraph = (listener: () => void): (() => void) => {
    this.graphListeners.add(listener);
    return () => this.graphListeners.delete(listener);
  };

  /** P1-1: per-node 订阅 — 仅当该节点数据变化时通知 listener */
  subscribeNode = (nodeId: string, listener: () => void): (() => void) => {
    let subs = this.nodeSubscribers.get(nodeId);
    if (!subs) {
      subs = new Set();
      this.nodeSubscribers.set(nodeId, subs);
    }
    subs.add(listener);
    return () => {
      subs?.delete(listener);
      if (subs?.size === 0) {
        this.nodeSubscribers.delete(nodeId);
      }
    };
  };

  /** P1-1: 获取最近一次 graph 变更中发生变化的节点 ID 集合 */
  getChangedNodeIds = (): ReadonlySet<string> => this.changedNodeIds;

  /** P1-1: 获取最近一次 graph 变更中发生变化的边 ID 集合 */
  getChangedEdgeIds = (): ReadonlySet<string> => this.changedEdgeIds;

  // ===== Viewport =====
  getViewport = (): Viewport => this.viewport;
  subscribeViewport = (listener: () => void): (() => void) => {
    this.viewportListeners.add(listener);
    return () => this.viewportListeners.delete(listener);
  };
  /**
   * 设置视口（P0-6：rAF 合帧）。
   * 值立即生效（getViewport 同步返回最新值），但订阅者通知与
   * ViewportEvents.CHANGED 延迟到下一帧统一发布：高频 wheel/pan 事件
   * 一帧内多次调用只触发一次 React 渲染。
   */
  setViewport = (viewport: Viewport, opts?: { fromAnimation?: boolean }): void => {
    // T10: 非动画来源（用户手势/小地图/外部写入）递增令牌，动画循环自检自停
    if (!opts?.fromAnimation) this.viewportAnimToken++;
    this.viewport = viewport;
    if (this.viewportNotifyScheduled) return;
    this.viewportNotifyScheduled = true;
    const flush = (): void => {
      this.viewportNotifyScheduled = false;
      this.viewportListeners.forEach((l) => l());
      this.eventBus.emit(ViewportEvents.CHANGED, this.viewport);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      flush();
    }
  };

  // ===== 拖动瞬态偏移(拖动中不重建 graph,渲染层每帧直改 DOM) =====

  /** 写入偏移表:立即生效(getDragOffsets 同步返回),通知延迟到下一帧统一发布(rAF 合帧) */
  setDragOffsets = (offsets: DragOffsets): void => {
    this.dragOffsets = offsets;
    if (this.dragOffsetNotifyScheduled) return;
    this.dragOffsetNotifyScheduled = true;
    const flush = (): void => {
      this.dragOffsetNotifyScheduled = false;
      this.dragOffsetListeners.forEach((l) => l());
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      flush();
    }
  };

  getDragOffsets = (): DragOffsets => this.dragOffsets;

  subscribeDragOffsets = (listener: () => void): (() => void) => {
    this.dragOffsetListeners.add(listener);
    return () => this.dragOffsetListeners.delete(listener);
  };

  /** 平滑动画过渡到目标视口(300ms easeInOutCubic) */
  animateViewport = (targetX: number, targetY: number, targetK: number, durationMs = 300): void => {
    const start = { ...this.viewport };
    // T10: 本次动画持有唯一令牌，外部 setViewport（手势/小地图）递增后本循环立即自停
    const token = ++this.viewportAnimToken;
    const startTime = performance.now();
    const animate = (now: number): void => {
      if (token !== this.viewportAnimToken) return; // 已被外部写入打断
      const t = Math.min(1, (now - startTime) / durationMs);
      // easeInOutCubic
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.setViewport(
        {
          x: start.x + (targetX - start.x) * ease,
          y: start.y + (targetY - start.y) * ease,
          k: start.k + (targetK - start.k) * ease,
        },
        { fromAnimation: true },
      );
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  };

  /** 平滑聚焦到指定 bounds(多选联合边界/组节点等):与 focusOnNode 共用同一几何公式
   *  算法与参数语义见 focus-geometry.ts computeFocusTarget,禁止在调用方复制 targetK 计算
   *  @param capsuleHeight 胶囊菜单高度(px),有胶囊菜单时传入以确保缩放包含菜单区域
   *  @param paddingRatio 聚焦缩放系数(0~1),越小节点周边留白越大(默认 0.82)
   */
  focusOnBounds = (
    bounds: FocusBounds,
    containerSize: { width: number; height: number },
    durationMs = 400,
    capsuleHeight = 0,
    paddingRatio = 0.82,
  ): void => {
    const target = computeFocusTarget(bounds, containerSize, capsuleHeight, paddingRatio);
    this.animateViewport(target.x, target.y, target.k, durationMs);
  };

  /** 平滑聚焦到指定节点:自动计算最佳缩放,使节点完整显示在视口内
   *  算法: 1) 节点中心对齐屏幕中心; 2) 缩放至节点+胶囊菜单完整可见的最大尺寸(保留 5% 边距)
   *  优先使用节点当前实际尺寸(node.size),传入的 nodeWidth/nodeHeight 仅作为降级回退。
   *  @param capsuleHeight 胶囊菜单高度(px),有胶囊菜单时传入以确保缩放包含菜单区域
   *  @param paddingRatio 聚焦缩放系数(0~1),越小节点周边留白越大(默认 0.82);
   *         例:堆叠模式传 0.8 得到比基准更小的缩放、节点外边空间更大
   *  注: 胶囊菜单在节点上方,中心点使用节点实际中心(不偏移),缩放范围包含胶囊菜单区域
   */
  focusOnNode = (
    nodeId: string,
    containerSize: { width: number; height: number },
    nodeWidth?: number,
    nodeHeight?: number,
    durationMs = 400,
    capsuleHeight = 0,
    paddingRatio = 0.82,
  ): void => {
    const node = this.getNode(nodeId);
    if (!node) return;
    // 优先使用节点当前实际尺寸,传入参数仅作为降级回退
    const nodeW = node.size?.width ?? nodeWidth ?? 200;
    const nodeH = node.size?.height ?? nodeHeight ?? 100;
    this.focusOnBounds(
      { x: node.position?.x ?? 0, y: node.position?.y ?? 0, width: nodeW, height: nodeH },
      containerSize,
      durationMs,
      capsuleHeight,
      paddingRatio,
    );
  };

  // ===== Selection =====
  getSelection = (): SelectionState => this.selection;
  subscribeSelection = (listener: () => void): (() => void) => {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  };
  setSelection = (selection: SelectionState): void => {
    this.selection = selection;
    this.selectionListeners.forEach((l) => l());
    this.eventBus.emit('selection:changed', {
      nodeIds: [...selection.selectedNodeIds],
      edgeIds: [...selection.selectedEdgeIds],
    });
  };
  selectNodes = (nodeIds: string[], additive = false): void => {
    const next = additive
      ? new Set([...this.selection.selectedNodeIds, ...nodeIds])
      : new Set(nodeIds);
    this.setSelection({ selectedNodeIds: next, selectedEdgeIds: new Set() });
  };
  clearSelection = (): void => {
    this.setSelection({ selectedNodeIds: new Set(), selectedEdgeIds: new Set() });
  };

  // ===== 便捷查询 =====
  /** 节点索引（graph 变更时重建，引用变化可作为 useMemo 依赖） */
  getNodesById = (): Map<string, NodeRecord> => this.nodesById;
  getNode = (id: string): NodeRecord | undefined => this.nodesById.get(id);
  getEdge = (id: string): EdgeRecord | undefined =>
    this.graph.edges.find((e) => e.id === id);
  isNodeSelected = (id: string): boolean => this.selection.selectedNodeIds.has(id);

  // ===== P1-5: 网格空间索引 =====
  /** 获取空间索引(用于 culling/命中/框选查询) */
  getSpatialIndex = (): GridSpatialIndex => this.spatialIndex;
  /** 设置节点尺寸解析器(由 app 在注入 NodeTypeExtension 后调用) */
  setNodeSizeResolver = (resolver: NodeSizeResolver | null): void => {
    this.nodeSizeResolver = resolver;
    this.rebuildSpatialIndex();
  };
  /** 重建空间索引(在 graph 变更后自动调用) */
  private rebuildSpatialIndex(): void {
    this.spatialIndex.rebuild(this.graph.nodes, this.nodeSizeResolver ?? undefined);
  }

  // ===== 便捷命令快捷方式 =====
  /** 更新节点 data(通过 CommandQueue,支持撤销) */
  updateNodeData = (nodeId: string, patch: Record<string, unknown>): void => {
    this.commandQueue.execute(new UpdateNodeDataCommand(nodeId, patch));
  };

  /** 重命名节点(同时更新 node.title 和 node.data.title,支持撤销) */
  renameNode = (nodeId: string, title: string): void => {
    this.commandQueue.execute(new UpdateNodeTitleCommand(nodeId, title));
  };
}

// ===== React Hooks =====

/** 画布 store 的 React Context(CANVAS_VIEW 内自动注入,节点视图可消费以订阅视口) */
export const ReactGraphStoreContext = createContext<ReactGraphStore | null>(null);

/** 在 CanvasView 子树内获取 store,否则抛错 */
export function useReactGraphStore(): ReactGraphStore {
  const store = useContext(ReactGraphStoreContext);
  if (!store) {
    throw new Error('useReactGraphStore must be used within <CanvasView store={...}>');
  }
  return store;
}

export function useGraph(store: ReactGraphStore): GraphModel {
  return useSyncExternalStore(store.subscribeGraph, store.getGraph);
}

export function useViewport(store: ReactGraphStore): Viewport {
  return useSyncExternalStore(store.subscribeViewport, store.getViewport);
}

export function useSelection(store: ReactGraphStore): SelectionState {
  return useSyncExternalStore(store.subscribeSelection, store.getSelection);
}

/** P1-1: per-node 订阅 hook — 仅当该节点数据变化时触发重渲染 */
export function useNodeById(store: ReactGraphStore, nodeId: string): NodeRecord | undefined {
  return useSyncExternalStore(
    (cb) => store.subscribeNode(nodeId, cb),
    () => store.getNode(nodeId),
    () => store.getNode(nodeId),
  );
}

/** 旧版 useNode — 向后兼容，内部使用全量 graph 订阅 */
export function useNode(store: ReactGraphStore, nodeId: string): NodeRecord | undefined {
  const graph = useGraph(store);
  return store.getNode(nodeId) ?? graph.nodes.find((n) => n.id === nodeId);
}
