/**
 * Resize 几何计算(纯函数)
 *
 * 根据 handle 类型和世界坐标偏移计算节点新 rect:
 * - 左/上角拖拽时同步平移 position 以保持对角不动
 * - 应用 minSize/maxSize 约束
 * - lockAspectRatio 时按起始比例锁定(仅角点 handle)
 */

import type { ResizeConfig, ResizeHandleType } from './types.js';
import { RESIZE_MIN_FALLBACK_SIZE } from '@zeroexo/core';

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
  // 兜底统一读 core 契约常量:所有 resizable 扩展都声明 minSize 后此兜底永不命中
  const minW = config.minSize?.width ?? RESIZE_MIN_FALLBACK_SIZE.width;
  const minH = config.minSize?.height ?? RESIZE_MIN_FALLBACK_SIZE.height;
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

  // 锁定宽高比(仅角点 handle)
  // 基准比例自适应:当前比例贴近契约(相对 defaultSize 高度偏差 ≤0.75px,即 isUniformScale
  // 判定通过的区间)时锁契约比例 —— round 引入的 ≤0.5px 偏差不会按 newW/startW 放大累积
  // (堆叠 220×143 触底放大回 620 时,若锁起始比例偏差会累积到 1.0px > 0.75px 容差
  // → useScale=false → 回退真实尺寸渲染,内容挤压/跳变);
  // 当前比例偏离契约(文本卡 scaleOverride 自由 resize 后、媒体节点 minSize 80×80 非等比
  // 触底等)时锁起始比例 —— 否则拖角点瞬间拉回契约比例,高度塌陷 + 内容跳变。
  if (
    config.lockAspectRatio &&
    start.width > 0 &&
    start.height > 0 &&
    (handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw')
  ) {
    const ds = config.defaultSize;
    const nearContract =
      !!ds &&
      ds.width > 0 &&
      ds.height > 0 &&
      Math.abs(start.width / ds.width - start.height / ds.height) * ds.height <= 0.75;
    const ratio = nearContract ? ds.width / ds.height : start.width / start.height;
    // 优先用 width 算 height,再按 handle 方向修正 position
    const newHFromW = newW / ratio;
    const diff = newHFromW - newH;
    if (handle.includes('n')) newY -= diff;
    newH = newHFromW;
  }

  return { x: Math.round(newX), y: Math.round(newY), width: Math.round(newW), height: Math.round(newH) };
}
