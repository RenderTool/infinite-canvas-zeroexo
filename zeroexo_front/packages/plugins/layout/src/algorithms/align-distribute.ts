/**
 * 对齐与分布算法
 * - 对齐(6): 左 / 水平居中 / 右 / 顶 / 垂直居中 / 底
 * - 分布(2): 水平等距 / 垂直等距
 */

import type { AlignMode, DistributeMode, LayoutNode, PositionResult } from '../types.js';

// ===== 对齐 =====

export function alignNodes(nodes: LayoutNode[], mode: AlignMode): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length < 2) return result;

  const minX = Math.min(...nodes.map((n) => n.x));
  const maxXRight = Math.max(...nodes.map((n) => n.x + n.width));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxYBottom = Math.max(...nodes.map((n) => n.y + n.height));
  const centerX = (minX + maxXRight) / 2;
  const centerY = (minY + maxYBottom) / 2;

  nodes.forEach((n) => {
    let x = n.x;
    let y = n.y;
    switch (mode) {
      case 'left': x = minX; break;
      case 'hCenter': x = centerX - n.width / 2; break;
      case 'right': x = maxXRight - n.width; break;
      case 'top': y = minY; break;
      case 'vCenter': y = centerY - n.height / 2; break;
      case 'bottom': y = maxYBottom - n.height; break;
    }
    // BUG2: 位置取整
    result.set(n.id, { x: Math.round(x), y: Math.round(y) });
  });
  return result;
}

// ===== 分布 =====

export function distributeNodes(nodes: LayoutNode[], mode: DistributeMode): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length < 3) return result;

  if (mode === 'horizontal') {
    const sorted = [...nodes].sort((a, b) => a.x - b.x);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const totalSpan = (last.x + last.width) - first.x;
    const totalNodeWidth = sorted.reduce((sum, n) => sum + n.width, 0);
    const gap = (totalSpan - totalNodeWidth) / (sorted.length - 1);
    let cursor = first.x;
    sorted.forEach((n) => {
      result.set(n.id, { x: cursor, y: n.y });
      cursor += n.width + gap;
    });
    return result;
  }

  // vertical
  const sorted = [...nodes].sort((a, b) => a.y - b.y);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const totalSpan = (last.y + last.height) - first.y;
  const totalNodeHeight = sorted.reduce((sum, n) => sum + n.height, 0);
  const gap = (totalSpan - totalNodeHeight) / (sorted.length - 1);
  let cursor = first.y;
  sorted.forEach((n) => {
    result.set(n.id, { x: n.x, y: cursor });
    cursor += n.height + gap;
  });
  return result;
}
