/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetBrowser - 类型定义
 */

import type { CSSProperties, ReactNode } from 'react';

/** 资产分类分组（hierarchy = 画布节点注册进资产面板的分组,征集 #87 验收轮九） */
export type AssetCategoryGroup = 'character' | 'prop' | 'scene' | 'prompt' | 'material' | 'subject' | 'script' | 'hierarchy';

/** 资产分类子项 */
export interface AssetCategoryChild {
  key: string;
  label: string;
  icon?: string;
  count?: number;
}

/** 资产分类分组（含子分类） */
export interface AssetCategory {
  group: AssetCategoryGroup;
  label: string;
  icon: ReactNode;
  color: string;
  count: number;
  children: AssetCategoryChild[];
}

/** 资产数据项（与 asset-picker 中的 Asset 类型对齐） */
export interface AssetItem {
  id: string;
  title: string;
  kind: 'text' | 'image' | 'video' | 'audio';
  status?: 'active' | 'draft' | 'archived';
  tags?: string[];
  refs?: number;
  updatedAt?: string;
  thumbnail?: string;
  type?: string; // 分类类型 character/prop/scene/prompt/material
  favorite?: boolean;
  // 额外元数据
  data?: {
    kind: string;
    dataUrl?: string;
    url?: string;
    storageKey?: string;
    content?: string;
    width?: number;
    height?: number;
  };
  bytes?: number;
  mimeType?: string;
  createdAt?: number;
  folderId?: string | null;
}

/** 视图模式 */
export type ViewMode = 'grid' | 'list';

/** 显示模式 */
export type BrowserMode = 'full' | 'compact' | 'minimal';

/** AssetBrowser 组件 Props */
export interface AssetBrowserProps {
  /** 显示模式 */
  mode: BrowserMode;
  /** 资产数据 */
  assets: AssetItem[];
  /** 插入资产回调（用于画布导入） */
  onInsert?: (asset: AssetItem) => void;
  /** 关闭回调 */
  onClose?: () => void;
  /** 主题对象 */
  theme: {
    mode: 'dark' | 'light';
    toolbar: {
      text: string;
      textMuted: string;
      border: string;
      background: string;
      accent: string;
      danger?: string;
    };
    canvas?: {
      background: string;
    };
  };
  /** 加载状态 */
  loading?: boolean;
  /** 自定义样式 */
  className?: string;
  style?: CSSProperties;
}

/** 分类侧边栏 Props */
export interface CategorySidebarProps {
  categories: AssetCategory[];
  activeGroup: AssetCategoryGroup | null;
  activeChild: string | null;
  collapsed: boolean;
  onGroupClick: (group: AssetCategoryGroup) => void;
  onChildClick: (group: AssetCategoryGroup, child: string) => void;
  onToggleCollapse: () => void;
  theme: AssetBrowserProps['theme'];
  /** 侧边栏圆角(画布 Modal 中需要,主页不需要) */
  sidebarBorderRadius?: number;
}

/** 内容区 Props */
export interface ContentProps {
  viewMode: ViewMode;
  assets: AssetItem[];
  filteredAssets: AssetItem[];
  keyword: string;
  statusFilter: string;
  onViewModeChange: (mode: ViewMode) => void;
  onKeywordChange: (keyword: string) => void;
  onStatusFilterChange: (filter: string) => void;
  onInsert?: (asset: AssetItem) => void;
  onSelect?: (asset: AssetItem) => void;
  selectedAsset: AssetItem | null;
  theme: AssetBrowserProps['theme'];
  loading?: boolean;
}

/** 网格视图 Props */
export interface GridViewProps {
  assets: AssetItem[];
  onInsert?: (asset: AssetItem) => void;
  onSelect?: (asset: AssetItem) => void;
  onDelete?: (asset: AssetItem) => void;
  onRename?: (asset: AssetItem, title: string) => void;
  onExport?: (asset: AssetItem) => void;
  onToggleFavorite?: (asset: AssetItem) => void;
  selectedAsset: AssetItem | null;
  theme: AssetBrowserProps['theme'];
}

/** 列表视图 Props */
export interface ListViewProps {
  assets: AssetItem[];
  onInsert?: (asset: AssetItem) => void;
  onSelect?: (asset: AssetItem) => void;
  selectedAsset: AssetItem | null;
  theme: AssetBrowserProps['theme'];
}

/** 上下文面板 Props */
export interface ContextPanelProps {
  asset: AssetItem | null;
  onClose: () => void;
  theme: AssetBrowserProps['theme'];
}