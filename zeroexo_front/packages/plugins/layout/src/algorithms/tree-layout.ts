/**
 * 层级树状布局 (组织图/思维导图风格):
 * 1. 左→右水平布局,层级从左到右排列
 * 2. 同层节点垂直堆叠,间距固定
 * 3. 根节点垂直居中于其子节点范围
 * 4. 层间距基于该层实际节点宽度,保证连线不重叠
 * 5. 游离节点排到树下方
 * 6. 多棵树垂直分隔
 */

import type { LayoutNode, PositionResult } from '../types.js';
import { ARRANGE_GAP } from '../types.js';

export function tidyTreeLayout(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const padding = ARRANGE_GAP;

  // 构建邻接表
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string | null>();
  for (const id of nodeIds) {
    childrenMap.set(id, []);
    parentMap.set(id, null);
  }
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      childrenMap.get(e.source)!.push(e.target);
      parentMap.set(e.target, e.source);
    }
  }

  // 找根节点 (有孩子无父亲) 和游离节点 (无连接)
  const roots: string[] = [];
  const discrete: string[] = [];
  for (const id of nodeIds) {
    if (parentMap.get(id) === null) {
      if (childrenMap.get(id)!.length > 0) {
        roots.push(id);
      } else {
        discrete.push(id);
      }
    }
  }

  const VERTICAL_GAP = ARRANGE_GAP;
  const LAYER_GAP = 300; // 层间水平间距

  // DFS 计算层级深度(带环检测)
  const layerDepth = new Map<string, number>();
  const visiting = new Set<string>();
  const dfsDepth = (id: string, depth: number): void => {
    if (visiting.has(id)) return; // 环检测:跳过已在访问路径上的节点
    visiting.add(id);
    layerDepth.set(id, depth);
    for (const child of childrenMap.get(id) ?? []) {
      dfsDepth(child, depth + 1);
    }
    visiting.delete(id);
  };
  for (const root of roots) {
    dfsDepth(root, 0);
  }

  // 处理无根基的节点(如环中节点或孤立节点):作为离散节点处理
  for (const id of nodeIds) {
    if (!layerDepth.has(id)) {
      discrete.push(id);
    }
  }

  // 按层级分组
  const layerGroups = new Map<number, string[]>();
  for (const [id, depth] of layerDepth) {
    if (!layerGroups.has(depth)) layerGroups.set(depth, []);
    layerGroups.get(depth)!.push(id);
  }
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);

  // 计算每层最大宽度
  const maxLayerWidth = new Map<number, number>();
  for (const [depth, ids] of layerGroups) {
    maxLayerWidth.set(depth, Math.max(...ids.map((id) => nodeMap.get(id)?.width ?? 200)));
  }

  // 计算每层 X 位置
  const layerX = new Map<number, number>();
  let cursorX = padding;
  for (const depth of sortedLayers) {
    layerX.set(depth, cursorX);
    cursorX += (maxLayerWidth.get(depth) ?? 200) + LAYER_GAP;
  }

  // 放置节点: 同层垂直堆叠, 左对齐
  for (const [depth, ids] of layerGroups) {
    const x = layerX.get(depth)!;
    let cursorY = padding;
    for (const id of ids) {
      const node = nodeMap.get(id)!;
      result.set(id, { x: Math.round(x), y: Math.round(cursorY) });
      cursorY += node.height + VERTICAL_GAP;
    }
  }

  // 所有父节点垂直居中于子节点(自底向上,从最深层到最顶层)
  const allDepths = [...layerDepth.values()];
  const maxDepth = allDepths.length > 0 ? Math.max(...allDepths) : 0;
  for (let d = maxDepth; d >= 0; d--) {
    const ids = layerGroups.get(d) ?? [];
    for (const id of ids) {
      const children = childrenMap.get(id) ?? [];
      if (children.length === 0) continue;
      const firstPos = result.get(children[0]!);
      const lastPos = result.get(children[children.length - 1]!);
      if (!firstPos || !lastPos) continue;
      const lastNode = nodeMap.get(children[children.length - 1]!)!;
      const childrenCenter = (firstPos.y + lastPos.y + lastNode.height) / 2;
      const node = nodeMap.get(id)!;
      const current = result.get(id)!;
      result.set(id, {
        x: Math.round(current.x),
        y: Math.round(childrenCenter - node.height / 2),
      });
    }
  }

  // 多棵树: 垂直分隔
  if (roots.length > 1) {
    const treeRanges = roots.map((root) => {
      const subtreeNodes = getSubtreeNodes(root, childrenMap);
      let minY = Infinity;
      let maxY = -Infinity;
      for (const nid of subtreeNodes) {
        const pos = result.get(nid);
        const node = nodeMap.get(nid);
        if (pos && node) {
          minY = Math.min(minY, pos.y);
          maxY = Math.max(maxY, pos.y + node.height);
        }
      }
      return { root, minY: minY === Infinity ? 0 : minY, maxY: maxY === -Infinity ? 0 : maxY };
    });

    treeRanges.sort((a, b) => a.minY - b.minY);
    let offsetY = padding;
    for (const range of treeRanges) {
      const shift = offsetY - range.minY;
      if (shift !== 0) {
        const subtreeNodes = getSubtreeNodes(range.root, childrenMap);
        for (const nid of subtreeNodes) {
          const pos = result.get(nid);
          if (pos) {
            result.set(nid, { x: pos.x, y: Math.round(pos.y + shift) });
          }
        }
      }
      offsetY += (range.maxY - range.minY) + VERTICAL_GAP * 4;
    }
  }

  // 游离节点: 排到树下方, 流式排列
  if (discrete.length > 0) {
    let treeBottom = padding;
    for (const [id, pos] of result) {
      const node = nodeMap.get(id);
      if (node) treeBottom = Math.max(treeBottom, pos.y + node.height);
    }

    const discreteCols = Math.max(1, Math.ceil(Math.sqrt(discrete.length)));
    let cursorY = treeBottom + VERTICAL_GAP * 3;
    for (let i = 0; i < discrete.length; i += discreteCols) {
      const row = discrete.slice(i, i + discreteCols);
      const rowH = Math.max(...row.map((id) => nodeMap.get(id)?.height ?? 80));
      let cx = padding;
      for (const id of row) {
        const n = nodeMap.get(id)!;
        result.set(id, { x: Math.round(cx), y: Math.round(cursorY) });
        cx += n.width + VERTICAL_GAP;
      }
      cursorY += rowH + VERTICAL_GAP;
    }
  }

  return result;
}

/** 获取子树所有节点 ID(带环检测) */
function getSubtreeNodes(id: string, childrenMap: Map<string, string[]>): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const walk = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    result.push(nodeId);
    for (const child of childrenMap.get(nodeId) ?? []) {
      walk(child);
    }
  };
  walk(id);
  return result;
}
