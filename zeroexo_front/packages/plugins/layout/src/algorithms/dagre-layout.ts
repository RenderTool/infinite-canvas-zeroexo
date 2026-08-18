/**
 * 自包含 dagre 风格分层布局算法 (Sugiyama 框架):
 * 1. 层级分配 — 最长路径拓扑排序
 * 2. 层内排序 — Barycenter 启发式减少交叉边
 * 3. 坐标计算 — 层级左→右, 同层节点垂直堆叠, 层内居中
 */

import type { LayoutNode, PositionResult } from '../types.js';
import { ARRANGE_GAP } from '../types.js';

export function arrangeDagre(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  // 构建邻接表
  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();
  for (const id of nodeIds) {
    inEdges.set(id, []);
    outEdges.set(id, []);
  }
  for (const e of filteredEdges) {
    outEdges.get(e.source)!.push(e.target);
    inEdges.get(e.target)!.push(e.source);
  }

  // --- 层级分配: 最长路径 ---
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    inDegree.set(id, inEdges.get(id)!.length);
  }

  const layers = new Map<string, number>();
  for (const id of nodeIds) layers.set(id, 0);

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  // 有环: 选入度最小的节点
  if (queue.length === 0) {
    let minDeg = Infinity;
    let minId = '';
    for (const [id, deg] of inDegree) {
      if (deg < minDeg) { minDeg = deg; minId = id; }
    }
    if (minId) queue.push(minId);
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const child of outEdges.get(id)!) {
      const newLayer = layers.get(id)! + 1;
      if (newLayer > layers.get(child)!) layers.set(child, newLayer);
      inDegree.set(child, inDegree.get(child)! - 1);
      if (inDegree.get(child)! <= 0) queue.push(child);
    }
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) layers.set(id, 0);
  }

  // 按层级分组
  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(id);
  }
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);

  // --- 层内排序: Barycenter 启发式 ---
  for (let iter = 0; iter < 10; iter++) {
    // 向上传递:按父节点位置排序
    for (const layer of sortedLayers) {
      const ids = layerGroups.get(layer)!;
      const barycenters = new Map<string, number>();
      for (const id of ids) {
        const parents = inEdges.get(id) ?? [];
        if (parents.length > 0) {
          // 计算有效父节点索引的平均值(排除不在层内的父节点)
          const indices: number[] = [];
          for (const p of parents) {
            const pl = layers.get(p)!;
            const idx = (layerGroups.get(pl) ?? []).indexOf(p);
            if (idx >= 0) indices.push(idx);
          }
          if (indices.length > 0) {
            barycenters.set(
              id,
              indices.reduce((sum, v) => sum + v, 0) / indices.length,
            );
          } else {
            barycenters.set(id, -1);
          }
        } else {
          barycenters.set(id, -1);
        }
      }
      // 升序排列:小 barycenter(靠左)的节点排在前面
      ids.sort((a, b) => (barycenters.get(a) ?? -1) - (barycenters.get(b) ?? -1));
    }

    // 向下传递:按子节点位置排序
    for (let i = sortedLayers.length - 1; i >= 0; i--) {
      const layer = sortedLayers[i]!;
      const ids = layerGroups.get(layer)!;
      const barycenters = new Map<string, number>();
      for (const id of ids) {
        const children = outEdges.get(id) ?? [];
        if (children.length > 0) {
          const indices: number[] = [];
          for (const c of children) {
            const cl = layers.get(c)!;
            const idx = (layerGroups.get(cl) ?? []).indexOf(c);
            if (idx >= 0) indices.push(idx);
          }
          if (indices.length > 0) {
            barycenters.set(
              id,
              indices.reduce((sum, v) => sum + v, 0) / indices.length,
            );
          } else {
            barycenters.set(id, -1);
          }
        } else {
          barycenters.set(id, -1);
        }
      }
      ids.sort((a, b) => (barycenters.get(a) ?? -1) - (barycenters.get(b) ?? -1));
    }
  }

  // --- 坐标计算: 水平树状 (左→右) ---
  const layerGap = 100;
  const nodeGap = 20;
  const padding = ARRANGE_GAP;

  // 计算每层最大宽度
  const layerMaxWidth = new Map<number, number>();
  for (const [layer, ids] of layerGroups) {
    layerMaxWidth.set(layer, Math.max(...ids.map((id) => nodeMap.get(id)?.width ?? 200), 200));
  }

  // 每层总高度
  const layerHeights = new Map<number, number>();
  for (const [layer, ids] of layerGroups) {
    const total = ids.reduce((sum, id) => sum + (nodeMap.get(id)?.height ?? 80) + nodeGap, 0) - nodeGap;
    layerHeights.set(layer, Math.max(total, 0));
  }
  const maxLayerHeight = Math.max(...layerHeights.values(), 0);

  // 计算每层 X 起始位置
  const layerX = new Map<number, number>();
  let cursorX = padding;
  for (const layer of sortedLayers) {
    layerX.set(layer, cursorX);
    cursorX += (layerMaxWidth.get(layer) ?? 200) + layerGap;
  }

  for (const layer of sortedLayers) {
    const ids = layerGroups.get(layer)!;
    const lh = layerHeights.get(layer)!;
    const startY = padding + (maxLayerHeight - lh) / 2;
    const layerStartX = layerX.get(layer)!;
    const lw = layerMaxWidth.get(layer) ?? 200;

    let cursorY = startY;
    for (const id of ids) {
      const node = nodeMap.get(id)!;
      const x = layerStartX + (lw - node.width) / 2;
      result.set(id, { x: Math.round(x), y: Math.round(cursorY) });
      cursorY += node.height + nodeGap;
    }
  }

  // 离散节点: 流式排列到下方
  const connectedSet = new Set<string>();
  for (const e of filteredEdges) {
    connectedSet.add(e.source);
    connectedSet.add(e.target);
  }
  const discreteIds = nodes.filter((n) => !connectedSet.has(n.id)).map((n) => n.id);

  if (discreteIds.length > 0) {
    let maxY = padding;
    for (const [id, pos] of result) {
      const node = nodeMap.get(id);
      if (node) maxY = Math.max(maxY, pos.y + node.height);
    }

    const dCols = Math.max(1, Math.ceil(Math.sqrt(discreteIds.length)));
    const gap = 24;
    let cursorY = maxY + gap * 2;
    for (let i = 0; i < discreteIds.length; i += dCols) {
      const row = discreteIds.slice(i, i + dCols);
      const rowH = Math.max(...row.map((id) => nodeMap.get(id)?.height ?? 80));
      let cx = padding;
      for (const id of row) {
        const n = nodeMap.get(id)!;
        result.set(id, { x: Math.round(cx), y: Math.round(cursorY) });
        cx += n.width + gap;
      }
      cursorY += rowH + gap;
    }
  }

  return result;
}
