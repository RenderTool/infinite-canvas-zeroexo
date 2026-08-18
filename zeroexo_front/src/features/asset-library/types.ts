/**
 * types - 资产库模块类型定义
 */

import type { Subject } from './subjects-api.js';
import type { Prompt } from './prompts-api.js';

/** 内容类型 */
export type ContentType = 'all' | 'asset' | 'prompt' | 'subject' | 'script';

/** 主体类型筛选（favorite 表示仅看收藏） */
export type SubjectTypeFilter = 'all' | 'favorite' | 'character' | 'scene' | 'prop';

/** 资产类型筛选（favorite 表示仅看收藏） */
export type AssetKindFilter = 'all' | 'favorite' | 'image' | 'video' | 'audio' | 'text' | 'zeroexo-text';

/** 页面列表项（统一分页用） */
export type PageItem =
  | { type: 'subject'; data: Subject }
  | { type: 'prompt'; data: Prompt }
  | { type: 'asset'; data: any };

/** 删除确认状态 */
export interface ConfirmDeleteState {
  type: 'subject' | 'prompt' | 'asset';
  id: string;
  name: string;
}

/** 重命名目标 */
export interface RenameItemTarget {
  type: 'subject' | 'prompt' | 'asset';
  id: string;
}

/** 分类筛选映射 */
export interface CategoryFilter {
  contentType: ContentType;
  subjectType: SubjectTypeFilter;
  assetKind: AssetKindFilter;
}

/** 发送到画布的数据 */
export interface SendToCanvasItem {
  type: 'asset' | 'prompt' | 'subject' | 'script';
  id: string;
  data: any;
}