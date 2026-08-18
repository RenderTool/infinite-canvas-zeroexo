/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetBrowser - 资产浏览器主组件
 *
 * 整合分类侧边栏 + 资产内容区 + 上下文面板。
 * 支持三种显示模式：full（完整布局）、compact（无上下文面板）、minimal（仅内容区）。
 *
 * 使用方式：
 * ```tsx
 * <AssetBrowser
 *   mode="full"
 *   assets={assets}
 *   categories={categories}
 *   onInsert={(asset) => console.log('insert', asset)}
 *   theme={theme}
 * />
 * ```
 */

import { useState, useMemo, useCallback } from 'react';
import { createStyles } from './styles.js';
import { AssetCategorySidebar } from './asset-category-sidebar.js';
import { AssetContent } from './asset-content.js';
import { AssetContextPanel } from './asset-context-panel.js';
import type { AssetBrowserProps, AssetCategory, AssetItem, AssetCategoryGroup, ViewMode } from './types.js';

export { AssetCategorySidebar } from './asset-category-sidebar.js';
export { AssetGrid } from './asset-grid.js';
export { AssetList } from './asset-list.js';
export { AssetContent } from './asset-content.js';
export { AssetContextPanel } from './asset-context-panel.js';
export type * from './types.js';

export function AssetBrowser({
  mode,
  assets: allAssets,
  categories,
  onInsert,
  theme,
  loading,
  className,
  style,
}: AssetBrowserProps & { categories: AssetCategory[] }): React.ReactElement {
  const s = createStyles(theme);

  // 侧边栏折叠状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 视图模式
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // 活跃分类
  const [activeGroup, setActiveGroup] = useState<AssetCategoryGroup | null>(null);
  const [activeChild, setActiveChild] = useState<string | null>(null);

  // 搜索关键词
  const [keyword, setKeyword] = useState('');

  // 状态筛选
  const [statusFilter, setStatusFilter] = useState('all');

  // 选中资产
  const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);

  /** 分类切换 */
  const handleGroupClick = useCallback((group: AssetCategoryGroup) => {
    setActiveGroup((prev) => (prev === group ? null : group));
    setActiveChild(null);
  }, []);

  const handleChildClick = useCallback((group: AssetCategoryGroup, child: string) => {
    setActiveGroup(group);
    setActiveChild(child);
  }, []);

  /** 根据分类筛选资产 */
  const filteredAssets = useMemo(() => {
    let result = allAssets;

    // 按分类筛选
    if (activeGroup) {
      result = result.filter((a) => a.type === activeGroup);
    }

    // 按关键词搜索
    if (keyword.trim()) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(kw) ||
          a.tags?.some((t) => t.toLowerCase().includes(kw)),
      );
    }

    // 按状态筛选
    if (statusFilter !== 'all') {
      result = result.filter((a) => a.status === statusFilter);
    }

    return result;
  }, [allAssets, activeGroup, keyword, statusFilter]);

  /** 选中资产 */
  const handleSelect = useCallback((asset: AssetItem) => {
    setSelectedAsset(asset);
  }, []);

  /** 关闭上下文面板 */
  const handleCloseContext = useCallback(() => {
    setSelectedAsset(null);
  }, []);

  /** 切换侧边栏折叠 */
  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  return (
    <div style={{ ...s.container(), ...(className ? {} : {}), ...style }} className={className}>
      {/* 分类侧边栏 */}
      <AssetCategorySidebar
        categories={categories}
        activeGroup={activeGroup}
        activeChild={activeChild}
        collapsed={sidebarCollapsed}
        onGroupClick={handleGroupClick}
        onChildClick={handleChildClick}
        onToggleCollapse={handleToggleCollapse}
        theme={theme}
      />

      {/* 资产内容区 */}
      <AssetContent
        viewMode={viewMode}
        assets={allAssets}
        filteredAssets={filteredAssets}
        keyword={keyword}
        statusFilter={statusFilter}
        onViewModeChange={setViewMode}
        onKeywordChange={setKeyword}
        onStatusFilterChange={setStatusFilter}
        onInsert={onInsert}
        onSelect={handleSelect}
        selectedAsset={selectedAsset}
        theme={theme}
        loading={loading}
      />

      {/* 上下文详情面板（仅 full 模式） */}
      {mode === 'full' && (
        <AssetContextPanel
          asset={selectedAsset}
          onClose={handleCloseContext}
          theme={theme}
        />
      )}
    </div>
  );
}