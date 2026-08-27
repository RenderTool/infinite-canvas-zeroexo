/**
 * Smart Compound Layout — 层级复合布局
 *
 * 三阶段管线:
 *   Phase 1: 分类 — 识别组(GroupUnit)、树/连通分量(TreeUnit)、游离节点(ScatteredUnit)
 *   Phase 2: 内部布局 — 组保持不动、连通分量走树状布局(层级左→右/同层垂直堆叠)、游离节点保持原位
 *   Phase 3: 复合打包 — 将所有单元视为矩形块, 按面积降序单列/单行堆叠(不换行)
 *
 * 适用于「组 + 树 + 散落节点」混合场景, 一个入口解决所有排列需求。
 */

import type { LayoutNode, PositionResult } from '../types.js';
import { ARRANGE_GAP } from '../types.js';
import { tidyTreeLayout } from './tree-layout.js';

// ===== 布局单元类型 =====

interface LayoutUnit {
  id: string;
  type: 'group' | 'tree' | 'scattered';
  /** 单元边界框 (打包时使用) */
  bounds: { width: number; height: number };
  /** 单元内节点 ID 列表 */
  nodeIds: string[];
  /** 单元内节点位置映射 (Phase 2 产出) */
  positions: PositionResult;
}

// ===== Phase 1: 分类 =====

/**
 * 将节点和边分类为组、树、游离节点
 */
function classifyUnits(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  groups: Map<string, string[]>, // groupId -> childIds
): LayoutUnit[] {
  const units: LayoutUnit[] = [];
  const assignedIds = new Set<string>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const nodeIds = new Set(nodes.map((n) => n.id));

  // 1. 处理组 — 组作为原子单元（内部布局保持,子节点在 UI 层跟随组移动）
  for (const [groupId, childIds] of groups) {
    if (!nodeIds.has(groupId)) continue;
    assignedIds.add(groupId);
    // 若组内子节点恰好也在本次传入节点中,一并标记避免重复处理
    for (const cid of childIds) {
      if (nodeIds.has(cid)) assignedIds.add(cid);
    }
    const groupNode = nodeMap.get(groupId);
    if (!groupNode) continue;
    units.push({
      id: groupId,
      type: 'group',
      // 组边界框 = 组节点自身尺寸（渲染时组即块,子节点跟随移动）
      bounds: { width: groupNode.width || 200, height: groupNode.height || 100 },
      nodeIds: [groupId],
      positions: new Map(),
    });
  }

  // 2. 处理连通分量 (树/有向图)
  const remainingIds = nodes
    .filter((n) => !assignedIds.has(n.id))
    .map((n) => n.id);

  // 构建邻接表 (只对剩余节点)
  const adjacency = new Map<string, string[]>();
  for (const id of remainingIds) {
    adjacency.set(id, []);
  }
  for (const e of edges) {
    if (adjacency.has(e.source) && adjacency.has(e.target)) {
      adjacency.get(e.source)!.push(e.target);
      adjacency.get(e.target)!.push(e.source); // 无向图连通分量
    }
  }

  // BFS 找连通分量
  const visited = new Set<string>();
  for (const id of remainingIds) {
    if (visited.has(id)) continue;

    // BFS
    const component: string[] = [];
    const queue = [id];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // 标记已分配
    for (const cid of component) assignedIds.add(cid);

    if (component.length >= 2) {
      // 连通分量 → TreeUnit
      const componentNodes = component
        .map((cid) => nodeMap.get(cid))
        .filter((n): n is LayoutNode => !!n);
      const bounds = computeBoundingBox(componentNodes);
      units.push({
        id: `tree-${component[0]}`,
        type: 'tree',
        bounds,
        nodeIds: component,
        positions: new Map(),
      });
    } else {
      // 单节点 → 游离节点
      units.push({
        id: `scattered-${component[0]}`,
        type: 'scattered',
        bounds: { width: nodeMap.get(component[0]!)?.width ?? 200, height: nodeMap.get(component[0]!)?.height ?? 80 },
        nodeIds: component,
        positions: new Map(),
      });
    }
  }

  return units;
}

// ===== Phase 2: 内部布局 =====

/**
 * 对每个单元执行内部布局
 */
function layoutUnits(
  units: LayoutUnit[],
  nodeMap: Map<string, LayoutNode>,
  edges: { source: string; target: string }[],
): void {
  for (const unit of units) {
    switch (unit.type) {
      case 'group': {
        // 组作为原子单元：位置由 Phase 3 打包决定,组内子节点在 UI 层跟随组移动
        unit.positions.set(unit.id, { x: 0, y: 0 });
        break;
      }
      case 'tree': {
        // 连通分量用树状布局(与原 auto 模式一致:层级左→右,同层垂直堆叠)
        const treeNodes = unit.nodeIds
          .map((id) => nodeMap.get(id))
          .filter((n): n is LayoutNode => !!n);
        if (treeNodes.length > 0) {
          const idSet = new Set(unit.nodeIds);
          const componentEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
          const positions = tidyTreeLayout(treeNodes, componentEdges);
          unit.positions = positions;
          unit.bounds = computeBoundingBoxFromPositions(treeNodes, positions);
        }
        break;
      }
      case 'scattered': {
        // 游离节点: 位置不变
        const node = nodeMap.get(unit.nodeIds[0]!);
        if (node) {
          unit.positions.set(node.id, { x: node.x, y: node.y });
        }
        break;
      }
    }
  }
}

// ===== Phase 3: 复合打包 =====

/**
 * 将单元依次堆叠(垂直方向单列 / 水平方向单行,不换行)。
 * 起点锚定原节点包围盒左上角,保持内容在原区域,与其他排列模式一致。
 */
function compoundPack(
  units: LayoutUnit[],
  direction: 'horizontal' | 'vertical' = 'vertical',
  startX: number,
  startY: number,
  gap: number = ARRANGE_GAP,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();

  // 按面积降序排序(大块优先)
  const sortedUnits = [...units].sort((a, b) => {
    const areaA = a.bounds.width * a.bounds.height;
    const areaB = b.bounds.width * b.bounds.height;
    return areaB - areaA;
  });

  if (direction === 'horizontal') {
    // 水平方向: 从左到右单行排布,不换行,单元顶部对齐
    let cursorX = startX;
    for (const unit of sortedUnits) {
      applyUnitOffset(unit, cursorX, startY, result);
      cursorX += unit.bounds.width + gap * 2;
    }
  } else {
    // 垂直方向: 从上到下单列堆叠,不换列,单元左对齐,单元间加大间距区分语义块
    const UNIT_GAP = gap * 3;
    let cursorY = startY;
    for (const unit of sortedUnits) {
      applyUnitOffset(unit, startX, cursorY, result);
      cursorY += unit.bounds.height + UNIT_GAP;
    }
  }

  return result;
}

/**
 * 将单元偏移应用到其内部节点位置
 */
function applyUnitOffset(
  unit: LayoutUnit,
  offsetX: number,
  offsetY: number,
  result: Map<string, { x: number; y: number }>,
): void {
  // 计算单元当前最小坐标
  let minX = Infinity;
  let minY = Infinity;
  for (const [, pos] of unit.positions) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
  }
  if (minX === Infinity) minX = 0;
  if (minY === Infinity) minY = 0;

  const dx = offsetX - minX;
  const dy = offsetY - minY;

  for (const [nid, pos] of unit.positions) {
    result.set(nid, { x: Math.round(pos.x + dx), y: Math.round(pos.y + dy) });
  }
}

// ===== 辅助函数 =====

/** 计算节点列表的包围盒 */
function computeBoundingBox(nodes: LayoutNode[]): { width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return {
    width: maxX - minX || 200,
    height: maxY - minY || 80,
  };
}

/** 从位置结果计算包围盒 */
function computeBoundingBoxFromPositions(
  nodes: LayoutNode[],
  positions: PositionResult,
): { width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const pos = positions.get(n.id);
    if (!pos) continue;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + n.width);
    maxY = Math.max(maxY, pos.y + n.height);
  }
  return {
    width: (maxX - minX) || 200,
    height: (maxY - minY) || 80,
  };
}

// ===== 主入口 =====

export interface SmartLayoutOptions {
  /** 打包方向 */
  direction?: 'horizontal' | 'vertical';
  /** 组 ID → 子节点 ID 列表映射 */
  groups?: Map<string, string[]>;
}

/**
 * Smart Compound Layout 主入口
 *
 * 自动识别组/树/散落节点, 执行三阶段布局。
 */
export function smartLayout(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  options: SmartLayoutOptions = {},
): PositionResult {
  if (nodes.length === 0) return new Map();

  const { direction = 'vertical', groups = new Map() } = options;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 锚点: 原节点包围盒左上角(与其他排列模式一致,内容留在原区域)
  const startX = Math.min(...nodes.map((n) => n.x));
  const startY = Math.min(...nodes.map((n) => n.y));

  // Phase 1: 分类
  const units = classifyUnits(nodes, edges, groups);

  // Phase 2: 内部布局
  layoutUnits(units, nodeMap, edges);

  // Phase 3: 复合打包(单列/单行堆叠,不换行)
  return compoundPack(units, direction, startX, startY);
}