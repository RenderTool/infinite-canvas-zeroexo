/**
 * AssetLibraryPage - 资产库主页（编排层）
 *
 * 职责：组合子组件，传递数据，不包含业务逻辑。
 * 业务逻辑已抽离到 use-asset-library hook。
 * 卡片渲染已抽离到 cards/ 目录（Card Registry 策略模式）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Pagination, Tooltip } from 'antd';
import { X } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { pageStyle, layoutBodyStyle, contentAreaStyle } from './asset-library-styles.js';
import { useAssetLibrary } from './use-asset-library.js';
import type { AssetKindFilter } from './types.js';

// 导入卡片注册表（side-effect import 触发所有卡片注册）
import './cards/index.js';

// 导入子组件
import { AssetLibraryToolbar } from './components/asset-library-toolbar.js';
import { AssetLibraryGridView } from './components/asset-library-grid-view.js';
import { AssetLibraryListView } from './components/asset-library-list-view.js';
import { AssetLibraryModals } from './components/asset-library-modals.js';
import type { PageItem } from './types.js';
import type { ContextMenuItem } from '@/shared/components/index.js';

export interface AssetLibraryPageProps {
  onNavigateHome?: () => void;
  onOpenAppearance?: () => void;
  onSendToCanvas?: (item: { type: 'asset' | 'prompt' | 'script'; id: string; data: any }) => void;
  sidebarRadius?: number;
  defaultAssetKind?: AssetKindFilter;
  /** 进入资产库时默认激活的分组（如 prompt） */
  defaultGroup?: string;
  /** 进入资产库时默认激活的子分类（如 favorite） */
  defaultChild?: string;
  /** 需要聚焦高亮的卡片 id（复制提示词后跳转定位） */
  focusId?: string;
}

export function AssetLibraryPage(props: AssetLibraryPageProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isMobile = useIsMobile();

  const ctx = useAssetLibrary({ ...props, defaultGroup: props.defaultGroup, defaultChild: props.defaultChild });

  // ── 右键菜单（本地状态，不与 ctx 耦合，避免右键触发整个页面重渲染） ──
  const [ctxMenuPosition, setCtxMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenuItems, setCtxMenuItems] = useState<ContextMenuItem[]>([]);
  const closeCtxMenu = useCallback(() => setCtxMenuPosition(null), []);

  // 上传文件选择器 ref（Toolbar 上传按钮与右键菜单「上传素材」共用同一入口）
  const materialFileInputRef = useRef<HTMLInputElement>(null);

  // ── 副本定位聚焦：临时高亮 id + 分页跳转 ──
  const [highlightId, setHighlightId] = useState<string | null>(props.focusId ?? null);
  const focusJumpedRef = useRef(false);

  useEffect(() => {
    focusJumpedRef.current = false;
    setHighlightId(props.focusId ?? null);
    if (!props.focusId) return;
    // 兼做兑底清除（ghost 动画 + 脉冲高亮结束后消退）
    // 同时清除 URL 中的 focus 参数，避免用户重新进入时鬼影动画再次播放
    const timer = window.setTimeout(() => {
      setHighlightId(null);
      try {
        if (window.location.hash.startsWith('#/assets')) {
          const base = window.location.hash.split('?')[0];
          const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
          params.delete('focus');
          const newHash = params.toString() ? `${base}?${params.toString()}` : base;
          window.history.replaceState(null, '', newHash || window.location.pathname);
        }
      } catch {
        // 静默处理 URL 操作异常
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [props.focusId]);

  useEffect(() => {
    if (!props.focusId || focusJumpedRef.current) return;
    const idx = ctx.allItems.findIndex((it) => it.data.id === props.focusId);
    if (idx < 0) return; // 数据未加载完成,等下次 allItems 变化再试
    focusJumpedRef.current = true;
    const targetPage = Math.floor(idx / ctx.PAGE_SIZE) + 1;
    if (targetPage !== ctx.page) ctx.setPage(targetPage);
  }, [props.focusId, ctx.allItems, ctx.page, ctx.PAGE_SIZE, ctx.setPage]);

  // ── 上下文菜单 ──
  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: PageItem) => {
    e.preventDefault();
    e.stopPropagation();
    const ItemType = item.type;
    setCtxMenuPosition({ x: e.clientX, y: e.clientY });
    const items: ContextMenuItem[] = [
      { key: 'open', label: t('common.open'), icon: null, onClick: () => ctx.handleOpenItem(item) },
      { key: 'rename', label: t('assetLibrary.rename'), icon: null, onClick: () => {
        if (ItemType === 'prompt') {
          ctx.setRenameItemTarget({ type: 'prompt', id: item.data.id });
          ctx.setRenameItemName(item.data.title);
        } else {
          ctx.setRenameItemTarget({ type: 'asset', id: item.data.id });
          ctx.setRenameItemName(item.data.title);
        }
        ctx.setRenameItemOpen(true);
      }},
      { key: 'download', label: t('common.download'), icon: null, onClick: () => ctx.handleDownloadItem({ type: ItemType as any, data: item.data }) },
      { key: 'delete', label: t('assetLibrary.delete'), icon: null, danger: true, onClick: () => {
        ctx.setConfirmDelete({ type: ItemType as any, id: item.data.id, name: item.data.title });
      }},
    ];
    if (props.onSendToCanvas) {
      items.push({ key: 'send-to-canvas', label: t('assetLibrary.sendToCanvas'), icon: null, onClick: () => props.onSendToCanvas!({ type: ItemType as any, id: item.data.id, data: item.data }) });
    }
    setCtxMenuItems(items);
  }, [setCtxMenuPosition, setCtxMenuItems, ctx.handleOpenItem, ctx.setRenameItemTarget, ctx.setRenameItemName, ctx.setRenameItemOpen, ctx.handleDownloadItem, ctx.setConfirmDelete, t, props.onSendToCanvas]);

  // 文件上传回调
  const handleUploadMaterial = useCallback((files: FileList) => {
    const dt = new DataTransfer();
    Array.from(files).forEach((f) => dt.items.add(f));
    void ctx.handleUpload(dt.files);
  }, [ctx.handleUpload]);

  const handleUploadRetry = useCallback((failedFiles: File[]) => {
    const dt = new DataTransfer();
    for (const f of failedFiles) dt.items.add(f);
    void ctx.handleUpload(dt.files);
  }, [ctx.handleUpload]);

  // 稳定化 Toolbar 回调，避免重新渲染导致选项卡闪烁
  const handleGroupClick = useCallback((group: string) => ctx.setActiveGroup(group), [ctx.setActiveGroup]);
  const handleChildClick = useCallback((key: string | null) => { ctx.setActiveChild(key); ctx.setPage(1); }, [ctx.setActiveChild, ctx.setPage]);
  const handleNewPrompt = useCallback(() => { ctx.setPromptCreateId(undefined); ctx.setPromptCreateOpen(true); }, [ctx.setPromptCreateId, ctx.setPromptCreateOpen]);
  const handleMultiSelectToggle = useCallback(() => ctx.setMultiSelectEnabled(!ctx.multiSelectEnabled), [ctx.multiSelectEnabled, ctx.setMultiSelectEnabled]);

  // 稳定化 GridView 回调，避免内联函数每次重渲染创建新引用导致 GridView 重渲染
  const handleRenameItem = useCallback((item: PageItem) => {
    ctx.setRenameItemTarget({ type: item.type as any, id: item.data.id });
    ctx.setRenameItemName(item.data.title);
    ctx.setRenameItemOpen(true);
  }, [ctx.setRenameItemTarget, ctx.setRenameItemName, ctx.setRenameItemOpen]);

  const handleDeleteItem = useCallback((item: PageItem) => {
    ctx.setConfirmDelete({ type: item.type as any, id: item.data.id, name: item.data.title });
  }, [ctx.setConfirmDelete]);

  const handleDownloadItem = useCallback((item: PageItem) => {
    ctx.handleDownloadItem({ type: item.type as any, data: item.data });
  }, [ctx.handleDownloadItem]);

  const handleFavoriteItem = useCallback((item: PageItem) => {
    ctx.handleToggleFavorite({ type: item.type as any, id: item.data.id, data: { ...item.data, favorite: false } });
  }, [ctx.handleToggleFavorite]);

  const handleUnfavoriteItem = useCallback((item: PageItem) => {
    ctx.handleToggleFavorite({ type: item.type as any, id: item.data.id, data: { ...item.data, favorite: true } });
  }, [ctx.handleToggleFavorite]);

  const handleGridCtxMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-item-type]')) return;
    e.preventDefault();
    setCtxMenuPosition({ x: e.clientX, y: e.clientY });
    setCtxMenuItems([
      { key: 'upload-material', label: '上传素材', icon: null, onClick: () => materialFileInputRef.current?.click() },
      { key: 'new-prompt', label: '新建提示词', icon: null, onClick: () => { ctx.setPromptCreateId(undefined); ctx.setPromptCreateOpen(true); } },
      { key: 'new-script', label: '新建剧本', icon: null, onClick: () => ctx.handleNewScript() },
    ]);
  }, [setCtxMenuPosition, setCtxMenuItems, ctx.setPromptCreateId, ctx.setPromptCreateOpen, ctx.handleNewScript]);

  // 使用 useMemo 完全隔离 Toolbar 的 JSX 创建，避免父组件重渲染时重建
  const toolbar = useMemo(() => (
    <AssetLibraryToolbar
      categories={ctx.categories}
      activeGroup={ctx.activeGroup}
      activeChild={ctx.activeChild}
      search={ctx.search}
      viewMode={ctx.viewMode}
      multiSelectEnabled={ctx.multiSelectEnabled}
      scanningProgress={ctx.scanningProgress}
      scanningMessage={ctx.scanningMessage}
      isMobile={isMobile}
      theme={theme}
      onGroupClick={handleGroupClick}
      onChildClick={handleChildClick}
      onSearchChange={ctx.setSearch}
      onViewModeChange={ctx.setViewMode}
      onMultiSelectToggle={handleMultiSelectToggle}
      onUploadMaterial={handleUploadMaterial}
      materialFileInputRef={materialFileInputRef}
      onNewPrompt={handleNewPrompt}
      onNewScript={ctx.handleNewScript}
    />
  ), [
    ctx.categories, ctx.activeGroup, ctx.activeChild,
    ctx.search, ctx.viewMode, ctx.multiSelectEnabled,
    ctx.scanningProgress, ctx.scanningMessage,
    isMobile, theme,
    handleGroupClick, handleChildClick,
    ctx.setSearch, ctx.setViewMode,
    handleMultiSelectToggle, handleUploadMaterial,
    handleNewPrompt, ctx.handleNewScript,
  ]);

  // 使用 useMemo 完全隔离主内容区（工具栏 + 网格视图 + 多选栏 + 分页器），
  // 避免右键菜单状态变化时重渲染导致闪烁
  const mainContent = useMemo(() => (
    <div style={layoutBodyStyle(isMobile)}>
      <div style={contentAreaStyle()}>
        {toolbar}

        {ctx.viewMode === 'grid' ? (
          <AssetLibraryGridView
            pageItems={ctx.pageItems}
            loading={ctx.loadingPrompts || ctx.loadingAssets}
            multiSelectEnabled={ctx.multiSelectEnabled}
            selectedIds={ctx.selectedIds}
            highlightId={highlightId}
            isMobile={isMobile}
            theme={theme}
            dragOver={ctx.dragOver}
            dragCounterRef={ctx.dragCounterRef}
            onToggleSelect={ctx.handleToggleSelect}
            onOpenItem={ctx.handleOpenItem}
            onRenameItem={handleRenameItem}
            onDeleteItem={handleDeleteItem}
            onDownloadItem={handleDownloadItem}
            onFavoriteItem={handleFavoriteItem}
            onUnfavoriteItem={handleUnfavoriteItem}
            onContextMenu={handleItemContextMenu}
            onDragEnter={ctx.handleDragEnter}
            onDragLeave={ctx.handleDragLeave}
            onDragOver={ctx.handleDragOver}
            onDrop={ctx.handleDrop}
            onCtxMenu={handleGridCtxMenu}
          />
        ) : (
          <AssetLibraryListView
            pageItems={ctx.pageItems}
            theme={theme}
            onOpenItem={ctx.handleOpenItem}
          />
        )}

        {/* 多选操作栏 */}
        {ctx.multiSelectEnabled && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            flexShrink: 0,
            background: 'transparent',
          }}>
            <span style={{ fontSize: 13, color: theme.toolbar.text }}>
              已选 <strong>{ctx.selectedIds.size}</strong> 项
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button size="small" onClick={ctx.handleToggleSelectAll}>
                {ctx.selectedIds.size === ctx.allItems.length ? '取消全选' : '全选'}
              </Button>
              <Button size="small" type="primary" onClick={ctx.handleBatchDelete}>
                删除选中
              </Button>
              <Tooltip title="退出多选">
                <Button
                  size="small"
                  icon={<X size={14} />}
                  onClick={() => ctx.setMultiSelectEnabled(false)}
                />
              </Tooltip>
            </div>
          </div>
        )}

        {/* 分页器 */}
        {ctx.allItems.length > ctx.PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', flexShrink: 0 }}>
            <Pagination
              current={ctx.page}
              total={ctx.allItems.length}
              pageSize={ctx.PAGE_SIZE}
              onChange={ctx.setPage}
              showSizeChanger={false}
              size="small"
            />
          </div>
        )}
      </div>
    </div>
  ), [
    isMobile, toolbar, ctx.viewMode, ctx.pageItems,
    ctx.loadingPrompts, ctx.loadingAssets,
    ctx.multiSelectEnabled, ctx.selectedIds, highlightId, theme,
    ctx.dragOver, ctx.dragCounterRef, ctx.handleToggleSelect,
    ctx.handleOpenItem, handleRenameItem, handleDeleteItem,
    handleDownloadItem, handleFavoriteItem, handleUnfavoriteItem,
    handleItemContextMenu, ctx.handleDragEnter, ctx.handleDragLeave,
    ctx.handleDragOver, ctx.handleDrop, handleGridCtxMenu,
    ctx.allItems, ctx.PAGE_SIZE, ctx.page, ctx.setPage,
    ctx.handleToggleSelectAll, ctx.handleBatchDelete, ctx.setMultiSelectEnabled,
  ]);

  return (
    <div style={pageStyle()}>
      {mainContent}

      {/* 弹窗 */}
      <AssetLibraryModals
        confirmDelete={ctx.confirmDelete}
        onConfirmDelete={ctx.handleConfirmDelete}
        onCancelDelete={() => ctx.setConfirmDelete(null)}
        renameItemOpen={ctx.renameItemOpen}
        renameItemName={ctx.renameItemName}
        renameItemTarget={ctx.renameItemTarget}
        onRenameNameChange={ctx.setRenameItemName}
        onRenameConfirm={ctx.handleRenameItem}
        onRenameCancel={() => { ctx.setRenameItemOpen(false); ctx.setRenameItemName(''); ctx.setRenameItemTarget(null); }}
        scriptNamePromptOpen={ctx.scriptNamePromptOpen}
        scriptNameInput={ctx.scriptNameInput}
        scriptNamePlaceholder={ctx.scriptNameSuggestion}
        onScriptNameChange={ctx.setScriptNameInput}
        onScriptNameConfirm={ctx.handleConfirmNewScript}
        onScriptNameCancel={() => ctx.setScriptNamePromptOpen(false)}
        assetDetail={ctx.assetDetail}
        onAssetDetailClose={() => ctx.setAssetDetail(null)}
        scriptEditorOpen={ctx.scriptEditorOpen}
        scriptEditorTitle={ctx.scriptEditorTitle}
        scriptEditorEpisodes={ctx.scriptEditorEpisodes}
        scriptEditorActiveId={ctx.scriptEditorActiveId}
        onScriptEditorClose={ctx.handleCloseScriptEditor}
        onScriptEditorEpisodesChange={ctx.setScriptEditorEpisodes}
        onScriptEditorActiveChange={ctx.setScriptEditorActiveId}
        onScriptEditorEpisodesAndActiveChange={(eps, activeId) => {
          ctx.setScriptEditorEpisodes(eps);
          if (activeId !== undefined) ctx.setScriptEditorActiveId(activeId);
        }}
        onScriptEditorAddEpisode={() => {
          const nextNum = ctx.scriptEditorEpisodes.length + 1;
          const newEp = { id: `ep-${Date.now()}`, number: nextNum, title: `第${nextNum}集`, content: '' };
          ctx.setScriptEditorEpisodes([...ctx.scriptEditorEpisodes, newEp]);
          ctx.setScriptEditorActiveId(newEp.id);
        }}
        onScriptEditorImportClick={() => ctx.setScriptImportOpen(true)}
        scriptImportOpen={ctx.scriptImportOpen}
        onScriptImportClose={() => ctx.setScriptImportOpen(false)}
        onScriptImportComplete={ctx.handleScriptImportComplete}
        promptViewId={ctx.promptViewId}
        onPromptViewClose={() => ctx.setPromptViewId(null)}
        onPromptViewSaved={() => { void ctx.refreshPrompts(); }}
        ctxMenuPosition={ctxMenuPosition}
        ctxMenuItems={ctxMenuItems}
        onCtxMenuClose={closeCtxMenu}
        promptCreateOpen={ctx.promptCreateOpen}
        promptCreateId={ctx.promptCreateId}
        onPromptCreateClose={() => ctx.setPromptCreateOpen(false)}
        onPromptCreateSaved={() => { ctx.setPromptCreateOpen(false); ctx.setActiveGroup('prompt'); void ctx.refreshPrompts(); }}
        onUploadRetry={handleUploadRetry}
        theme={theme}
      />
    </div>
  );
}