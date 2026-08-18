import type { ImageMeta } from '../types.js';

/**
 * 读取图片元信息(宽高)
 */
export function readImageMeta(dataUrl: string): Promise<ImageMeta> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

/** 加载 Image 对象(内部复用) */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}
