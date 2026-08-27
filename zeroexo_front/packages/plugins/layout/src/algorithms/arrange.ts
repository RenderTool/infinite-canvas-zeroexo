/**
 * 排列算法入口
 *
 * 排列策略:
 * 每个算法自身保证不重叠,所有节点从指定起点 (origMinX, origMinY) 开始排列。
 *
 * 排序规则: 按节点左上角位置排序 (Y 优先,同 Y 则 X),保证上→下,左→右填充。
 *
 * - grid: 按类型归类后,每组内宫格排布,组间垂直排列
 * - horizontal: 按类型归类后,全部节点一起横向排列(同类型节点相邻)
 * - vertical: 按类型归类后,全部节点一起竖向排列(同类型节点相邻)
 * - tree: 根据 edges 构建树状结构,层级左→右布局,同层节点垂直堆叠
 * - dagre: 基于真实 dagre 库的 Sugiyama 分层布局
 * - smart: 智能复合布局 — 自动识别组/树/游离节点,三阶段管线
 * - force: 力导向布局 — Fruchterman-Reingold 算法
 * - radial: 径向布局 — 根节点居中,子节点按层径向排列
 * - compact: 紧凑打包 — MaxRects 装箱算法
 * - auto: 无连线时按类型归类后宫格排列,有连线时走树状布局
 */

import type { NodeRecord } from '@zeroexo/core';
import type { ArrangeMode, LayoutNode, PositionResult } from '../types.js';
import { ARRANGE_GAP } from '../types.js';
import { maxRectsPacking } from './packing.js';
import { tidyTreeLayout } from './tree-layout.js';
import { arrangeDagre } from './dagre-layout.js';
import { smartLayout } from './smart-layout.js';
import { forceLayout } from './force-layout.js';
import { radialLayout } from './radial-layout.js';

// ===== NodeRecord → LayoutNode 转换 =====

/** 从 NodeRecord 提取布局信息(统一用 position + size,不依赖 bounds) */
export function toLayoutNode(n: NodeRecord): LayoutNode {
  const s = n.size ?? { width: 200, height: 80 };
  return {
    id: n.id,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    width: Math.max(1, Math.ceil(s.width)),
    height: Math.max(1, Math.ceil(s.height)),
    type: n.type,
  };
}

// ===== 排列入口 =====

export function arrangeNodes(
  nodes: LayoutNode[],
  mode: ArrangeMode,
  edges?: { source: string; target: string }[],
  options?: {
    /** 组 ID → 子节点 ID 列表映射 (smart 模式使用) */
    groups?: Map<string, string[]>;
  },
): PositionResult {
  if (nodes.length === 0) return new Map();

  // 按排列模式选择排序键:水平按 X 优先,其余按 Y 优先
  const sortByMode = (mode: ArrangeMode): ((a: LayoutNode, b: LayoutNode) => number) => {
    if (mode === 'horizontal') return (a, b) => a.x - b.x || a.y - b.y;
    return (a, b) => a.y - b.y || a.x - b.x;
  };
  const sorted = [...nodes].sort(sortByMode(mode));

  switch (mode) {
    case 'grid':
      return arrangeGroupedGrid(sorted);
    case 'horizontal':
      return arrangeGroupedHorizontal(sorted);
    case 'vertical':
      return arrangeGroupedVertical(sorted);
    case 'tree':
      return edges ? tidyTreeLayout(sorted, edges) : maxRectsPacking(nodes, ARRANGE_GAP);
    case 'dagre':
      return arrangeDagre(sorted, edges ?? []);
    case 'smart':
      return smartLayout(sorted, edges ?? [], { groups: options?.groups });
    case 'force':
      return forceLayout(sorted, edges ?? []);
    case 'radial':
      return radialLayout(sorted, edges ?? []);
    case 'compact':
      return maxRectsPacking(sorted, ARRANGE_GAP);
    case 'auto': {
      const hasEdges = edges && edges.length > 0 && edges.some((e) =>
        nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target),
      );
      if (hasEdges) {
        return tidyTreeLayout(sorted, edges!);
      }
      // 无连线:按类型分组宫格排列 + 中心锚点对齐
      const origCenter = computeNodesCenter(nodes);
      const gridPositions = arrangeGroupedGrid(sorted);
      return alignPositionsToCenter(nodes, gridPositions, origCenter);
    }
    default:
      return new Map();
  }
}

// ===== 按类型归类的排列算法 =====

/**
 * 将节点按 type 分组
 */
function groupByType(nodes: LayoutNode[]): Map<string, LayoutNode[]> {
  const groups = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    const key = n.type ?? 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  return groups;
}

/**
 * 计算节点包围盒中心
 */
function computeNodesCenter(nodes: LayoutNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * 将排列结果对齐到指定中心点。
 * 计算排列后包围盒中心,平移使其对齐目标中心,保持节点在当前区域。
 */
function alignPositionsToCenter(
  originalNodes: LayoutNode[],
  positions: PositionResult,
  targetCenter: { x: number; y: number },
): PositionResult {
  if (originalNodes.length === 0 || positions.size === 0) return positions;

  // 构建节点尺寸索引(用原始节点的宽高,与 grid 布局一致)
  const sizeMap = new Map(originalNodes.map((n) => [n.id, { width: n.width, height: n.height }]));

  // 计算排列后包围盒中心
  let newMinX = Infinity, newMinY = Infinity, newMaxX = -Infinity, newMaxY = -Infinity;
  for (const [id, pos] of positions) {
    const size = sizeMap.get(id);
    const w = size?.width ?? 200;
    const h = size?.height ?? 80;
    newMinX = Math.min(newMinX, pos.x);
    newMinY = Math.min(newMinY, pos.y);
    newMaxX = Math.max(newMaxX, pos.x + w);
    newMaxY = Math.max(newMaxY, pos.y + h);
  }

  const newCenterX = (newMinX + newMaxX) / 2;
  const newCenterY = (newMinY + newMaxY) / 2;

  // 计算平移偏移
  const offsetX = Math.round(targetCenter.x - newCenterX);
  const offsetY = Math.round(targetCenter.y - newCenterY);

  if (offsetX === 0 && offsetY === 0) return positions;

  const result = new Map<string, { x: number; y: number }>();
  for (const [id, pos] of positions) {
    result.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
  }
  return result;
}

/**
 * 宫格排列(按类型归类): 先按类型分组,每组内宫格排布,组间垂直排列。
 * 宫格算法: cols = ceil(sqrt(count)), 列宽=该列最宽节点,行高=该行最高节点,节点顶部对齐。
 */
function arrangeGroupedGrid(nodes: LayoutNode[]): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const groups = groupByType(nodes);
  const origMinX = Math.min(...nodes.map((n) => n.x));
  const origMinY = Math.min(...nodes.map((n) => n.y));
  let cursorY = origMinY;
  const GROUP_GAP = ARRANGE_GAP * 2;

  for (const [, group] of groups) {
    const n = group.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);

    // 构建行列索引
    const grid: (LayoutNode | null)[][] = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        grid[r]![c] = idx < n ? group[idx++]! : null;
      }
    }

    // 计算每列最大宽度
    const colWidths: number[] = new Array(cols).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const node = grid[r]![c];
        if (node && node.width > colWidths[c]!) {
          colWidths[c] = node.width;
        }
      }
    }

    // 计算每行最大高度
    const rowHeights: number[] = new Array(rows).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const node = grid[r]![c];
        if (node && node.height > rowHeights[r]!) {
          rowHeights[r] = node.height;
        }
      }
    }

    // 计算每列 X 起始位置(含间距)
    const colX: number[] = [origMinX];
    for (let c = 1; c < cols; c++) {
      colX[c] = colX[c - 1]! + colWidths[c - 1]! + ARRANGE_GAP;
    }

    // 放置节点: 格内水平居中 + 顶部对齐
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const node = grid[r]![c];
        if (!node) continue;
        const x = Math.round(colX[c]! + (colWidths[c]! - node.width) / 2);
        const y = Math.round(cursorY);
        result.set(node.id, { x, y });
      }
      cursorY += rowHeights[r]! + ARRANGE_GAP;
    }

    // 组间间距(扣除最后一行已加的 ARRANGE_GAP)
    cursorY += GROUP_GAP - ARRANGE_GAP;
  }

  return result;
}

/**
 * 水平排列(按类型归类): 先按类型分组,全部节点一起横向排列,同类型节点相邻。
 * 所有节点排成一行,从左到右,节点间距均匀,垂直居中对齐。
 */
function arrangeGroupedHorizontal(nodes: LayoutNode[]): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const groups = groupByType(nodes);
  const origMinX = Math.min(...nodes.map((n) => n.x));
  const origMinY = Math.min(...nodes.map((n) => n.y));
  const maxH = Math.max(...nodes.map((n) => n.height));

  let cursorX = origMinX;
  for (const [, group] of groups) {
    for (const n of group) {
      const y = Math.round(origMinY + (maxH - n.height) / 2);
      result.set(n.id, { x: Math.round(cursorX), y });
      cursorX += n.width + ARRANGE_GAP;
    }
  }

  return result;
}

/**
 * 垂直排列(按类型归类): 先按类型分组,全部节点一起竖向排列,同类型节点相邻。
 * 所有节点排成一列,从上到下,节点间距均匀,水平居中对齐。
 */
function arrangeGroupedVertical(nodes: LayoutNode[]): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const groups = groupByType(nodes);
  const origMinX = Math.min(...nodes.map((n) => n.x));
  const origMinY = Math.min(...nodes.map((n) => n.y));
  const maxW = Math.max(...nodes.map((n) => n.width));

  let cursorY = origMinY;
  for (const [, group] of groups) {
    for (const n of group) {
      const x = Math.round(origMinX + (maxW - n.width) / 2);
      result.set(n.id, { x, y: Math.round(cursorY) });
      cursorY += n.height + ARRANGE_GAP;
    }
  }

  return result;
}