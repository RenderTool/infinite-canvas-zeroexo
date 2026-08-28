/**
 * types - 资产库模块类型定义
 */

import type { Prompt } from './prompts-api.js';

/** 内容类型（hierarchy = 画布节点注册进资产面板的分组,征集 #87 验收轮九） */
export type ContentType = 'all' | 'asset' | 'prompt' | 'script' | 'hierarchy';

/** 层级分组条目（画布节点平铺项，由调用方从画布 store 转换传入） */
export interface HierarchyLibraryItem {
  id: string;
  title: string;
  /** 节点类型（image/video/text/group/…，卡片显示类型标签用） */
  nodeType: string;
  /** 媒体内容存储键（卡片封面用） */
  storageKey?: string;
  /** 媒体内容 URL/blob（封面回退用） */
  content?: string;
}

/** 资产类型筛选（favorite 表示仅看收藏） */
export type AssetKindFilter = 'all' | 'favorite' | 'image' | 'video' | 'audio' | 'text' | 'zeroexo-text';

/** 页面列表项（统一分页用） */
export type PageItem =
  | { type: 'prompt'; data: Prompt }
  | { type: 'asset'; data: any }
  | { type: 'hierarchy'; data: HierarchyLibraryItem };

/** 删除确认状态 */
export interface ConfirmDeleteState {
  type: 'prompt' | 'asset';
  id: string;
  name: string;
}

/** 重命名目标 */
export interface RenameItemTarget {
  type: 'prompt' | 'asset';
  id: string;
}

/** 分类筛选映射 */
export interface CategoryFilter {
  contentType: ContentType;
  assetKind: AssetKindFilter;
}

/** 发送到画布的数据 */
export interface SendToCanvasItem {
  type: 'asset' | 'prompt' | 'script';
  id: string;
  data: any;
}