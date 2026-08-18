/**
 * Helper Lines(对齐辅助线)纯计算
 *
 * 比较拖拽节点与其他节点的边缘/中心线,返回阈值内匹配的对齐线。
 * 纯函数,不依赖 store(位置快照由调用方提供)。
 */

import type { HelperLine } from './types.js';

/** 参与对齐计算的节点快照(位置 + 尺寸) */
export interface HelperLineNode {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * 计算拖拽中的对齐辅助线。
 * - draggedNodes: 拖拽中节点(位置已是当前实时位置)
 * - otherNodes: 其余节点
 * - threshold: 对齐阈值(世界坐标像素)
 */
export function calculateHelperLines(
  draggedNodes: HelperLineNode[],
  otherNodes: HelperLineNode[],
  threshold: number,
): HelperLine[] {
  if (draggedNodes.length === 0 || otherNodes.length === 0) return [];

  const lines: HelperLine[] = [];
  const seen = new Set<string>(); // 去重 key

  const addLine = (type: 'horizontal' | 'vertical', pos: number, start: number, end: number) => {
    const key = `${type}:${Math.round(pos)}:${Math.round(start)}:${Math.round(end)}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ type, position: pos, start, end });
  };

  for (const dragged of draggedNodes) {
    const dPos = dragged.position;
    const dSize = dragged.size;
    const dLeft = dPos.x;
    const dRight = dPos.x + dSize.width;
    const dTop = dPos.y;
    const dBottom = dPos.y + dSize.height;
    const dCenterX = dPos.x + dSize.width / 2;
    const dCenterY = dPos.y + dSize.height / 2;

    for (const otherNode of otherNodes) {
      const oPos = otherNode.position;
      const oSize = otherNode.size;
      const oLeft = oPos.x;
      const oRight = oPos.x + oSize.width;
      const oTop = oPos.y;
      const oBottom = oPos.y + oSize.height;
      const oCenterX = oPos.x + oSize.width / 2;
      const oCenterY = oPos.y + oSize.height / 2;

      // 水平对齐线(垂直方向对齐)
      // 顶部对齐
      if (Math.abs(dTop - oTop) < threshold) {
        addLine('horizontal', dTop, Math.min(dLeft, oLeft), Math.max(dRight, oRight));
      }
      // 底部对齐
      if (Math.abs(dBottom - oBottom) < threshold) {
        addLine('horizontal', dBottom, Math.min(dLeft, oLeft), Math.max(dRight, oRight));
      }
      // 垂直居中
      if (Math.abs(dCenterY - oCenterY) < threshold) {
        addLine('horizontal', dCenterY, Math.min(dLeft, oLeft), Math.max(dRight, oRight));
      }
      // 顶对底
      if (Math.abs(dTop - oBottom) < threshold) {
        addLine('horizontal', dTop, Math.min(dLeft, oLeft), Math.max(dRight, oRight));
      }
      if (Math.abs(dBottom - oTop) < threshold) {
        addLine('horizontal', dBottom, Math.min(dLeft, oLeft), Math.max(dRight, oRight));
      }

      // 垂直对齐线(水平方向对齐)
      // 左对齐
      if (Math.abs(dLeft - oLeft) < threshold) {
        addLine('vertical', dLeft, Math.min(dTop, oTop), Math.max(dBottom, oBottom));
      }
      // 右对齐
      if (Math.abs(dRight - oRight) < threshold) {
        addLine('vertical', dRight, Math.min(dTop, oTop), Math.max(dBottom, oBottom));
      }
      // 水平居中
      if (Math.abs(dCenterX - oCenterX) < threshold) {
        addLine('vertical', dCenterX, Math.min(dTop, oTop), Math.max(dBottom, oBottom));
      }
      // 左对右
      if (Math.abs(dLeft - oRight) < threshold) {
        addLine('vertical', dLeft, Math.min(dTop, oTop), Math.max(dBottom, oBottom));
      }
      if (Math.abs(dRight - oLeft) < threshold) {
        addLine('vertical', dRight, Math.min(dTop, oTop), Math.max(dBottom, oBottom));
      }
    }
  }

  return lines;
}
