/**
 * 尺寸统一与层级排序
 * - unifyNodeSizes: 恢复基准尺寸
 * - sortElements: 层级排序(上移/下移/置顶/置底)
 */

import type { NodeRecord } from '@zeroexo/core';
import type { LayoutNode, SizeResult, SortDirection, UnifySizeMode } from '../types.js';

// ===== 尺寸统一: 恢复基准尺寸 =====

/**
 * 恢复基准尺寸:
 * - 有 defaultSize 的节点 → 恢复到该类型的基准尺寸
 *   (resizable 仅约束手动拖拽缩放,不影响基准恢复:
 *   generator/audio 等固定尺寸节点同样需要恢复到基准)
 * - lockAspectRatio 的节点(图片/视频) → 宽度固定为基准宽度,按当前宽高比计算高度
 * - 没有 defaultSize 的节点 → 跳过(无法确定基准)
 */
export function unifyNodeSizes(nodes: LayoutNode[], _mode: UnifySizeMode): SizeResult {
  const result: SizeResult = new Map();
  if (nodes.length === 0) return result;

  for (const n of nodes) {
    // 没有 defaultSize 的节点跳过(无法确定基准)
    if (!n.defaultSize) continue;

    const baseW = n.defaultSize.width;
    const baseH = n.defaultSize.height;
    let newW: number;
    let newH: number;

    if (n.lockAspectRatio) {
      // 以宽度为基准,保持当前宽高比按宽度缩放
      const ratio = n.width / n.height;
      newW = baseW;
      newH = Math.max(80, Math.round(baseW / ratio));
    } else {
      // 无宽高比锁定,直接恢复到 defaultSize
      newW = baseW;
      newH = baseH;
    }

    result.set(n.id, {
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: Math.max(1, newW),
      height: Math.max(1, newH),
    });
  }
  return result;
}

// ===== 层级排序(4): 上移 / 下移 / 置顶 / 置底 =====

/**
 * 层级排序:返回完整的新 NodeRecord 数组(改顺序,不改坐标)。
 * 要求所有 target 共享同一 parentId(跨父级返回 null)。
 */
export function sortElements(
  nodes: NodeRecord[],
  targetIds: string[],
  direction: SortDirection,
): NodeRecord[] | null {
  if (targetIds.length === 0) return null;

  // 校验所有 target 共享同一 parentId
  const targetSet = new Set(targetIds);
  const parentIds = new Set<string | null | undefined>();
  for (const n of nodes) {
    if (targetSet.has(n.id)) {
      parentIds.add(n.parentId);
    }
  }
  if (parentIds.size > 1) return null;
  const parentId = parentIds.values().next().value ?? null;

  // 获取同级兄弟(按当前数组顺序)
  const siblings = nodes.filter((n) => (n.parentId ?? null) === (parentId ?? null));
  const selected = siblings.filter((n) => targetSet.has(n.id));
  const others = siblings.filter((n) => !targetSet.has(n.id));

  let ordered: NodeRecord[];
  switch (direction) {
    case 'bringToFront':
      ordered = [...others, ...selected];
      break;
    case 'sendToBack':
      ordered = [...selected, ...others];
      break;
    case 'moveUp': {
      // 提取选中节点(按在 siblings 中的原始顺序排序)
      const selectedWithIdx = selected
        .map((s) => ({ node: s, idx: siblings.indexOf(s) }))
        .sort((a, b) => a.idx - b.idx);
      const minIdx = selectedWithIdx[0]!.idx;
      if (minIdx <= 0) return null;
      // 找到第一个选中节点之前的非选中节点
      const targetIdx = minIdx - 1;
      if (targetIdx < 0) return null;
      // 从 siblings 中逐个移除选中节点,然后插入到目标位置之前
      ordered = siblings.filter((n) => !targetSet.has(n.id));
      ordered.splice(targetIdx, 0, ...selectedWithIdx.map((s) => s.node));
      break;
    }
    case 'moveDown': {
      const selectedWithIdx = selected
        .map((s) => ({ node: s, idx: siblings.indexOf(s) }))
        .sort((a, b) => a.idx - b.idx);
      const maxIdx = selectedWithIdx[selectedWithIdx.length - 1]!.idx;
      if (maxIdx >= siblings.length - 1) return null;
      // 找到最后一个选中节点之后的非选中节点
      const targetIdx = maxIdx + 1;
      if (targetIdx >= siblings.length) return null;
      // 从 siblings 中逐个移除选中节点,然后插入到目标位置之后
      ordered = siblings.filter((n) => !targetSet.has(n.id));
      ordered.splice(targetIdx + 1, 0, ...selectedWithIdx.map((s) => s.node));
      break;
    }
  }

  // 重建 nodes 数组:用 ordered 替换原 siblings 顺序
  const siblingIds = new Set(siblings.map((s) => s.id));
  // 保持非兄弟节点的相对位置不变,兄弟节点按 ordered 顺序插入到原位置
  const firstSiblingIdx = nodes.findIndex((n) => siblingIds.has(n.id));
  const before = nodes.slice(0, firstSiblingIdx).filter((n) => !siblingIds.has(n.id));
  const after = nodes.slice(firstSiblingIdx).filter((n) => !siblingIds.has(n.id));
  return [...before, ...ordered, ...after];
}
