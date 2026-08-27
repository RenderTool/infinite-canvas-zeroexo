/**
 * 力导向布局 (Force-Directed Layout)
 *
 * 基于 Fruchterman-Reingold 算法:
 * - 有边连接的节点 → 弹簧引力 (attractive force)
 * - 所有节点间 → 库仑斥力 (repulsive force)
 * - 中心引力防止散开
 * - 碰撞检测避免重叠
 *
 * 适用于有机图 / 思维导图 / 探索式布局, 大量节点间无明确层级关系时使用。
 */

import type { LayoutNode, PositionResult } from '../types.js';
import { ARRANGE_GAP } from '../types.js';

interface ForceConfig {
  /** 迭代次数 (默认 100) */
  iterations?: number;
  /** 弹簧常数 (默认 0.01) */
  springK?: number;
  /** 斥力常数 (默认 500) */
  repulsionK?: number;
  /** 中心引力系数 (默认 0.01) */
  centerGravity?: number;
  /** 最大位移 (默认 50, 避免震荡) */
  maxDisplacement?: number;
  /** 冷却因子 (默认 0.99, 每次迭代乘以此值) */
  cooling?: number;
  /** 理想边长 (默认 200) */
  idealEdgeLength?: number;
}

/**
 * 力导向布局
 */
export function forceLayout(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  config: ForceConfig = {},
): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  const {
    iterations = 100,
    springK = 0.01,
    repulsionK = 500,
    centerGravity = 0.01,
    maxDisplacement = 50,
    cooling = 0.99,
    idealEdgeLength = 200,
  } = config;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 过滤边
  const filteredEdges = edges.filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  // 初始化位置: 以当前节点位置为起点, 散落节点用随机偏移
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  for (const node of nodes) {
    positions.set(node.id, {
      x: node.x + (Math.random() - 0.5) * 10,
      y: node.y + (Math.random() - 0.5) * 10,
      vx: 0,
      vy: 0,
    });
  }

  // 计算包围盒中心 (中心引力目标)
  let cx = 0, cy = 0;
  for (const n of nodes) { cx += n.x + n.width / 2; cy += n.y + n.height / 2; }
  cx /= nodes.length;
  cy /= nodes.length;

  // 力模拟迭代
  let temperature = maxDisplacement;

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();
    for (const id of nodeIds) forces.set(id, { fx: 0, fy: 0 });

    // 1. 斥力 (所有节点对)
    const nodeList = [...nodeIds];
    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const a = nodeList[i]!;
        const b = nodeList[j]!;
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;

        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1; // 防止除零

        // 考虑节点大小: 实际距离减去节点半径
        const nodeA = nodeMap.get(a)!;
        const nodeB = nodeMap.get(b)!;
        const minDist = Math.max(nodeA.width, nodeA.height, nodeB.width, nodeB.height) / 2 + ARRANGE_GAP;
        const effectiveDist = Math.max(dist, minDist);

        const force = repulsionK / (effectiveDist * effectiveDist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        forces.get(a)!.fx += fx;
        forces.get(a)!.fy += fy;
        forces.get(b)!.fx -= fx;
        forces.get(b)!.fy -= fy;
      }
    }

    // 2. 引力 (有边连接的节点)
    for (const e of filteredEdges) {
      const pa = positions.get(e.source)!;
      const pb = positions.get(e.target)!;
      const nodeA = nodeMap.get(e.source)!;
      const nodeB = nodeMap.get(e.target)!;

      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;

      // 理想边长考虑节点大小
      const idealLen = (nodeA.width + nodeA.height + nodeB.width + nodeB.height) / 4 + idealEdgeLength;
      const displacement = dist - idealLen;
      const force = springK * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      forces.get(e.source)!.fx += fx;
      forces.get(e.source)!.fy += fy;
      forces.get(e.target)!.fx -= fx;
      forces.get(e.target)!.fy -= fy;
    }

    // 3. 中心引力
    for (const id of nodeIds) {
      const pos = positions.get(id)!;
      const node = nodeMap.get(id)!;
      const nodeCenterX = pos.x + node.width / 2;
      const nodeCenterY = pos.y + node.height / 2;
      forces.get(id)!.fx += (cx - nodeCenterX) * centerGravity;
      forces.get(id)!.fy += (cy - nodeCenterY) * centerGravity;
    }

    // 4. 应用力 + 速度阻尼
    for (const id of nodeIds) {
      const pos = positions.get(id)!;
      const f = forces.get(id)!;

      // 速度 Verlet 积分
      pos.vx = (pos.vx + f.fx) * 0.85;
      pos.vy = (pos.vy + f.fy) * 0.85;

      // 限制最大位移
      const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy);
      if (speed > temperature) {
        pos.vx = (pos.vx / speed) * temperature;
        pos.vy = (pos.vy / speed) * temperature;
      }

      pos.x += pos.vx;
      pos.y += pos.vy;
    }

    // 冷却
    temperature *= cooling;
  }

  // 提取结果 (转成整数坐标)
  for (const id of nodeIds) {
    const pos = positions.get(id)!;
    result.set(id, { x: Math.round(pos.x), y: Math.round(pos.y) });
  }

  return result;
}