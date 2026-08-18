/**
 * asset-library-list-view - 资产库列表视图
 *
 * 通过 Card Registry 统一调度各类型行渲染器，
 * 新增类型只需注册卡片，无需修改此组件。
 */

import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { getCardRenderer } from '../cards/card-registry.js';
import { listContainerStyle, listHeaderStyle, listRowStyle } from '../asset-library-styles.js';
import type { PageItem, ContentType } from '../types.js';

interface AssetLibraryListViewProps {
  pageItems: PageItem[];
  theme: ThemeConfig;

  onOpenItem: (item: PageItem) => void;
}

export function AssetLibraryListView({
  pageItems,
  theme,
  onOpenItem,
}: AssetLibraryListViewProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div style={listContainerStyle()}>
      {/* 列表表头 */}
      <div style={listHeaderStyle(theme)}>
        <span style={{ width: '40%', minWidth: 0 }}>名称</span>
        <span style={{ width: '20%', minWidth: 0 }}>类型</span>
        <span style={{ width: '20%', minWidth: 0 }}>大小</span>
        <span style={{ width: '20%', minWidth: 0 }}>修改时间</span>
      </div>
      {pageItems.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <span style={{ color: theme.toolbar.textMuted, fontSize: 13 }}>
            {t('assetLibrary.empty')}
          </span>
        </div>
      ) : (
        pageItems.map((item) => {
          const renderer = getCardRenderer(item.type as ContentType);
          if (!renderer) return null;

          return (
            <div key={`${item.type}-${item.data.id}`} style={listRowStyle(theme)}>
              {(() => {
                const ListComponent = renderer.renderList;
                return (
                  <ListComponent
                    item={item.data}
                    onClick={() => onOpenItem(item)}
                    theme={theme}
                    t={t}
                  />
                );
              })()}
            </div>
          );
        })
      )}
    </div>
  );
}