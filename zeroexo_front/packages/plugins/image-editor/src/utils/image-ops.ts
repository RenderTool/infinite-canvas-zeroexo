/**
 * 图片操作纯函数(裁剪/切分/放大)
 * 所有函数返回 dataUrl,不涉及 AI 调用
 */

import type { CropRect, SplitParams, UpscaleParams, UpscaleAlgorithm } from '../types.js';
import { MAX_UPSCALE_LONG_EDGE } from '../types.js';
import { loadImage } from './image-meta.js';

/**
 * 裁剪图片(归一化比例)
 */
export async function cropDataUrl(dataUrl: string, crop: CropRect): Promise<string> {
  const img = await loadImage(dataUrl);
  const sx = crop.x * img.naturalWidth;
  const sy = crop.y * img.naturalHeight;
  const sw = crop.width * img.naturalWidth;
  const sh = crop.height * img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw);
  canvas.height = Math.round(sh);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** 将归一化分割线换算为像素边界数组 [0, b1, b2, ..., 总长];缺省均匀 */
function resolveBoundaries(breaks: number[] | undefined, count: number, total: number): number[] {
  const inner =
    breaks && breaks.length === count - 1
      ? breaks.map((b) => Math.min(Math.max(b, 0), 1) * total)
      : Array.from({ length: count - 1 }, (_, i) => ((i + 1) / count) * total);
  return [0, ...inner, total];
}

/**
 * 切分图片(行列网格,支持非均匀分割线)
 * 返回 pieces 数组(行优先: r0c0, r0c1, ..., r1c0, ...)
 */
export async function splitDataUrl(dataUrl: string, params: SplitParams): Promise<string[]> {
  const img = await loadImage(dataUrl);
  const { rows, columns } = params;
  const colBounds = resolveBoundaries(params.columnBreaks, columns, img.naturalWidth);
  const rowBounds = resolveBoundaries(params.rowBreaks, rows, img.naturalHeight);
  const pieces: string[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const sx = Math.floor(colBounds[c]!);
      const sy = Math.floor(rowBounds[r]!);
      const sw = Math.max(1, Math.floor(colBounds[c + 1]!) - sx);
      const sh = Math.max(1, Math.floor(rowBounds[r + 1]!) - sy);
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      pieces.push(canvas.toDataURL('image/png'));
    }
  }
  return pieces;
}

/**
 * 计算放大后尺寸
 */
export function resolveUpscaleSize(
  width: number,
  height: number,
  targetLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  const scale = targetLongEdge / longEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * 放大图片
 * - high: 阶梯式翻倍放大(质量最优)
 * - bilinear: 双线性插值(平滑)
 * - nearest: 最近邻(像素风格)
 */
export async function upscaleDataUrl(dataUrl: string, params: UpscaleParams): Promise<string> {
  const img = await loadImage(dataUrl);
  const { width: outW, height: outH } = resolveUpscaleSize(
    img.naturalWidth,
    img.naturalHeight,
    params.targetLongEdge,
  );

  // 目标尺寸不超过上限
  const safeW = Math.min(outW, MAX_UPSCALE_LONG_EDGE * 2);
  const safeH = Math.min(outH, MAX_UPSCALE_LONG_EDGE * 2);

  if (params.algorithm === 'high') {
    return drawStepUpscale(img, safeW, safeH);
  }
  return drawResize(img, safeW, safeH, params.algorithm);
}

/** 单步缩放(双线性/最近邻) */
function drawResize(
  img: HTMLImageElement,
  width: number,
  height: number,
  algorithm: UpscaleAlgorithm,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = algorithm !== 'nearest';
  ctx.imageSmoothingQuality = algorithm === 'high' ? 'high' : 'medium';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

/**
 * 阶梯式翻倍放大(high 算法,质量最优)
 * 原理: 逐次 2x 放大,避免一次大跨度缩放造成的细节丢失
 */
function drawStepUpscale(img: HTMLImageElement, targetW: number, targetH: number): string {
  let currentW = img.naturalWidth;
  let currentH = img.naturalHeight;

  // 初始 canvas = 原图
  let currentCanvas = document.createElement('canvas');
  currentCanvas.width = currentW;
  currentCanvas.height = currentH;
  let ctx = currentCanvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  // 逐次 2x 放大,直到下一步会超过目标
  while (currentW * 2 < targetW) {
    currentW *= 2;
    currentH *= 2;
    const next = document.createElement('canvas');
    next.width = currentW;
    next.height = currentH;
    const nextCtx = next.getContext('2d')!;
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.imageSmoothingQuality = 'high';
    nextCtx.drawImage(currentCanvas, 0, 0, currentW, currentH);
    currentCanvas = next;
  }

  // 最后一步到目标尺寸
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetW;
  finalCanvas.height = targetH;
  const finalCtx = finalCanvas.getContext('2d')!;
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  finalCtx.drawImage(currentCanvas, 0, 0, targetW, targetH);
  return finalCanvas.toDataURL('image/png');
}
