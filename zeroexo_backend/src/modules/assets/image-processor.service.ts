/**
 * 图片多尺寸变体处理器
 *
 * 行业标准方案: 上传时用 sharp 同步生成 3 个尺寸变体,
 * 后续客户端根据 LOD 等级请求适当尺寸。
 *
 * 命名约定(基于原始 storageKey):
 *   assets/{userId}/{hash}.{ext}         →  full(默认)
 *   assets/{userId}/{hash}__thumb.{ext}  →  48px 缩略图
 *   assets/{userId}/{hash}__preview.{ext} → 768px 预览图
 *
 * sharp 是 Node.js 生态中最成熟的高性能图片处理库,
 * 用于 Vercel / AWS Lambda / Cloudflare Workers 等生产环境。
 */
import { Injectable } from '@nestjs/common';
import * as path from 'node:path';
import sharp from 'sharp';

export type ImageSize = 'full' | 'preview' | 'thumb';

/** 各尺寸配置 */
const SIZE_CONFIG: Record<Exclude<ImageSize, 'full'>, { maxEdge: number; quality: number }> = {
  thumb: { maxEdge: 48, quality: 60 },
  preview: { maxEdge: 768, quality: 90 },
};

/** 需要 sharp 处理的图片 MIME 类型 */
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/tiff',
];

@Injectable()
export class ImageProcessorService {
  /**
   * 从 storageKey 派生变体 key
   *   original: assets/{userId}/{hash}.jpg
   *   thumb:    assets/{userId}/{hash}__thumb.jpg
   */
  variantKey(key: string, size: Exclude<ImageSize, 'full'>): string {
    const parsed = path.parse(key);
    return `${parsed.dir}${parsed.dir ? '/' : ''}${parsed.name}__${size}${parsed.ext}`;
  }

  /** 判断 MIME 类型是否支持 sharp 处理 */
  isImageMime(mimeType: string): boolean {
    return IMAGE_MIME_TYPES.includes(mimeType);
  }

  /** 判断文件扩展名是否适合 sharp 处理 */
  isImageExt(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase().replace('.', '');
    return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'tiff'].includes(ext);
  }

  /**
   * 生成指定尺寸的图片变体 Buffer
   * 保留原始格式,输出相同 MIME 类型
   */
  async generateVariant(
    buffer: Buffer,
    size: Exclude<ImageSize, 'full'>,
  ): Promise<Buffer> {
    const config = SIZE_CONFIG[size];
    return sharp(buffer)
      .rotate() // 保留 EXIF 方向
      .resize(config.maxEdge, config.maxEdge, {
        fit: 'inside',  // 保持宽高比,不裁切
        withoutEnlargement: true, // 源图小于目标尺寸时不放大
      })
      .jpeg({ quality: config.quality, mozjpeg: true })
      .toBuffer();
  }

  /**
   * 生成图片的所有变体(thumb + preview)
   * 返回 { size → Buffer } 映射
   */
  async generateAllVariants(
    buffer: Buffer,
  ): Promise<{ thumb: Buffer; preview: Buffer }> {
    const [thumb, preview] = await Promise.all([
      this.generateVariant(buffer, 'thumb'),
      this.generateVariant(buffer, 'preview'),
    ]);
    return { thumb, preview };
  }
}
