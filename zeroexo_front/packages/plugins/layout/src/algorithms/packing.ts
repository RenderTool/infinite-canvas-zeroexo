/**
 * MaxRects 装箱算法(紧凑排列)
 *
 * 参考: Jukka Jylänki, "A Thousand Ways to Pack the Bin" (2010)
 * 实现: MaxRects-BL 变体,使用 Bottom-Left 启发式 + 最小面积选择。
 *
 * 核心思想:
 * 1. 维护自由矩形列表(free rectangles),初始为整个画布区域
 * 2. 每次放置节点时,找到能容纳它的最小自由矩形
 * 3. 在该矩形的左下角放置节点
 * 4. 将剩余空间分割为新的自由矩形
 */

import type { LayoutNode, PositionResult } from '../types.js';

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;   // x + width (预计算优化)
  bottom: number;  // y + height (预计算优化)
}

/** 创建自由矩形 */
function createFreeRect(x: number, y: number, width: number, height: number): FreeRect {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

/**
 * MaxRects 装箱主算法
 * @param nodes 待排列的节点列表
 * @param gap 节点间距
 * @returns 每个节点的最优位置
 */
export function maxRectsPacking(
  nodes: LayoutNode[],
  gap: number,
): PositionResult {
  const result: PositionResult = new Map();
  if (nodes.length === 0) return result;

  // 按高度降序排序(MaxRects BL 变体的最佳排序)
  const sorted = [...nodes].sort((a, b) => b.height - a.height);

  // 从节点当前位置就近排列:使用节点最小坐标作为起点
  const origMinX = Math.min(...nodes.map((n) => n.x));
  const origMinY = Math.min(...nodes.map((n) => n.y));
  const firstNode = sorted[0]!;

  result.set(firstNode.id, { x: origMinX, y: origMinY });

  // 初始化自由矩形列表
  const freeRects: FreeRect[] = [];

  // 添加第一个节点右侧的自由区域
  freeRects.push(createFreeRect(
    origMinX + firstNode.width + gap,
    origMinY,
    Number.MAX_SAFE_INTEGER - origMinX - firstNode.width - gap,
    Number.MAX_SAFE_INTEGER - origMinY,
  ));

  // 添加第一个节点下方的自由区域
  freeRects.push(createFreeRect(
    origMinX,
    origMinY + firstNode.height + gap,
    Number.MAX_SAFE_INTEGER - origMinX,
    Number.MAX_SAFE_INTEGER - origMinY - firstNode.height - gap,
  ));

  // 记录当前已放置节点的边界
  let maxRight = origMinX + firstNode.width;
  let maxBottom = origMinY + firstNode.height;

  // 放置剩余节点
  for (let i = 1; i < sorted.length; i++) {
    const node = sorted[i]!;
    const nodeW = node.width + gap;
    const nodeH = node.height + gap;

    // 寻找最优自由矩形(Bottom-Left 启发式:先选最低,再选最左)
    let bestRect: FreeRect | null = null;
    let bestIdx = -1;

    for (let j = 0; j < freeRects.length; j++) {
      const fr = freeRects[j]!;
      if (fr.width >= nodeW && fr.height >= nodeH) {
        // 可以容纳该节点,检查是否更优
        if (
          bestRect === null ||
          fr.y < bestRect.y || (fr.y === bestRect.y && fr.x < bestRect.x)
        ) {
          bestRect = fr;
          bestIdx = j;
        }
      }
    }

    if (bestRect) {
      // 在该自由矩形内放置节点
      const x = bestRect.x;
      const y = bestRect.y;
      result.set(node.id, { x, y });

      // 分割该自由矩形
      const newRects = splitFreeRect(bestRect, x, y, nodeW, nodeH);
      freeRects.splice(bestIdx, 1);
      freeRects.push(...newRects);

      // 清理:移除完全被其他矩形包含的矩形
      pruneFreeRects(freeRects);

      // 更新边界
      maxRight = Math.max(maxRight, x + nodeW);
      maxBottom = Math.max(maxBottom, y + nodeH);
    } else {
      // 没有合适的自由矩形,扩展边界
      const newX = maxRight + gap;
      const newY = origMinY;

      result.set(node.id, { x: newX, y: newY });

      // 添加新的自由矩形(在节点下方)
      freeRects.push(createFreeRect(
        origMinX,
        newY + nodeH,
        newX + nodeW - origMinX,
        Number.MAX_SAFE_INTEGER - newY - nodeH,
      ));

      // 添加新的自由矩形(在节点右侧)
      freeRects.push(createFreeRect(
        newX + nodeW,
        origMinY,
        Number.MAX_SAFE_INTEGER - newX - nodeW,
        Number.MAX_SAFE_INTEGER - origMinY,
      ));

      maxRight = newX + nodeW;
      maxBottom = Math.max(maxBottom, newY + nodeH);

      // 清理
      pruneFreeRects(freeRects);
    }
  }

  return result;
}

/**
 * 分割自由矩形:当在 (x,y) 放置一个 w×h 的节点后,
 * 将原始自由矩形分割为最多 4 个新的自由矩形(上、右、下、左)。
 */
function splitFreeRect(
  rect: FreeRect,
  x: number,
  y: number,
  w: number,
  h: number,
): FreeRect[] {
  const rects: FreeRect[] = [];

  // 上方(原矩形顶部到节点顶部之间)
  if (y > rect.y) {
    rects.push(createFreeRect(rect.x, rect.y, rect.width, y - rect.y));
  }

  // 下方(原矩形底部到节点底部之间)
  const nodeBottom = y + h;
  if (nodeBottom < rect.bottom) {
    rects.push(createFreeRect(rect.x, nodeBottom, rect.width, rect.bottom - nodeBottom));
  }

  // 左侧(节点左边到原矩形左边之间)
  if (x > rect.x) {
    rects.push(createFreeRect(rect.x, rect.y, x - rect.x, rect.height));
  }

  // 右侧(节点右边到原矩形右边之间)
  const nodeRight = x + w;
  if (nodeRight < rect.right) {
    rects.push(createFreeRect(nodeRight, rect.y, rect.right - nodeRight, rect.height));
  }

  return rects;
}

/**
 * 清理自由矩形列表:移除被其他矩形完全包含的矩形。
 */
function pruneFreeRects(rects: FreeRect[]): void {
  const toRemove = new Set<number>();

  for (let i = 0; i < rects.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = 0; j < rects.length; j++) {
      if (i === j || toRemove.has(j)) continue;

      const a = rects[i]!;
      const b = rects[j]!;

      // a 被 b 完全包含
      if (a.x >= b.x && a.y >= b.y && a.right <= b.right && a.bottom <= b.bottom) {
        toRemove.add(i);
        break;
      }
    }
  }

  // 从后往前删除(避免索引问题)
  const sorted = [...toRemove].sort((a, b) => b - a);
  for (const idx of sorted) {
    rects.splice(idx, 1);
  }
}
