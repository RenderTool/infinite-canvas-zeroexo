/**
 * 资源分类配置服务 — 从后端 API 获取分类配置并缓存
 *
 * 前端所有资源管理页面通过此服务拉取配置，
 * 确保前后端分类规则完全一致。
 */
import { apiGet } from './api-client';

/** 资源分类配置结构（与后端共享） */
export interface ResourceColumn {
  key: string;
  title: string;
  width?: number;
  render?: 'image' | 'tag' | 'tags' | 'source-tag' | 'text' | 'date' | 'actions';
  hidden?: boolean;
}

export interface ResourceFilterOption {
  value: string;
  label: string;
}

export interface ResourceFilter {
  key: string;
  label: string;
  type: 'select';
  options: ResourceFilterOption[];
}

export interface ResourceCategoryDisplay {
  label: string;
  icon: string;
  emptyText: string;
}

export interface ResourceCategory {
  key: string;
  display: ResourceCategoryDisplay;
  columns: ResourceColumn[];
  filters?: ResourceFilter[];
}

export interface ClassificationConfig {
  categories: ResourceCategory[];
}

// 内存缓存（页面级）
let cachedConfig: ClassificationConfig | null = null;

/** 从后端拉取分类配置 */
export async function fetchClassificationConfig(): Promise<ClassificationConfig> {
  if (cachedConfig) return cachedConfig;
  const config = await apiGet<ClassificationConfig>('/admin/resource-classification');
  cachedConfig = config;
  return config;
}

/** 根据 category key 获取分类配置 */
export async function getCategoryConfig(categoryKey: string): Promise<ResourceCategory | undefined> {
  const config = await fetchClassificationConfig();
  return config.categories.find((c) => c.key === categoryKey);
}

/** 清空缓存（用于刷新） */
export function clearConfigCache() {
  cachedConfig = null;
}
