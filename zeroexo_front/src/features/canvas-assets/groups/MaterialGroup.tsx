/**
 * canvas-assets/groups/MaterialGroup - 画布资产抽屉「素材」分组
 *
 * 数据驱动：数据/actions 来自 store。
 * 卡片渲染复用主页素材卡片 AssetCardGrid（2026-08-30 用户要求 UI 组件可复用，禁止另起一套卡片样式）。
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Modal } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import { AssetCardGrid } from '@/features/asset-library/cards/asset-card.js';
import { AssetDetailViewer } from '@/shared/components/asset-detail-viewer.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { AddTile, CategoryChips, EmptyState, SearchBox, SkeletonGrid, ToolbarRow } from '../components/common.js';

const KIND_OPTIONS = [
  { key: 'all', labelKey: 'assetLibrary.filterAll' },
  { key: 'image', labelKey: 'assetLibrary.filterImage' },
  { key: 'video', labelKey: 'assetLibrary.filterVideo' },
  { key: 'audio', labelKey: 'assetLibrary.filterAudio' },
  { key: 'text', labelKey: 'assetLibrary.filterText' },
];

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  // 2026-08-31 用户拍板：卡片有最小宽度，容器不足最小尺寸后降为单格（1 列）
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))',
  gap: 16,
  alignContent: 'start',
  padding: '0 20px 16px',
};

export function MaterialGroup({ store, theme }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const {
    assets, loadingAssets, materialKind, setMaterialKind,
    search, setSearch, handleUpload,
    setAssetDetail, setConfirmDelete,
    setRenameItemTarget, setRenameItemOpen, handleDownloadItem, sendToCanvas,
  } = store;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 文本类素材「编辑 → 保存」态
  const isTextAsset = store.assetDetail?.data?.kind === 'text';
  const [textEditing, setTextEditing] = useState(false);
  const [textDraft, setTextDraft] = useState<string | null>(null);

  const kindOptions = KIND_OPTIONS.map((opt) => ({
    key: opt.key,
    label: t(opt.labelKey),
  }));

  return (
    <>
      <ToolbarRow>
        <CategoryChips
          items={kindOptions}
          active={materialKind}
          onChange={(k) => setMaterialKind((k ?? 'all') as any)}
          theme={theme}
        />
      </ToolbarRow>
      {/* 搜索统一在分类标签下方 */}
      <ToolbarRow style={{ paddingTop: 0 }}>
        <SearchBox value={search} onChange={setSearch} placeholder={t('assetLibrary.searchPlaceholder')} theme={theme} />
      </ToolbarRow>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loadingAssets && assets.length === 0 ? (
          <SkeletonGrid theme={theme} />
        ) : assets.length === 0 ? (
          <EmptyState theme={theme} />
        ) : (
          <div style={GRID_STYLE}>
            {assets.map((asset) => (
              <AssetCardGrid
                key={asset.id}
                item={asset}
                selected={false}
                multiSelectEnabled={false}
                onToggleSelect={() => undefined}
                onOpen={() => setAssetDetail(asset)}
                onRename={() => { setRenameItemTarget({ type: 'asset', id: asset.id, name: asset.title }); setRenameItemOpen(true); }}
                onDelete={() => setConfirmDelete({ type: 'asset', id: asset.id, name: asset.title })}
                onDownload={() => void handleDownloadItem({ type: 'asset', data: asset })}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onSendToCanvas={() => sendToCanvas({ type: 'asset', id: asset.id, data: asset })}
                theme={theme}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
        <AddTile label={t('assetLibrary.uploadMaterial', { defaultValue: '上传素材' })} onClick={() => fileInputRef.current?.click()} theme={theme} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,text/plain,.txt,.md"
        style={{ display: 'none' }}
        onChange={(e) => { if (e.target.files) void handleUpload(e.target.files); e.target.value = ''; }}
      />

      {/* 素材详情（复用 shared 查看器；文本类可「编辑 → 保存」） */}
      {store.assetDetail && (
        <AssetDetailViewer
          asset={store.assetDetail}
          onClose={() => { setAssetDetail(null); setTextEditing(false); setTextDraft(null); }}
          editable={isTextAsset}
          editing={textEditing}
          onEditingChange={(v) => {
            setTextEditing(v);
            setTextDraft(v ? (store.assetDetail?.data?.content ?? '') : null);
          }}
          onSave={async () => {
            if (textDraft === null) { setTextEditing(false); return; }
            const cur = store.assetDetail;
            if (!cur?.id) return;
            const next = { ...cur, data: { ...cur.data, content: textDraft } };
            await store.updateAsset(cur.id, { data: next.data });
            setAssetDetail(next);
            setTextEditing(false);
            setTextDraft(null);
          }}
          onContentChange={setTextDraft}
        />
      )}

      {/* 重命名弹窗（素材/提示词共用） */}
      <Modal
        title={t('assetLibrary.renameTitle', { defaultValue: '重命名' })}
        open={store.renameItemOpen}
        onCancel={() => store.setRenameItemOpen(false)}
        onOk={() => void store.handleRenameItem()}
        okText={t('common.confirm', { defaultValue: '确认' })}
        cancelText={t('common.cancel', { defaultValue: '取消' })}
        centered
        width="calc(100vw - 32px)"
        style={{ maxWidth: 420 }}
        destroyOnHidden
      >
        <Input
          value={store.renameItemName}
          onChange={(e) => store.setRenameItemName(e.target.value)}
          placeholder={t('assetLibrary.renamePlaceholder', { defaultValue: '请输入新名称' })}
          maxLength={50}
          autoFocus
          onPressEnter={() => void store.handleRenameItem()}
        />
      </Modal>
    </>
  );
}
