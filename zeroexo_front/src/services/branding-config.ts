/**
 * branding-config - 品牌/站点配置服务
 *
 * 从后端获取品牌配置(如首页视频轮播、Logo、标题等),
 * 支持后端动态下发,无需前端重新打包即可更新门户素材。
 *
 * 支持多视频轮播:
 * - heroVideos: 视频列表,按顺序播放
 *
 * 优先级:
 *   1. 后端接口 GET /api/branding (如果可用)
 *   2. window.env.BRANDING_CONFIG (runtime-config.js 注入)
 *   3. 内置默认值
 */

import { getApiBaseUrl } from './api-client.js';

// 使用类型声明合并扩展 Window 类型
// 内联定义避免与全局 Window.env 冲突

/** 单个视频配置 */
export interface HeroVideoItem {
  /** 视频 URL */
  url: string;
  /** 该视频的专属回退图片(可选,无则使用全局回退) */
  image?: string | null;
  /** 标签(管理后台识别用) */
  label?: string;
  /** 是否启用 */
  enabled?: boolean;
}

export interface BrandingConfig {
  /** 视频列表(按顺序播放) */
  heroVideos: HeroVideoItem[];
  /** 全局回退图片(视频列表为空或均加载失败时显示) */
  heroFallbackImage: string | null;
}

/** 默认配置 */
const DEFAULT_CONFIG: BrandingConfig = {
  heroVideos: [],
  heroFallbackImage: '/api/storage/get?key=resources/public/branding/fallback/hero-fallback.webp',
};

/**
 * 将绝对 URL 转为相对路径,确保视频/图片资源通过 Vite proxy 访问
 * 例如: http://localhost:3000/api/storage/get?key=xxx → /api/storage/get?key=xxx
 */
function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // 只返回 pathname + search,去掉 origin,强制走本地代理
    return parsed.pathname + parsed.search;
  } catch {
    // 已经是相对路径或无效 URL,原样返回
    return url;
  }
}

/** 向后兼容:确保配置总是包含新字段,并规范化所有 URL */
function normalizeConfig(raw: Partial<BrandingConfig> | null | undefined): BrandingConfig {
  const base = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  base.heroFallbackImage = normalizeUrl(base.heroFallbackImage);
  // 确保 heroVideos 存在且是数组,并规范化其中每个 URL 和 image
  if (!Array.isArray(base.heroVideos)) {
    base.heroVideos = [];
  }
  base.heroVideos = base.heroVideos
    .filter((v) => v != null)
    .map((v) => ({
      ...v,
      url: normalizeUrl(v.url) ?? '',
      image: normalizeUrl(v.image),
    }));
  return base;
}

/** 模块级缓存 */
let cachedConfig: BrandingConfig | null = null;
let loadingPromise: Promise<BrandingConfig> | null = null;
let initialized = false;

/**
 * 从后端加载品牌配置
 * 首次调用会请求后端,后续调用返回缓存
 */
export async function loadBrandingConfig(): Promise<BrandingConfig> {
  if (cachedConfig) return cachedConfig;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // 1. 先尝试 window.env 配置 (runtime-config.js)
    const envConfig = (window as any).env?.BRANDING_CONFIG as Partial<BrandingConfig> | undefined;
    if (envConfig && Object.keys(envConfig).length > 0) {
      cachedConfig = normalizeConfig(envConfig);
      initialized = true;
      return cachedConfig;
    }

    // 2. 尝试从后端拉取
    try {
      const res = await fetch(`${getApiBaseUrl()}/branding`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        const raw = (data as { data?: Partial<BrandingConfig> })
          .data ?? data as Partial<BrandingConfig>;
        cachedConfig = normalizeConfig(raw);
        initialized = true;
        return cachedConfig;
      }
    } catch {
      // 后端不可用时静默降级
    }

    // 3. 使用默认值
    cachedConfig = normalizeConfig(null);
    initialized = true;
    return cachedConfig;
  })();

  return loadingPromise;
}

/**
 * 获取当前品牌配置(不触发加载,如果已加载)
 */
export function getBrandingConfig(): BrandingConfig {
  return cachedConfig ?? normalizeConfig(null);
}

/**
 * 是否已初始化
 */
export function isBrandingConfigInitialized(): boolean {
  return initialized;
}

/**
 * 重置配置(用于热更新或测试)
 */
export function resetBrandingConfig(): void {
  cachedConfig = null;
  loadingPromise = null;
  initialized = false;
}

/**
 * React Hook: 获取品牌配置,自动异步加载
 */
export function useBrandingConfig(): BrandingConfig & { loading: boolean } {
  const config = getBrandingConfig();
  // 异步触发加载(不阻塞渲染)
  if (!initialized && !loadingPromise) {
    loadBrandingConfig();
  }
  return { ...config, loading: !initialized };
}