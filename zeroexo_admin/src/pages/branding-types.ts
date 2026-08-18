/**
 * 品牌配置类型定义 - 与前端 branding-config.ts 保持一致
 */

/** 单个视频配置 */
export interface HeroVideoItem {
  /** 视频 URL */
  url: string;
  /** 该视频的专属回退图片(可选) */
  image?: string | null;
  /** 标签(管理后台识别用) */
  label?: string;
  /** 是否启用 */
  enabled?: boolean;
}

export interface BrandingConfig {
  /** 视频列表(按顺序播放) */
  heroVideos: HeroVideoItem[];
  /** 全局回退图片 */
  heroFallbackImage: string | null;
}

export const DEFAULT_BRANDING_CONFIG: BrandingConfig = {
  heroVideos: [],
  heroFallbackImage: '/images/hero-fallback.webp',
};