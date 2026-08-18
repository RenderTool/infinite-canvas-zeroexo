/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetContent - 资产内容区
 *
 * 整合视图切换按钮、搜索框、筛选 chip、排序按钮等工具栏元素，
 * 并根据视图模式渲染网格或列表视图。
 */

import { Search, Grid3X3, List, Loader2 } from 'lucide-react';
import type { ContentProps } from './types.js';
import { createStyles } from './styles.js';
import { AssetGrid } from './asset-grid.js';
import { AssetList } from './asset-list.js';
import { useTranslation } from 'react-i18next';

const STATUS_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'all', labelKey: 'assetContent.statusAll' },
  { value: 'active', labelKey: 'assetBrowser.statusActive' },
  { value: 'draft', labelKey: 'assetBrowser.statusDraft' },
  { value: 'archived', labelKey: 'assetBrowser.statusArchived' },
];

export function AssetContent({
  viewMode,
  filteredAssets,
  keyword,
  statusFilter,
  onViewModeChange,
  onKeywordChange,
  onStatusFilterChange,
  onInsert,
  onSelect,
  selectedAsset,
  theme,
  loading,
}: ContentProps): React.ReactElement {
  const s = createStyles(theme);
  const { t } = useTranslation();

  return (
    <div style={s.contentArea()}>
      {/* 工具栏 */}
      <div style={s.contentToolbar()}>
        {/* 视图切换 */}
        <div style={s.viewToggle()}>
          <button
            type="button"
            style={s.viewBtn(viewMode === 'grid')}
            onClick={() => onViewModeChange('grid')}
            title={t('assetContent.gridView')}
          >
            <Grid3X3 size={14} />
          </button>
          <button
            type="button"
            style={s.viewBtn(viewMode === 'list')}
            onClick={() => onViewModeChange('list')}
            title={t('assetContent.listView')}
          >
            <List size={14} />
          </button>
        </div>

        {/* 搜索框 */}
        <div style={s.searchWrap()}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: theme.toolbar.textMuted,
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            style={s.searchInput()}
            placeholder={t('assetContent.searchPlaceholder')}
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
          />
        </div>

        {/* 状态筛选 Chip */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
          {STATUS_OPTIONS.filter((o) => o.value !== 'all').map((opt) => (
            <button
              key={opt.value}
              type="button"
              style={s.filterChip(statusFilter === opt.value)}
              onClick={() => onStatusFilterChange(statusFilter === opt.value ? 'all' : opt.value)}
            >
              {t(opt.labelKey)}
              {statusFilter === opt.value && (
                <span style={{ marginLeft: 2, fontSize: 10, opacity: 0.7 }}>x</span>
              )}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted, whiteSpace: 'nowrap' }}>
            {t('assetLibrary.itemsCount', { count: filteredAssets.length })}
          </span>
        </div>
      </div>

      {/* 资产列表 / 网格 */}
      <div style={s.assetScroll()}>
        {loading ? (
          <div style={s.loadingOverlay()}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : viewMode === 'grid' ? (
          <AssetGrid
            assets={filteredAssets}
            onInsert={onInsert}
            onSelect={onSelect}
            selectedAsset={selectedAsset}
            theme={theme}
          />
        ) : (
          <AssetList
            assets={filteredAssets}
            onInsert={onInsert}
            onSelect={onSelect}
            selectedAsset={selectedAsset}
            theme={theme}
          />
        )}
      </div>
    </div>
  );
}