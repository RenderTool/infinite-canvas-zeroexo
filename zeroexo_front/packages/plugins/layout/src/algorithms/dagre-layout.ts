/**
 * dagre 分层布局 — 使用真实 dagre 库 (v0.8.5)
 *
 * 基于 Sugiyama 框架: 层级分配 → 交叉边最小化 → 坐标计算。
 * 支持 rankdir (TB/BT/LR/RL), 自动处理环、多连通分量、游离节点。
 */

import dagre from 'dagre';
import type { LayoutNode, PositionResult } from '../types.js';
import { ARRANGE_GAP } from '../types.js';
import { maxRectsPacking } from './packing.js';

export function arrangeDagre(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  rankdir: 'TB' | 'BT' | 'LR' | 'RL' = 'TB',
): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 过滤出两端都在选中节点内的边
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  // 构建连通分量 — 找出有边连接的节点
  const connectedIds = new Set<string>();
  for (const e of filteredEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }

  // 游离节点: 没有边连接的节点, 用 compact 打包
  const discreteIds = nodes.filter((n) => !connectedIds.has(n.id)).map((n) => n.id);

  // 如果有连通节点, 用 dagre 布局
  if (connectedIds.size > 0) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir,
      nodesep: ARRANGE_GAP,
      ranksep: 80,
      edgesep: ARRANGE_GAP / 2,
      marginx: ARRANGE_GAP,
      marginy: ARRANGE_GAP,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // 添加节点
    for (const id of connectedIds) {
      const node = nodeMap.get(id)!;
      g.setNode(id, { width: node.width, height: node.height });
    }

    // 添加边
    for (const e of filteredEdges) {
      g.setEdge(e.source, e.target);
    }

    // 执行布局
    dagre.layout(g);

    // 提取结果 (dagre 返回的是中心坐标, 转成左上角)
    let minX = Infinity;
    let minY = Infinity;
    for (const id of connectedIds) {
      const dagreNode = g.node(id);
      if (!dagreNode) continue;
      const node = nodeMap.get(id)!;
      const x = Math.round(dagreNode.x - node.width / 2);
      const y = Math.round(dagreNode.y - node.height / 2);
      result.set(id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }

    // 平移使最小坐标 >= 0
    if (minX < 0 || minY < 0) {
      const offsetX = minX < 0 ? -minX + ARRANGE_GAP : 0;
      const offsetY = minY < 0 ? -minY + ARRANGE_GAP : 0;
      for (const [id, pos] of result) {
        result.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
      }
    }
  }

  // 游离节点: 用 compact 打包到连通图下方
  if (discreteIds.length > 0) {
    const discreteNodes = discreteIds.map((id) => nodeMap.get(id)!);
    const discretePositions = maxRectsPacking(discreteNodes, ARRANGE_GAP);

    // 计算连通图底部
    let treeBottom = ARRANGE_GAP;
    for (const [id, pos] of result) {
      const node = nodeMap.get(id);
      if (node) treeBottom = Math.max(treeBottom, pos.y + node.height);
    }

    for (const [id, pos] of discretePositions) {
      result.set(id, { x: pos.x, y: pos.y + treeBottom + ARRANGE_GAP * 2 });
    }
  }

  return result;
}