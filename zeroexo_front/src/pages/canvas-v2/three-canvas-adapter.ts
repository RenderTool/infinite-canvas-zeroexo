/**
 * ThreeCanvasAdapter — store ↔ Three.js 引擎双向同步适配层（Plan#27 T3）
 *
 * 非侵入式核心：不改原画布任何渲染文件，本适配层是「同套接口」的桥梁——
 * - store（ReactGraphStore）→ 引擎：graph diff（节点/边增删改）、viewport、selection、背景/边色
 * - 引擎 → store：点击（selectNodes）、拖动（MoveNodesCommand 松手落盘，一次 undo 恢复起点）、视口（setViewport）
 * - 交互回调：与 CanvasView props 同签名透传宿主（右键/双击由宿主在容器 DOM 监听 + engine.pickAt 判定）
 * - 节点内容 DOM overlay（T6）：适配层暴露 getNodeScreenRect，宿主复用 NodeRenderer 渲染内容并跟随外壳
 *
 * 同步防环约定：
 * - store → 引擎：值比较（相同跳过）
 * - 引擎 → store：拖动中仅记 pending（不写 store），松手统一 MoveNodesCommand；
 *   拖动中的节点在 graph diff 中跳过（引擎位置为准，落盘后 store 追上）
 */
import type { CommandQueue, NodeRecord } from '@zeroexo/core';
import { MoveNodesCommand } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { getGroupBoundsWithEmptyFallback, getDescendantIds } from '@zeroexo/plugin-group';
import type { GroupDefaults } from '@zeroexo/plugin-group';
import { ThreeCanvasV2 } from './three-engine.js';
import type { V2Viewport, GroupStyleOverride } from './three-engine.js';

/** 节点尺寸解析（原画布由 extension/NodeDefaults 提供，宿主注入保证 1:1） */
export interface AdapterNodeResolvers {
  getNodeSize?: (node: NodeRecord) => { width: number; height: number };
  getNodeColor?: (node: NodeRecord) => string | undefined;
}

/** 适配层选项（与 CanvasView 视觉 props 同名对齐） */
export interface ThreeCanvasAdapterOptions {
  store: ReactGraphStore;
  commandQueue: CommandQueue;
  container: HTMLElement;
  // 视觉（CanvasView 同名 props）
  background?: 'dots' | 'lines' | 'none';
  /** 画布背景色（组标题纹理打底，DOM 版 var(--zeroexo-canvas-bg)） */
  backgroundColor?: string;
  gridDotColor?: string;
  gridLineColor?: string;
  gridSize?: number;
  edgeColor?: string;
  edgeSelectedColor?: string;
  /** 悬停边色（DOM 版 EdgeLayer hover 态；引擎目前为双态[非活跃/活跃]，hover 独立色列 T11 缺口） */
  edgeHoverColor?: string;
  /** 组全局默认样式（宿主从 GroupDefaultsProvider 读取注入；adapter 合并组节点字段解析 per-组覆盖） */
  groupDefaults?: GroupDefaults;
  // 节点解析
  resolvers?: AdapterNodeResolvers;
  // 交互回调（与 CanvasView props 同签名转译）
  onNodeClick?: (nodeId: string | null) => void;
  /** 3D 模式切换回调（宿主据此显隐 DOM GroupLayer：2D 组框 DOM 渲染，3D 引擎 SDF） */
  on3DStateChange?: (is3D: boolean) => void;
}

const EPS_VP = { x: 0.01, y: 0.01, k: 0.001 };

export class ThreeCanvasAdapter {
  private engine: ThreeCanvasV2;
  private unsubs: Array<() => void> = [];
  /** 引擎侧节点/边镜像（引擎无枚举 API，diff 用） */
  private mirrorNodes = new Set<string>();
  private mirrorEdges = new Set<string>();
  /** T7: 引擎侧组镜像（diff 删除用） */
  private mirrorGroups = new Set<string>();
  /** T7: 本次拖拽的跟随组偏移表（null = 未在拖拽中；拖拽开始计算一次，期间复用，与 DOM 版 group-layer 同语义） */
  private followGroupOffsets: Map<string, { dx: number; dy: number }> | null = null;
  /** 拖动瞬态：起点（store 落盘前）/终点（松手 MoveNodesCommand） */
  private pendingStarts = new Map<string, { x: number; y: number }>();
  private pendingEnds = new Map<string, { x: number; y: number }>();
  /** T7: 引擎拖动 → store 瞬态偏移镜像（DOM GroupLayer 组框跟随 + 连线瞬态等订阅者复用） */
  private dragOffsetMirror = new Map<string, { dx: number; dy: number }>();

  constructor(private opts: ThreeCanvasAdapterOptions) {
    this.engine = new ThreeCanvasV2(opts.container);
    // T7: 生产路径组框渲染归属 DOM（2D 像素级 1:1 + 全交互复用；引擎仅 3D 渲染组框 SDF）
    this.engine.groupRenderMode = 'dom';
    this.applyVisuals();
    this.syncAll();
    this.unsubs.push(opts.store.subscribeGraph(() => this.syncGraphDiff()));
    this.unsubs.push(opts.store.subscribeViewport(() => this.syncViewportFromStore()));
    this.unsubs.push(opts.store.subscribeSelection(() => this.syncSelectionFromStore()));
    // T7: 拖拽瞬态组跟随（与 DOM 版 group-layer 同语义：仅「组内全部成员被拖」的组整体平移，
    // 平移不变性保证松手命令落盘后无跳变；单通道直写——引擎组框无其他跟随通道，无双重偏移）
    this.unsubs.push(opts.store.subscribeDragOffsets(() => {
      const offsets = opts.store.getDragOffsets();
      if (offsets.size === 0) {
        this.followGroupOffsets = null;
        return;
      }
      if (this.followGroupOffsets === null) {
        this.followGroupOffsets = this.computeFollowGroupOffsets(opts.store.getGraph().nodes, offsets);
      }
      for (const [gid, off] of this.followGroupOffsets) {
        this.engine.setGroupTransform(gid, off.dx, off.dy);
      }
    }));
    this.wireEngine();
    this.syncViewportFromStore();
  }

  getEngine(): ThreeCanvasV2 {
    return this.engine;
  }

  /** T4R: 写节点内容 uv 矩形（内容图集采样；null 清除） */
  setNodeContentRect(id: string, uvRect: [number, number, number, number] | null): void {
    this.engine.setNodeContentRect(id, uvRect);
  }

  /** T4R: 清除节点内容（删除/LOD 降级/编辑态防双标题） */
  clearNodeContentRect(id: string): void {
    this.engine.setNodeContentRect(id, null);
  }

  /** 视口透传（T6 overlay 每帧读取 k 复刻 DOM 缩放链） */
  getViewport(): V2Viewport {
    return this.engine.getViewport();
  }

  /** 节点中心世界坐标 → 屏幕矩形（T6 DOM overlay 定位；2D/3D 统一投影） */
  getNodeScreenRect(id: string): { x: number; y: number; w: number; h: number } | null {
    const n = this.engine.getNode(id);
    if (!n) return null;
    const center = this.engine.nodeScreenPos(id);
    if (!center) return null;
    const k = this.engine.getViewport().k;
    return { x: center.x - (n.data.w * k) / 2, y: center.y - (n.data.h * k) / 2, w: n.data.w * k, h: n.data.h * k };
  }

  /** 视觉 props 更新（宿主 ConfigDialog/主题变化时调用） */
  updateVisuals(patch: Partial<Pick<ThreeCanvasAdapterOptions, 'background' | 'backgroundColor' | 'gridDotColor' | 'gridLineColor' | 'gridSize' | 'edgeColor' | 'edgeSelectedColor' | 'edgeHoverColor'>>): void {
    Object.assign(this.opts, patch);
    this.applyVisuals();
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.engine.dispose();
  }

  // ==================== 视觉 ====================

  private applyVisuals(): void {
    const o = this.opts;
    this.engine.setBackground({
      background: o.background,
      grid_dot_color: o.gridDotColor,
      grid_line_color: o.gridLineColor,
      grid_size: o.gridSize,
    });
    // 边色（CanvasView edgeColor/edgeSelectedColor → EdgeStyleParams；hover 复用活跃色，引擎双态）
    this.engine.setEdgeStyle({
      color: o.edgeColor ?? '#ffffff',
      activeColor: o.edgeSelectedColor ?? '#e94560',
    });
    // T7: 组标题纹理打底色 = 画布背景色（DOM 版 var(--zeroexo-canvas-bg)）
    this.engine.setGroupTitleBackground(o.backgroundColor ?? '#1a1a2e');
  }

  // ==================== store → 引擎 ====================

  private syncAll(): void {
    const graph = this.opts.store.getGraph();
    for (const n of graph.nodes) this.upsertNode(n);
    for (const e of graph.edges) this.upsertEdge(e);
    this.syncGroups();
  }

  private syncGraphDiff(): void {
    const graph = this.opts.store.getGraph();
    // 删除：引擎有而 store 无
    for (const id of this.mirrorNodes) {
      if (!this.opts.store.getNode(id)) {
        this.engine.removeNode(id);
        this.mirrorNodes.delete(id);
      }
    }
    for (const id of this.mirrorEdges) {
      if (!this.opts.store.getEdge(id)) {
        this.engine.removeEdge(id);
        this.mirrorEdges.delete(id);
      }
    }
    // 新增/更新（拖动中的节点跳过：引擎位置为准，松手落盘后 store 追上）
    for (const n of graph.nodes) {
      if (this.pendingEnds.has(n.id)) continue;
      this.upsertNode(n);
    }
    for (const e of graph.edges) this.upsertEdge(e);
    this.syncGroups();
  }

  /**
   * T7: 组框同步——bounds 用 group 插件 getGroupBoundsWithEmptyFallback（与 DOM 版 GroupLayer 同源函数，
   * 递归子组/比例 padding/28px 标题安全区/取整/空组回退全部继承）；per-组样式 = 节点字段 ?? GroupDefaults。
   */
  private syncGroups(): void {
    const graph = this.opts.store.getGraph();
    const seen = new Set<string>();
    for (const g of graph.nodes) {
      if (g.type !== 'group') continue;
      seen.add(g.id);
      const bounds = getGroupBoundsWithEmptyFallback(graph.nodes, g.id, this.opts.resolvers?.getNodeSize);
      if (bounds) {
        this.engine.setGroupBounds(
          g.id,
          { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
          g.title ?? g.id,
        );
        const patch = this.resolveGroupStyle(g);
        this.engine.setGroupStyleOverride(g.id, patch);
        this.mirrorGroups.add(g.id);
      }
    }
    // 删除：引擎有而 store 无
    for (const gid of this.mirrorGroups) {
      if (!seen.has(gid)) {
        this.engine.removeGroup(gid);
        this.mirrorGroups.delete(gid);
      }
    }
  }

  /** T7: 组节点字段 + GroupDefaults → per-组覆盖（与 DOM 版 GroupItem 三层模型一致；undefined 字段省略=回退引擎共享默认） */
  private resolveGroupStyle(g: NodeRecord): GroupStyleOverride | null {
    const d = this.opts.groupDefaults;
    const patch: GroupStyleOverride = {};
    const bg = g.backgroundColor ?? d?.backgroundColor;
    if (bg) patch.backgroundColor = bg;
    const r = g.borderRadius ?? d?.borderRadius;
    if (r !== undefined) patch.borderRadius = r;
    const oc = g.outlineColor ?? d?.outlineColor;
    if (oc) patch.outlineColor = oc;
    const ow = g.outlineWidth ?? d?.outlineWidth;
    if (ow !== undefined) patch.outlineWidth = ow;
    // outlineType 仅全局默认（DOM 版 group-layer 也只传 defaults.outlineType，节点级无此字段）
    const ot = d?.outlineType;
    if (ot) patch.outlineType = ot;
    const oo = g.outlineOffset ?? d?.outlineOffset;
    if (oo !== undefined) patch.outlineOffset = oo;
    const op = g.opacity ?? d?.opacity;
    if (op !== undefined) patch.opacity = op;
    const tc = d?.titleColor;
    if (tc) patch.titleColor = tc;
    return Object.keys(patch).length > 0 ? patch : null;
  }

  /**
   * T7: 计算本次拖拽需要瞬态跟随的组 → 偏移表（复刻 DOM 版 group-layer computeFollowGroupOffsets：
   * 仅「组内全部非组成员都在拖拽集」时组框整体平移，部分成员被拖时组框保持原位，松手后重算）
   */
  private computeFollowGroupOffsets(
    scene: NodeRecord[],
    offsets: ReadonlyMap<string, { dx: number; dy: number }>,
  ): Map<string, { dx: number; dy: number }> {
    const result = new Map<string, { dx: number; dy: number }>();
    const byId = new Map(scene.map((n) => [n.id, n]));
    const dragged = new Set(offsets.keys());
    // 拖拽集全部节点同源同一偏移（interaction 写入同一 worldDx/worldDy），取任意一个即可
    const anyOff = offsets.values().next().value;
    if (!anyOff) return result;
    for (const nodeId of dragged) {
      let cur = byId.get(nodeId);
      while (cur?.parentId) {
        const parent = byId.get(cur.parentId);
        if (!parent) break;
        if (parent.type === 'group' && !result.has(parent.id)) {
          const members = getDescendantIds(scene, parent.id)
            .filter((id) => (byId.get(id)?.type ?? 'group') !== 'group');
          if (members.length > 0 && members.every((mid) => dragged.has(mid))) {
            result.set(parent.id, anyOff);
          }
        }
        cur = parent;
      }
    }
    return result;
  }

  private upsertNode(n: NodeRecord): void {
    if (n.type === 'group') return; // 组框由引擎从子节点 groupId 聚合（T7 再映射组节点自身）
    const size = this.opts.resolvers?.getNodeSize?.(n) ?? n.size ?? { width: 200, height: 100 };
    const color = this.opts.resolvers?.getNodeColor?.(n) ?? n.nodeColor ?? n.backgroundColor ?? '#2b2b33';
    const groupId = n.parentId ?? null;
    const label = n.title ?? n.id;
    if (!this.mirrorNodes.has(n.id)) {
      this.engine.addNode({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        w: size.width,
        h: size.height,
        color,
        groupId,
        label,
      });
      this.mirrorNodes.add(n.id);
    } else {
      this.engine.updateNode(n.id, {
        x: n.position.x,
        y: n.position.y,
        w: size.width,
        h: size.height,
        color,
        label,
        groupId,
      });
    }
  }

  private upsertEdge(e: { id: string; source: { nodeId: string }; target: { nodeId: string } }): void {
    if (this.mirrorEdges.has(e.id)) return;
    this.engine.addEdge(e.source.nodeId, e.target.nodeId, { id: e.id });
    this.mirrorEdges.add(e.id);
  }

  private syncViewportFromStore(): void {
    const vp = this.opts.store.getViewport();
    const cur = this.engine.getViewport();
    if (Math.abs(cur.x - vp.x) < EPS_VP.x && Math.abs(cur.y - vp.y) < EPS_VP.y && Math.abs(cur.k - vp.k) < EPS_VP.k) return;
    this.engine.setViewport({ x: vp.x, y: vp.y, k: vp.k });
  }

  private syncSelectionFromStore(): void {
    const sel = this.opts.store.getSelection();
    const first = sel.selectedNodeIds.values().next().value ?? null;
    const cur = this.engine.selected?.id ?? null;
    if (first !== cur) this.engine.select(first);
  }

  // ==================== 引擎 → store / 宿主 ====================

  private wireEngine(): void {
    const { store, commandQueue, onNodeClick } = this.opts;
    this.engine.on3DStateChange = (is3D) => this.opts.on3DStateChange?.(is3D);
    this.engine.onNodeClick = (id) => {
      store.selectNodes(id ? [id] : []);
      onNodeClick?.(id);
    };
    // T7: 组框点击选中（DOM 版 GroupLayer onGroupPointerDown → controller 选中整组）
    this.engine.onGroupClick = (gid) => {
      store.selectNodes(gid ? [gid] : []);
    };
    this.engine.onViewportChange = (vp: V2Viewport) => {
      const cur = store.getViewport();
      if (Math.abs(cur.x - vp.x) < EPS_VP.x && Math.abs(cur.y - vp.y) < EPS_VP.y && Math.abs(cur.k - vp.k) < EPS_VP.k) return;
      store.setViewport({ x: vp.x, y: vp.y, k: vp.k });
    };
    this.engine.onNodeMove = (id, x, y) => {
      // 拖动中瞬态记录（不写 store，避免命令风暴；松手统一落盘）
      this.pendingEnds.set(id, { x, y });
      if (!this.pendingStarts.has(id)) {
        const rec = store.getNode(id);
        this.pendingStarts.set(id, rec ? { x: rec.position.x, y: rec.position.y } : { x, y });
      }
      // T7: 镜像到 store 拖动瞬态（DOM GroupLayer 组框跟随 / 连线瞬态等订阅者；rAF 合帧发布）
      const start = this.pendingStarts.get(id);
      if (start) {
        this.dragOffsetMirror.set(id, { dx: x - start.x, dy: y - start.y });
        store.setDragOffsets(new Map(this.dragOffsetMirror));
      }
    };
    this.engine.onNodeDragEnd = (ids) => {
      const ends = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const end = this.pendingEnds.get(id);
        if (end) ends.set(id, end);
      }
      if (ends.size > 0) {
        commandQueue.execute(new MoveNodesCommand(this.pendingStarts, ends));
      }
      this.pendingStarts.clear();
      this.pendingEnds.clear();
      // T7: 清空瞬态（DOM GroupLayer 收到空偏移表后结束跟随，等待 store 落盘重算 bounds）
      this.dragOffsetMirror.clear();
      store.setDragOffsets(new Map());
    };
  }
}
