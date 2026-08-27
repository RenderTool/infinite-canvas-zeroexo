/**
 * 径向布局 (Radial Layout)
 *
 * 根节点在中心, 子节点按层径向排列:
 * - 根节点置于圆心
 * - 第 1 层子节点在同心圆上均匀分布
 * - 第 2+ 层子节点在父节点扇区内径向排列
 * - 同层节点在同心圆上均匀分布
 *
 * 适用于单根树 / 思维导图 / 根节点聚焦展示。
 */

import type { LayoutNode, PositionResult } from '../types.js';
import { ARRANGE_GAP } from '../types.js';
import { maxRectsPacking } from './packing.js';

interface RadialLayoutOptions {
  /** 根节点 ID (默认自动选择入度为 0 的节点, 多个则取第一个) */
  rootId?: string;
  /** 层半径增量 (默认 200) */
  layerRadiusIncrement?: number;
  /** 最小扇区角度 (度, 默认 30, 防止节点太挤) */
  minSectorAngle?: number;
}

/**
 * 径向布局
 */
export function radialLayout(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  options: RadialLayoutOptions = {},
): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const {
    rootId: explicitRootId,
    layerRadiusIncrement = 250,
    minSectorAngle = 30,
  } = options;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 过滤边
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  // 构建树结构
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string | null>();
  for (const id of nodeIds) {
    childrenMap.set(id, []);
    parentMap.set(id, null);
  }
  for (const e of filteredEdges) {
    childrenMap.get(e.source)!.push(e.target);
    parentMap.set(e.target, e.source);
  }

  // 自动选择根节点
  let rootId = explicitRootId;
  if (!rootId) {
    const roots = nodes.filter((n) => parentMap.get(n.id) === null);
    if (roots.length === 0) {
      // 全部有父节点或有环: 选第一个节点
      rootId = nodes[0]!.id;
    } else {
      rootId = roots[0]!.id;
    }
  }

  // 计算每层节点数 (BFS)
  const levelMap = new Map<string, number>();
  const levelCounts = new Map<number, number>();
  const queue: string[] = [rootId];
  levelMap.set(rootId, 0);
  levelCounts.set(0, 1);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levelMap.get(current) ?? 0;
    for (const child of childrenMap.get(current) ?? []) {
      if (!levelMap.has(child)) {
        levelMap.set(child, level + 1);
        levelCounts.set(level + 1, (levelCounts.get(level + 1) ?? 0) + 1);
        queue.push(child);
      }
    }
  }

  // 放置节点
  const rootNode = nodeMap.get(rootId)!;
  const centerX = rootNode?.x + (rootNode?.width ?? 200) / 2;
  const centerY = rootNode?.y + (rootNode?.height ?? 80) / 2;

  // 根节点居中
  result.set(rootId, {
    x: Math.round(centerX - (rootNode?.width ?? 200) / 2),
    y: Math.round(centerY - (rootNode?.height ?? 80) / 2),
  });

  // 按层 BFS 放置
  const placed = new Set<string>([rootId]);
  const bfsQueue: string[] = [rootId];

  // 记录每个父节点的扇区范围
  const sectorMap = new Map<string, { startAngle: number; endAngle: number }>();
  sectorMap.set(rootId, { startAngle: 0, endAngle: 360 });

  while (bfsQueue.length > 0) {
    const parent = bfsQueue.shift()!;
    const children = childrenMap.get(parent) ?? [];
    const parentSector = sectorMap.get(parent)!;
    const parentNode = nodeMap.get(parent)!;
    const parentCenterX = result.get(parent)?.x ?? parentNode!.x;
    const parentCenterY = result.get(parent)?.y ?? parentNode!.y;

    const childCount = children.length;
    if (childCount === 0) continue;

    // 每个子节点的扇区角度
    const sectorAngle = (parentSector.endAngle - parentSector.startAngle) / childCount;

    for (let i = 0; i < childCount; i++) {
      const child = children[i]!;
      if (placed.has(child)) continue;
      placed.add(child);

      const childNode = nodeMap.get(child)!;
      const childLevel = levelMap.get(child) ?? 0;
      const radius = childLevel * layerRadiusIncrement;

      // 子节点扇区
      const childStartAngle = parentSector.startAngle + i * sectorAngle;
      const childEndAngle = childStartAngle + sectorAngle;
      sectorMap.set(child, {
        startAngle: childStartAngle,
        endAngle: childEndAngle,
      });

      // 在该扇区中间放置子节点
      const actualAngle = Math.max(childStartAngle, childStartAngle + (minSectorAngle / childCount));

      // 计算位置
      const angleRad = actualAngle * (Math.PI / 180);
      const nodeX = parentCenterX + parentNode!.width / 2 + radius * Math.cos(angleRad) - childNode.width / 2;
      const nodeY = parentCenterY + parentNode!.height / 2 + radius * Math.sin(angleRad) - childNode.height / 2;

      result.set(child, {
        x: Math.round(nodeX),
        y: Math.round(nodeY),
      });

      bfsQueue.push(child);
    }
  }

  // 游离节点: 用 compact 打包到径向图外部
  const connectedIds = new Set<string>();
  for (const e of filteredEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }
  const discreteIds = nodes.filter((n) => !connectedIds.has(n.id)).map((n) => n.id);

  if (discreteIds.length > 0) {
    const discreteNodes = discreteIds.map((id) => nodeMap.get(id)!);
    const discretePositions = maxRectsPacking(discreteNodes, ARRANGE_GAP);

    // 计算径向图范围
    let maxR = 0;
    for (const [id, pos] of result) {
      const node = nodeMap.get(id);
      if (node) {
        const dx = pos.x + node.width / 2 - centerX;
        const dy = pos.y + node.height / 2 - centerY;
        maxR = Math.max(maxR, Math.sqrt(dx * dx + dy * dy) + node.width);
      }
    }

    for (const [id, pos] of discretePositions) {
      result.set(id, {
        x: pos.x + Math.round(centerX - maxR - 200),
        y: pos.y + Math.round(centerY),
      });
    }
  }

  return result;
}