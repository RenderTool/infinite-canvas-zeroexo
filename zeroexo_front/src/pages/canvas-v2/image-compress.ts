/**
 * 图片输入克制压缩（Plan#26 · 用户决策 2026-08-21）
 *
 * 画布绝不加载原图：上传即压缩（长边上限 IMAGE_MAX_EDGE，统一转码 WebP 保留透明），
 * 画布纹理只消费压缩产物；原图仅下载/详情 modal 按需取（后续功能，本模块不持有原图）。
 * 缩放质量由 GPU 天然 mipmap 采样保证（不做 DOM 层缩放分级反优化）。
 */

export const IMAGE_MAX_EDGE = 2048; // 克制上限：长边 ≤ 2K（POT，mipmap 完整）
export const IMAGE_QUALITY = 0.92; // WebP 有损质量（保留透明通道；接近无损观感，克制的是像素上限而非极限压码率）

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** 解码 + 降采样 + 统一转码；小图不放大，仅重编码剥离元数据（Exif/GPS 等） */
export async function compressImageFile(file: Blob): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // 显式 sRGB 输出（与 three.js 纹理 SRGBColorSpace 一致，避免设备色域差异导致的偏色）
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('canvas 2d context unavailable');
    // 高质量降采样：避免摩尔纹/锯齿被误判为"颜色变化"
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { blob: await encodeBlob(canvas), width, height };
  } finally {
    bitmap.close();
  }
}

/** WebP（保留透明）→ JPEG → PNG 兜底 */
async function encodeBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await toBlob(canvas, 'image/webp', IMAGE_QUALITY);
  if (webp) return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg', IMAGE_QUALITY);
  if (jpeg) return jpeg;
  const png = await toBlob(canvas, 'image/png');
  if (png) return png;
  throw new Error('image encode failed');
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
