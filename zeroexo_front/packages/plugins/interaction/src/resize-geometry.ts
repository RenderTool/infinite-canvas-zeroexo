/**
 * Resize 几何计算(纯函数)
 *
 * 根据 handle 类型和世界坐标偏移计算节点新 rect:
 * - 左/上角拖拽时同步平移 position 以保持对角不动
 * - 应用 minSize/maxSize 约束
 * - lockAspectRatio 时按起始比例锁定(仅角点 handle)
 */

import type { ResizeConfig, ResizeHandleType } from './types.js';

export interface ResizeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算 resize 后的新 rect(整数化)。
 * - start: resize 起始 rect
 * - handle: 拖拽的方位 handle
 * - config: resize 约束配置
 * - dx/dy: 世界坐标偏移量
 */
export function computeResizeRect(
  start: ResizeRect,
  handle: ResizeHandleType,
  config: ResizeConfig,
  dx: number,
  dy: number,
): ResizeRect {
  let newX = start.x;
  let newY = start.y;
  let newW = start.width;
  let newH = start.height;

  // 根据 handle 类型计算新 rect
  if (handle.includes('w')) {
    newX = start.x + dx;
    newW = start.width - dx;
  }
  if (handle.includes('e')) {
    newW = start.width + dx;
  }
  if (handle.includes('n')) {
    newY = start.y + dy;
    newH = start.height - dy;
  }
  if (handle.includes('s')) {
    newH = start.height + dy;
  }

  // 应用 minSize 约束(左/上角拖拽时反向修正 position)
  const minW = config.minSize?.width ?? 80;
  const minH = config.minSize?.height ?? 60;
  const maxW = config.maxSize?.width ?? Infinity;
  const maxH = config.maxSize?.height ?? Infinity;

  if (newW < minW) {
    if (handle.includes('w')) newX -= minW - newW;
    newW = minW;
  }
  if (newW > maxW) {
    if (handle.includes('w')) newX += newW - maxW;
    newW = maxW;
  }
  if (newH < minH) {
    if (handle.includes('n')) newY -= minH - newH;
    newH = minH;
  }
  if (newH > maxH) {
    if (handle.includes('n')) newY += newH - maxH;
    newH = maxH;
  }

  // 锁定宽高比(仅角点 handle,按起始比例)
  if (
    config.lockAspectRatio &&
    start.width > 0 &&
    start.height > 0 &&
    (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw')
  ) {
    const ratio = start.width / start.height;
    // 优先用 width 算 height,再按 handle 方向修正 position
    const newHFromW = newW / ratio;
    const diff = newHFromW - newH;
    if (handle.includes('n')) newY -= diff;
    newH = newHFromW;
  }

  return { x: Math.round(newX), y: Math.round(newY), width: Math.round(newW), height: Math.round(newH) };
}
