/**
 * 画布布局相关逻辑 - 排列/对齐/分布/统一尺寸/自动布局
 */
import type { NodeRecord, NodeTypeExtension, Command } from '@zeroexo/core';
import { MoveNodeCommand, ResizeNodeCommand, BatchCommand } from '@zeroexo/core';
import { MoveGroupCommand, getChildren, getGroupBoundsWithEmptyFallback } from '@zeroexo/plugin-group';
import { arrangeNodes, alignNodes, distributeNodes, unifyNodeSizes } from '@zeroexo/plugin-layout';
import type { ArrangeMode, AlignMode, DistributeMode, UnifySizeMode, LayoutNode } from '@zeroexo/plugin-layout';

export interface LayoutContext {
  store: any;
  layoutController: any;
  groupPlugin: any;
  commandQueue: any;
  extensions: Map<string, NodeTypeExtension>;
  getNodeSize: (node: NodeRecord) => { width: number; height: number };
}

/** 获取节点尺寸（含 defaultSize 回退） */
export function resolveNodeSize(node: NodeRecord, extensions: Map<string, NodeTypeExtension>): { width: number; height: number } {
  return node.size ?? extensions.get(node.type)?.defaultSize ?? { width: 200, height: 80 };
}

/** 智能布局:新节点生成后自动布局 + 聚焦
 *
 * 直接使用节点当前尺寸参与排列计算（紧凑尺寸即紧凑排列，不临时切换默认尺寸）。
 * 节点视觉上以紧凑尺寸参与布局，缩放动画由 CSS transform scale 以 GPU 加速方式完成。
 * 生成完成后，ResizeNodeCommand 会将节点尺寸设为默认值，
 * 此时再次调用此函数即可用默认尺寸重新排列，对应节点也通过 transform scale(1,1) 展开。
 */
export function triggerAutoLayoutAndFocus(newIds: string[], ctx: LayoutContext, containerSize: { width: number; height: number }): void {
  const { store, layoutController, getNodeSize, extensions } = ctx;
  if (!store || !layoutController) return;
  const graph = store.getGraph();

  // 1. 选中新节点
  store.setSelection({ selectedNodeIds: new Set(newIds), selectedEdgeIds: new Set() });

  // 2. 智能布局（使用节点当前实际尺寸排列）
  const firstNode = store.getNode(newIds[0] ?? '');
  const isStoryboard = firstNode?.type === 'storyboard';

  if (isStoryboard) {
    const parentEdge = graph.edges.find((e: any) => {
      const tgt = typeof e.target === 'object' ? e.target : { nodeId: e.target, pinId: '' };
      return tgt.nodeId === newIds[0] && tgt.pinId === 'input';
    });
    const parentId = parentEdge
      ? (typeof parentEdge.source === 'object' ? parentEdge.source.nodeId : parentEdge.source)
      : null;

    if (parentId) {
      const subtreeIds = new Set<string>([parentId]);
      graph.edges.forEach((e: any) => {
        const src = typeof e.source === 'object' ? e.source.nodeId : e.source;
        const tgt = typeof e.target === 'object' ? e.target.nodeId : e.target;
        if (src === parentId) subtreeIds.add(tgt);
        else if (tgt === parentId) subtreeIds.add(src);
      });
      if (subtreeIds.size >= 2) {
        layoutController.arrangeSelection([...subtreeIds], 'tree');
      }
    } else {
      layoutConnectedIds(newIds, graph, layoutController);
    }
  } else {
    layoutConnectedIds(newIds, graph, layoutController);
  }

  // 3. 延迟一帧后聚焦(使用节点当前实际尺寸,避免用户修改尺寸后仍以基准缩放)
  //    胶囊菜单高度 34px + 间隙 17px = 51px,计入总高度使缩放更准确
  requestAnimationFrame(() => {
    if (!store.focusOnNode) return;
    const targetId = newIds[0];
    if (!targetId) return;
    const node = store.getNode(targetId);
    if (!node) return;
    const actualSize = node.size ?? extensions.get(node.type)?.defaultSize ?? getNodeSize(node);
    const capsuleTotalHeight = 34 + 17; // CAPSULE_TOOLBAR_SCREEN_HEIGHT + CAPSULE_TOOLBAR_GAP
    store.focusOnNode(targetId, containerSize, actualSize.width, actualSize.height, 400, capsuleTotalHeight);
  });
}

/** 对新节点 + 直接邻居执行 auto 布局 */
function layoutConnectedIds(newIds: string[], graph: any, layoutController: any): void {
  const connectedIds = new Set(newIds);
  for (const nid of newIds) {
    graph.edges.forEach((e: any) => {
      const src = typeof e.source === 'object' ? e.source.nodeId : e.source;
      const tgt = typeof e.target === 'object' ? e.target.nodeId : e.target;
      if (src === nid || tgt === nid) {
        connectedIds.add(src);
        connectedIds.add(tgt);
      }
    });
  }
  if (connectedIds.size >= 2) {
    layoutController.arrangeSelection([...connectedIds], 'auto');
  }
}

/** 组内成员排列/对齐/分布 — 子组视为整体 */
export function applyLayoutToGroupMembers(
  groupId: string,
  op: 'arrange' | 'align' | 'distribute' | 'unify',
  mode: string,
  ctx: LayoutContext,
): void {
  const { groupPlugin, commandQueue, store, extensions, getNodeSize } = ctx;
  if (!groupPlugin || !commandQueue || !store) return;
  const scene = store.getGraph().nodes;
  const children = getChildren(scene, groupId);
  if (children.length < 2) return;

  const layoutNodes: LayoutNode[] = children.map((child: any) => {
    const ext = extensions.get(child.type);
    const base: LayoutNode = {
      id: child.id, type: child.type, defaultSize: ext?.defaultSize,
      lockAspectRatio: ext?.lockAspectRatio, resizable: ext?.resizable,
      x: 0, y: 0, width: 0, height: 0,
    };
    if (child.type === 'group') {
      const b = getGroupBoundsWithEmptyFallback(scene, child.id, getNodeSize);
      return { ...base, x: b?.x ?? child.position.x, y: b?.y ?? child.position.y, width: b?.width ?? 0, height: b?.height ?? 0 };
    }
    const size = child.size ?? ext?.defaultSize ?? { width: 200, height: 80 };
    return { ...base, x: child.position.x, y: child.position.y, width: size.width, height: size.height };
  });

  // 统一尺寸
  if (op === 'unify') {
    const leafChildren = children.filter((c: any) => c.type !== 'group');
    if (leafChildren.length < 2) return;
    const leafLayout = layoutNodes.filter((ln) => leafChildren.some((c: any) => c.id === ln.id));
    const sizes = unifyNodeSizes(leafLayout, mode as UnifySizeMode);
    const cmds = leafChildren
      .filter((c: any) => sizes.has(c.id))
      .map((c: any) => {
        const newSize = sizes.get(c.id)!;
        const oldSize = c.size ?? { width: 200, height: 80 };
        return new ResizeNodeCommand(c.id, { x: c.position.x, y: c.position.y, width: oldSize.width, height: oldSize.height }, { x: newSize.x, y: newSize.y, width: newSize.width, height: newSize.height });
      });
    if (cmds.length > 0) commandQueue.execute(new BatchCommand(cmds, 'group-unify-size'));
    return;
  }

  // 排列/对齐/分布
  let positions: Map<string, { x: number; y: number }>;
  if (op === 'arrange') {
    let edges: { source: string; target: string }[] | undefined;
    if (mode === 'tree' || mode === 'dagre' || mode === 'auto') {
      const graph = store.getGraph();
      const childIdSet = new Set(children.map((c: any) => c.id));
      edges = graph.edges.filter((e: any) => childIdSet.has(e.source.nodeId) && childIdSet.has(e.target.nodeId)).map((e: any) => ({ source: e.source.nodeId, target: e.target.nodeId }));
    }
    positions = arrangeNodes(layoutNodes, mode as ArrangeMode, edges);
  } else if (op === 'align') {
    positions = alignNodes(layoutNodes, mode as AlignMode);
  } else {
    positions = distributeNodes(layoutNodes, mode as DistributeMode);
  }
  if (positions.size === 0) return;

  const cmds: Command[] = [];
  for (const child of children) {
    const newPos = positions.get(child.id);
    if (!newPos) continue;
    if (child.type === 'group') {
      const b = getGroupBoundsWithEmptyFallback(scene, child.id, getNodeSize);
      if (!b) continue;
      const dx = newPos.x - b.x; const dy = newPos.y - b.y;
      if (dx === 0 && dy === 0) continue;
      cmds.push(new MoveGroupCommand(child.id, dx, dy));
    } else {
      const delta = { x: newPos.x - child.position.x, y: newPos.y - child.position.y };
      if (delta.x === 0 && delta.y === 0) continue;
      cmds.push(new MoveNodeCommand(child.id, delta));
    }
  }
  if (cmds.length > 0) commandQueue.execute(new BatchCommand(cmds, `group-${op}`));
}