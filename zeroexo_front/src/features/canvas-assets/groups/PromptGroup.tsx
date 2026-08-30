/**
 * canvas-assets/groups/PromptGroup - 画布资产抽屉「提示词」分组
 *
 * 数据驱动：所有状态/派生/actions 来自 store（useCanvasAssetsPanel），
 * 本组件纯渲染 + 事件派发。展示组件复用 shared PromptCard / PromptViewer。
 *
 * 我的（私有提示词库）：分类 + 搜索前端过滤，卡片可打开/克隆/删除，可拖到画布。
 * 公共（公共提示词库）：后端分页（分类/搜索参数），卡片只读 + 收藏副本，可拖到画布。
 */

import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { PromptCard } from '@/shared/components/prompt-card.js';
import { PromptViewer } from '@/shared/components/prompt-viewer.js';
import { getLocalizedTitle } from '@/features/asset-library/public-prompts-shared.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { PROMPT_CATEGORY_KEYS } from '../store.js';
import {
  AddTile, CategoryChips, EmptyState, ErrorBar, PaginationBar, SearchBox, SkeletonGrid, SourceSwitch, ToolbarRow,
} from '../components/common.js';

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
  alignContent: 'start',
  padding: '0 20px 16px',
};

/** 卡片拖拽 payload（对齐画布 drop-handler 的 application/x-testlib-item 契约） */
const LIB_DRAG_MIME = 'application/x-testlib-item';

export function PromptGroup({ store, theme }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const {
    promptSource, changePromptSource,
    promptCategory, setPromptCategory,
    search, setSearch,
    prompts, loadingPrompts,
    handleCloneMine, openItem,
    promptViewId, setPromptViewId,
    publicPrompts, publicTotal, publicPage, setPublicPage,
    loadingPublic, publicError, loadPublic,
    handleClonePublic, publicViewItem, setPublicViewItem,
    setConfirmDelete,
  } = store;

  const categoryOptions = [
    { key: null, label: t('assetLibrary.filterAll') },
    ...PROMPT_CATEGORY_KEYS.map((key) => ({
      key,
      label: t(`assetLibrary.filter${key.charAt(0).toUpperCase()}${key.slice(1)}`),
    })),
  ];

  const categoryLabelOf = (category: string): string =>
    t(`promptCreate.category${category.charAt(0).toUpperCase()}${category.slice(1)}`);

  /** 业务分类归一：style/shot 并入 other（用户拍板收敛） */
  const normalizeCategory = (category: string): string =>
    category === 'style' || category === 'shot' ? 'other' : category;

  /** 拖拽到画布（公共/我的统一：内容拷贝建 text 节点） */
  const dragStart = (e: React.DragEvent, data: { id: string; title: string; content: string; category: string; tags: string[]; imageKeys: string[] }): void => {
    e.dataTransfer.setData(LIB_DRAG_MIME, JSON.stringify({
      type: 'prompt',
      id: data.id,
      name: data.title,
      data,
    }));
  };

  return (
    <>
      {/* 来源切换（我的 / 公共）+ 分类标签；搜索统一在标签下方 */}
      <ToolbarRow>
        <SourceSwitch value={promptSource} onChange={(v) => changePromptSource(v as 'mine' | 'public')} theme={theme} />
        <CategoryChips
          items={categoryOptions}
          active={promptCategory}
          onChange={(k) => { setPromptCategory(k); setPublicPage(1); }}
          theme={theme}
        />
      </ToolbarRow>
      <ToolbarRow style={{ paddingTop: 0 }}>
        <SearchBox value={search} onChange={setSearch} placeholder={t('assetLibrary.searchPlaceholder')} theme={theme} />
      </ToolbarRow>

      {promptSource === 'mine' ? (
        /* ===== 我的（私有提示词库） ===== */
        <>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loadingPrompts && prompts.length === 0 ? (
              <SkeletonGrid theme={theme} />
            ) : prompts.length === 0 ? (
              <EmptyState theme={theme} />
            ) : (
              <div style={GRID_STYLE}>
                {prompts.map((prompt, idx) => (
                  <div
                    key={prompt.id}
                    draggable
                    onDragStart={(e) => dragStart(e, prompt)}
                  >
                    <PromptCard
                      title={prompt.title}
                      category={normalizeCategory(prompt.category)}
                      categoryLabel={categoryLabelOf(normalizeCategory(prompt.category))}
                      tags={prompt.tags}
                      imageKeys={prompt.imageKeys}
                      mode="asset"
                      borderRadius={12}
                      thumbnailAspectRatio="239.2/135.4"
                      disableHoverScale
                      animationDelay={idx * 20}
                      onClick={() => openItem({ type: 'prompt', data: prompt })}
                      onClone={() => handleCloneMine(prompt)}
                      onDelete={() => setConfirmDelete({ type: 'prompt', id: prompt.id, name: prompt.title })}
                      theme={theme}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
            <AddTile label={t('assetLibrary.newPrompt', { defaultValue: '新建提示词' })} onClick={() => { /* 新建走 PromptCreatePage */ }} theme={theme} />
          </div>
        </>
      ) : (
        /* ===== 公共（公共提示词库） ===== */
        <>
          {publicError && (
            <div style={{ padding: '0 20px 8px' }}>
              <ErrorBar
                message={`${t('assetLibrary.publicLoadFailed', { defaultValue: '公共提示词加载失败' })}：${publicError}`}
                onRetry={() => void loadPublic({ page: publicPage, category: promptCategory, keyword: search.trim() })}
              />
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loadingPublic && publicPrompts.length === 0 ? (
              <SkeletonGrid theme={theme} />
            ) : publicPrompts.length === 0 ? (
              <EmptyState text={t('assetLibrary.publicEmpty', { defaultValue: '暂无公共提示词' })} theme={theme} />
            ) : (
              <div style={GRID_STYLE}>
                {publicPrompts.map((prompt, idx) => (
                  <div
                    key={prompt.id}
                    draggable
                    onDragStart={(e) => dragStart(e, prompt)}
                  >
                    <PromptCard
                      title={prompt.title}
                      category={normalizeCategory(prompt.category)}
                      categoryLabel={categoryLabelOf(normalizeCategory(prompt.category))}
                      tags={prompt.tags}
                      imageKeys={prompt.imageKeys}
                      mode="public"
                      borderRadius={12}
                      thumbnailAspectRatio="239.2/135.4"
                      disableHoverScale
                      animationDelay={idx * 20}
                      onClick={() => openItem({ type: 'prompt', data: prompt })}
                      onClone={() => handleClonePublic(prompt)}
                      theme={theme}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>
            <PaginationBar page={publicPage} total={publicTotal} pageSize={24} onChange={setPublicPage} />
          </div>
        </>
      )}

      {/* 详情弹窗：我的（promptId 可编辑）/ 公共（publicItem 只读） */}
      <PromptViewer
        promptId={promptViewId ?? undefined}
        open={!!promptViewId}
        onClose={() => setPromptViewId(null)}
        onSaved={() => void store.refreshPrompts(true)}
      />
      <PromptViewer
        publicItem={publicViewItem ? {
          id: publicViewItem.id,
          title: getLocalizedTitle(publicViewItem, i18n.language),
          content: publicViewItem.content,
          category: publicViewItem.category,
          tags: publicViewItem.tags ?? [],
          images: publicViewItem.images ?? [],
          source: publicViewItem.source,
          sourceId: publicViewItem.sourceId,
          sourceName: publicViewItem.sourceName,
          sourceUrl: publicViewItem.sourceUrl,
          license: publicViewItem.license,
        } : undefined}
        open={!!publicViewItem}
        onClose={() => setPublicViewItem(null)}
      />
    </>
  );
}
