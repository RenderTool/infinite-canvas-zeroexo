/**
 * asset-library-grid-view - 资产库网格视图（重构版）
 *
 * 核心优化：
 * 1. GridContext + CardItem 机制：CardItem 通过 context 读取数据，
 *    独立于 VirtuosoGrid 重渲染，避免批量编辑模式切换时整个网格闪烁。
 * 2. 稳定 itemContent（useCallback([], [])）：VirtuosoGrid 不因
 *    multiSelectEnabled 变化而重渲染卡片，卡片仅通过 context 变化更新。
 * 3. 稳定 VirtuosoGrid components（useMemo）：避免 List/Item 组件
 *    每次重渲染重新创建 forwardRef。
 */

import { useEffect, useRef, useState, forwardRef, memo, useCallback, useMemo, createContext, useContext } from 'react';
import { Upload } from 'lucide-react';
import { Empty, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';
import type { ThemeConfig } from '@zeroexo/shared';
import { getCardRenderer } from '../cards/card-registry.js';
import { gridContainerStyle, gridStyle } from '../asset-library-styles.js';
import type { PageItem, ContentType } from '../types.js';
import { MultiSelectCheckbox } from './multi-select-checkbox.js';
import { consumeStashSourceRect } from '../prompt-copy-feedback.js';

// ===== Grid Context =====

interface GridContextValue {
  pageItems: PageItem[];
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  highlightId: string | null;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
  onToggleSelect: (id: string) => void;
  onOpenItem: (item: PageItem) => void;
  onRenameItem: (item: PageItem) => void;
  onDeleteItem: (item: PageItem) => void;
  onDownloadItem?: (item: PageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: PageItem) => void;
  /** 发送到画布(征集 #87 验收轮十三:仅画布内嵌入时提供) */
  onSendToCanvas?: (item: PageItem) => void;
}

const GridContext = createContext<GridContextValue>(null as any);
const useGridContext = (): GridContextValue => useContext(GridContext);

// ===== Card Item（通过 context 读取数据，独立于 VirtuosoGrid 重渲染） =====

const CardItem = memo(function CardItem({ index }: { index: number }) {
  const ctx = useGridContext();
  const {
    pageItems: ctxPageItems,
    multiSelectEnabled: ctxMultiSelect,
    selectedIds: ctxSelectedIds,
    highlightId: ctxHighlightId,
    theme: ctxTheme,
    t: ctxT,
    onToggleSelect: ctxOnToggleSelect,
    onOpenItem: ctxOnOpenItem,
    onRenameItem: ctxOnRenameItem,
    onDeleteItem: ctxOnDeleteItem,
    onDownloadItem: ctxOnDownloadItem,
    onContextMenu: ctxOnContextMenu,
    onSendToCanvas: ctxOnSendToCanvas,
  } = ctx;

  const item = ctxPageItems[index];
  if (!item) return null;
  const renderer = getCardRenderer(item.type as ContentType);
  if (!renderer) return null;

  const itemId = item.data.id ?? '';
  const isSelected = ctxSelectedIds.has(itemId);
  const GridComponent = renderer.renderGrid;

  return (
    <FocusCardWrapper key={`${item.type}-${itemId}`} active={itemId === ctxHighlightId} theme={ctxTheme}>
      {ctxMultiSelect && (
        <MultiSelectCheckbox
          selected={isSelected}
          onToggle={() => ctxOnToggleSelect(itemId)}
          accentColor={ctxTheme.toolbar.accent}
        />
      )}
      <GridComponent
        item={item.data}
        selected={isSelected}
        multiSelectEnabled={ctxMultiSelect}
        onToggleSelect={(id) => ctxOnToggleSelect(id)}
        onOpen={() => ctxOnOpenItem(item)}
        onRename={() => ctxOnRenameItem(item)}
        onDelete={() => ctxOnDeleteItem(item)}
        onDownload={ctxOnDownloadItem ? () => ctxOnDownloadItem(item) : undefined}
        onContextMenu={(e) => ctxOnContextMenu(e, item)}
        onSendToCanvas={ctxOnSendToCanvas ? () => ctxOnSendToCanvas(item) : undefined}
        theme={ctxTheme}
        t={ctxT}
      />
    </FocusCardWrapper>
  );
});

// ===== VirtuosoGrid 内层（管理 GridContext + 稳定 itemContent） =====

interface VirtuosoGridInnerProps {
  pageItems: PageItem[];
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  highlightId: string | null;
  isMobile: boolean;
  /** 固定列数(画布内嵌抽屉固定 2 格);缺省按 isMobile/自适应列 */
  gridColumns?: number;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
  onToggleSelect: (id: string) => void;
  onOpenItem: (item: PageItem) => void;
  onRenameItem: (item: PageItem) => void;
  onDeleteItem: (item: PageItem) => void;
  onDownloadItem?: (item: PageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: PageItem) => void;
  onSendToCanvas?: (item: PageItem) => void;
}

const VirtuosoGridInner = memo(function VirtuosoGridInner({
  pageItems,
  multiSelectEnabled,
  selectedIds,
  highlightId,
  isMobile,
  gridColumns,
  theme,
  t,
  onToggleSelect,
  onOpenItem,
  onRenameItem,
  onDeleteItem,
  onDownloadItem,
  onContextMenu,
  onSendToCanvas,
}: VirtuosoGridInnerProps): React.ReactElement {
  // 稳定化 VirtuosoGrid components，避免每次重渲染重建 forwardRef
  const components = useMemo(() => ({
    List: forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(
      ({ style, children, ...props }, ref) => (
        <div ref={ref} {...props} style={{ ...style, ...gridStyle(isMobile, gridColumns) }}>
          {children}
        </div>
      ),
    ),
    Item: forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(
      ({ style, ...props }, ref) => (
        <div ref={ref} {...props} style={{ ...style, overflow: 'visible' }} />
      ),
    ),
  }), [isMobile, gridColumns]);

  // 稳定 itemContent：useCallback 空依赖，永远不重新创建函数引用
  // CardItem 通过 context 读取最新数据，不依赖 itemContent 重渲染
  const itemContent = useCallback((index: number) => {
    return <CardItem index={index} />;
  }, []);

  // 构建 context value（每次渲染新对象，Provider 自动推动更新）
  const contextValue: GridContextValue = {
    pageItems,
    multiSelectEnabled,
    selectedIds,
    highlightId,
    theme,
    t,
    onToggleSelect,
    onOpenItem,
    onRenameItem,
    onDeleteItem,
    onDownloadItem,
    onContextMenu,
    onSendToCanvas,
  };

  return (
    <GridContext.Provider value={contextValue}>
      <VirtuosoGrid
        style={{ height: '100%' }}
        totalCount={pageItems.length}
        overscan={200}
        components={components}
        itemContent={itemContent}
      />
    </GridContext.Provider>
  );
});

// ===== AssetLibraryGridView（对外接口不变） =====

interface AssetLibraryGridViewProps {
  pageItems: PageItem[];
  loading: boolean;
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  /** 需要聚焦高亮的卡片 id（复制副本后跳转定位,配收纳动画 + 脉冲） */
  highlightId?: string | null;
  isMobile: boolean;
  /** 固定列数(画布内嵌抽屉固定 2 格);缺省按 isMobile/自适应列 */
  gridColumns?: number;
  theme: ThemeConfig;
  dragOver: boolean;
  dragCounterRef: React.MutableRefObject<number>;

  onToggleSelect: (id: string) => void;
  onOpenItem: (item: PageItem) => void;
  onRenameItem: (item: PageItem) => void;
  onDeleteItem: (item: PageItem) => void;
  onDownloadItem?: (item: PageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: PageItem) => void;
  onSendToCanvas?: (item: PageItem) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onCtxMenu: (e: React.MouseEvent) => void;
}

export const AssetLibraryGridView = memo(function AssetLibraryGridView({
  pageItems,
  loading,
  multiSelectEnabled,
  selectedIds,
  highlightId,
  isMobile,
  gridColumns,
  theme,
  dragOver,
  onToggleSelect,
  onOpenItem,
  onRenameItem,
  onDeleteItem,
  onDownloadItem,
  onContextMenu,
  onSendToCanvas,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onCtxMenu,
}: AssetLibraryGridViewProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      style={gridContainerStyle(isMobile)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onCtxMenu}
    >
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '40%' }} />
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '30%' }} />
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '50%' }} />
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '35%' }} />
        </div>
      ) : pageItems.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Empty
            description={
              <span style={{ color: theme.toolbar.textMuted, fontSize: 13 }}>
                {t('assetLibrary.empty')}
              </span>
            }
          />
        </div>
      ) : (
        <div style={{ height: '100%', position: 'relative' }}>
          <VirtuosoGridInner
            pageItems={pageItems}
            multiSelectEnabled={multiSelectEnabled}
            selectedIds={selectedIds}
            highlightId={highlightId ?? null}
            isMobile={isMobile}
            gridColumns={gridColumns}
            theme={theme}
            t={t}
            onToggleSelect={onToggleSelect}
            onOpenItem={onOpenItem}
            onRenameItem={onRenameItem}
            onDeleteItem={onDeleteItem}
            onDownloadItem={onDownloadItem}
            onContextMenu={onContextMenu}
            onSendToCanvas={onSendToCanvas}
          />

          {/* 拖拽上传覆盖层 */}
          {dragOver && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: theme.mode === 'dark' ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)',
                border: `2px dashed ${theme.toolbar.accent}`,
                borderRadius: 12,
                margin: 8,
                pointerEvents: 'none',
              }}
            >
              <div style={{ textAlign: 'center', color: theme.toolbar.accent }}>
                {/* 验收轮二十一:图标精致化(22px 圆形底) + 文字小巧(13px/500),整体垂直居中 */}
                <div style={{
                  width: 44, height: 44, margin: '0 auto',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: theme.mode === 'dark' ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
                }}>
                  <Upload size={22} strokeWidth={2} />
                </div>
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500 }}>
                  {t('assetLibrary.dropToUpload') ?? '拖拽文件到此处上传'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ===== 副本聚焦：ghost 收纳动画 + 脉冲高亮 =====

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** ghost 卡片从源矩形缩放飞入目标槽位（类似 Modal 关闭缩放的逆向），落地后回调 */
function playGhostFlyIn(source: Rect, target: Rect, theme: ThemeConfig, onLand: () => void): void {
  const isDark = theme.mode === 'dark';
  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'z-index:2100', 'pointer-events:none',
    `width:${source.width}px`, `height:${source.height}px`,
    'border-radius:10px', 'overflow:hidden',
    `background:${isDark ? '#1c1917' : '#ffffff'}`,
    `border:1px solid ${theme.toolbar.accent}`,
    `box-shadow:${isDark ? '0 16px 48px rgba(0,0,0,0.5)' : '0 16px 40px rgba(28,25,23,0.25)'}`,
    'transform-origin:top left',
    `transform:translate(${source.x}px, ${source.y}px)`,
    'opacity:0.95',
    'transition:transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease',
  ].join(';');
  // 内部结构仿 PromptCard：顶部 16:9 缩略图占位 + 两条文字灰条
  const muted = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const strong = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const subtle = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)';
  const thumb = document.createElement('div');
  thumb.style.cssText = `height:62%; background:${muted}`;
  const bar1 = document.createElement('div');
  bar1.style.cssText = `height:10px; width:64%; margin:12px 12px 8px; border-radius:5px; background:${strong}`;
  const bar2 = document.createElement('div');
  bar2.style.cssText = `height:8px; width:40%; margin:0 12px; border-radius:4px; background:${subtle}`;
  ghost.append(thumb, bar1, bar2);
  document.body.appendChild(ghost);
  const sx = target.width / source.width;
  const sy = target.height / source.height;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${target.x}px, ${target.y}px) scale(${sx}, ${sy})`;
    });
  });
  window.setTimeout(() => {
    onLand();
    ghost.style.opacity = '0';
    window.setTimeout(() => ghost.remove(), 220);
  }, 560);
}

/** 卡片包装：命中聚焦时滚动到视野 → ghost 收纳动画 → 落地后脉冲高亮 */
const FocusCardWrapper = memo(function FocusCardWrapper({
  active,
  theme,
  children,
}: {
  active: boolean;
  theme: ThemeConfig;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    let cancelled = false;
    // 等平滑滚动大致到位后播放收纳动画
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const target = el.getBoundingClientRect();
      playGhostFlyIn(consumeStashSourceRect(), target, theme, () => {
        if (!cancelled) setPulsing(true);
      });
    }, 420);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, theme]);

  return (
    <div ref={ref} className={pulsing ? 'zx-card-focus' : undefined} style={{ position: 'relative' }}>
      {children}
    </div>
  );
});