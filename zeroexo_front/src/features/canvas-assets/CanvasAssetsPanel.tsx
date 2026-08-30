/**
 * canvas-assets/CanvasAssetsPanel - 画布资产抽屉内容（2026-08-30 用户拍板：与主页资产库独立架构）
 *
 * 结构：容器（分组 Tab + 共享弹窗）+ 各分组组件（纯渲染）。
 * 数据来源：useCanvasAssetsPanel（数据驱动唯一来源）。
 * 展示组件：分组内复用 shared 组件；层级分组复用 HierarchyListView。
 */

import { useTranslation } from 'react-i18next';
import { BookOpen, FileText, Layers, Package } from 'lucide-react';
import { Modal } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import { useCanvasAssetsPanel } from './store.js';
import { SidebarNav, SearchBox, ToolbarRow } from './components/common.js';
import { PromptGroup } from './groups/PromptGroup.js';
import { MaterialGroup } from './groups/MaterialGroup.js';
import { ScriptGroup } from './groups/ScriptGroup.js';
import { HierarchyListView } from '@/features/hierarchy/components/hierarchy-list-view.js';
import type { HierarchyListDataProps } from '@/features/hierarchy/components/hierarchy-list-view.js';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { SendToCanvasItem } from './store.js';

export interface CanvasAssetsPanelProps {
  theme: ThemeConfig;
  /** 层级分组视图（复用既有树形列表） */
  hierarchyListView?: {
    store: ReactGraphStore;
    data: HierarchyListDataProps;
    onFocusNode?: (nodeId: string) => void;
  };
  /** 发送到画布（编辑器接线） */
  onSendToCanvas?: (item: SendToCanvasItem) => void;
}

export function CanvasAssetsPanel({ theme, hierarchyListView, onSendToCanvas }: CanvasAssetsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const store = useCanvasAssetsPanel({ onSendToCanvas });

  const tabItems = [
    // 2026-08-31 用户拍板：资产抽屉图标统一 18px（sidebar 按钮 / 卡片图标 / 播放按钮一致）
    { key: 'hierarchy', label: t('hierarchy.tabHierarchy'), icon: <Layers size={18} /> },
    { key: 'material', label: t('assetLibrary.filterMaterial'), icon: <Package size={18} /> },
    { key: 'prompt', label: t('assetLibrary.filterPrompt'), icon: <FileText size={18} /> },
    { key: 'script', label: t('assetLibrary.filterScript'), icon: <BookOpen size={18} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
      <SidebarNav items={tabItems} active={store.activeGroup} onChange={(k) => store.changeGroup(k as any)} theme={theme} />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
        {store.activeGroup === 'hierarchy' && hierarchyListView ? (
          <>
            {/* 搜索统一在标签下方 */}
            <ToolbarRow>
              <SearchBox value={store.search} onChange={store.setSearch} placeholder={t('assetLibrary.searchPlaceholder')} theme={theme} />
            </ToolbarRow>
            <HierarchyListView
              theme={theme}
              store={hierarchyListView.store}
              data={hierarchyListView.data}
              onFocusNode={hierarchyListView.onFocusNode}
              search={store.search}
              multiSelectEnabled={false}
              onMultiSelectToggle={() => undefined}
              typeFilter="all"
              onTypeFilterChange={() => undefined}
            />
          </>
        ) : store.activeGroup === 'material' ? (
          <MaterialGroup store={store} theme={theme} />
        ) : store.activeGroup === 'prompt' ? (
          <PromptGroup store={store} theme={theme} />
        ) : store.activeGroup === 'script' ? (
          <ScriptGroup store={store} theme={theme} />
        ) : null}
      </div>

      {/* 删除确认（提示词/素材共用） */}
      <Modal
        title={t('assetLibrary.confirmDeleteTitle', { defaultValue: '删除确认' })}
        open={!!store.confirmDelete}
        onCancel={() => store.setConfirmDelete(null)}
        onOk={() => void store.handleConfirmDelete()}
        okText={t('common.confirm', { defaultValue: '确认' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
        okButtonProps={{ danger: true }}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
        destroyOnHidden
      >
        <p style={{ fontSize: 13, color: theme.toolbar.text, margin: 0 }}>
          {t('assetLibrary.confirmDeleteItem', { defaultValue: '确定删除「' })}{store.confirmDelete?.name ?? ''}{t('assetLibrary.confirmDeleteSuffix', { defaultValue: '」吗？' })}
        </p>
      </Modal>
    </div>
  );
}
