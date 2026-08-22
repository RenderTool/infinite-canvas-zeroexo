/**
 * ProductionManagerView - 统筹节点视图（Plan#29 V3，堆叠同框架）
 *
 * 布局 = 主体卡基线同款（左垂直导航 + 右封面舞台 + 信息条），禁止自由发挥：
 * - 左侧 sidebar = ThumbNav 垂直导航（与堆叠/主体同一套框架：上限 5 + 滑动窗口 + 1/N 页码 + 自适应降档）
 *   切换不同实体条目（纯视图态 useState，不落 node.data、不进撤销栈——切卡只是浏览，非持久化变更）
 * - 右侧 content = 当前条目封面舞台（首张剧照 contain，无图 → Rabbit 骨架）+ 信息条（名称 + 类型 + 摘要）
 * - 低对比设计：类型用图标 + 文字，不用高饱和色块
 * - 详情编辑走胶囊菜单「编辑」→ nodeActionBus 'productionManager:fullscreen' → 打开 ProductionManagerModal
 * - 图片 draggable=false，拖拽节点不误触发素材投放
 * 图标契约：Rabbit 为装饰性图标（空态骨架/KIND_ICON 兜底/标题占位），允许直连 lucide；胶囊交互图标一律走 ../icons.ts。
 */
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Rabbit } from 'lucide-react'; // 装饰性图标（空态骨架），契约允许直连，禁止用于胶囊交互
import type { NodeRendererProps } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, nodeActionBus, ThumbNav, useHydratedContent } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import type { ProductionManagerData } from './production-manager-types';
import { KIND_COLOR } from './production-manager-types';
import { ProductionManagerModal } from './ProductionManagerModal';
import { ItemThumb, KIND_ICON } from './production-manager-panels';

export interface ProductionManagerViewProps extends NodeRendererProps {
  connectionController: any;
  store?: any;
}

const PM_COLOR = '#64748b'; // 低饱和石板色（与 production-manager-extension 一致）

function parseData(data: Record<string, unknown> | undefined): ProductionManagerData {
  if (!data) return { title: '', items: [] };
  return {
    title: (data.title as string) ?? '',
    scriptId: data.scriptId as string | undefined,
    items: Array.isArray(data.items) ? (data.items as ProductionManagerData['items']) : [],
  };
}

/** 封面舞台：当前条目首张剧照（contain，对齐主体卡 StateCover） */
function ItemCover({ storageKey, dark }: { storageKey?: string; dark: boolean }): React.ReactElement {
  const fallback = storageKey ? (getResourceUrl(storageKey, 'preview') ?? '') : '';
  const hydrated = useHydratedContent(storageKey ?? '', fallback);
  if (!hydrated) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
        <Rabbit size={40} />
      </div>
    );
  }
  return <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />;
}

export const ProductionManagerView = memo(function ProductionManagerView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  invK,
  externalRenaming,
  onRenameFinish,
  connectionController,
  store,
}: ProductionManagerViewProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const data = useMemo(() => parseData(node.data as Record<string, unknown> | undefined), [node.data]);
  const [editorOpen, setEditorOpen] = useState(false);

  // 胶囊菜单「详情」→ 打开编辑器
  useEffect(() => {
    const unsub = nodeActionBus.on('productionManager:fullscreen', (event: { nodeId: string }) => {
      if (event.nodeId === node.id) setEditorOpen(true);
    });
    return unsub;
  }, [node.id]);

  // 当前活跃条目索引（纯视图态：不落 node.data、不进撤销栈；items 收缩时回落 0）
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (activeIndex >= data.items.length) setActiveIndex(0);
  }, [data.items.length, activeIndex]);
  const activeItem = data.items[Math.min(activeIndex, data.items.length - 1)] ?? null;

  // 条目切换（仅本地视图态，无副作用）
  const handleItemChange = useCallback((index: number) => {
    if (index < 0 || index >= data.items.length) return;
    setActiveIndex(index);
  }, [data.items.length]);

  const handlePrev = useCallback(() => {
    if (data.items.length <= 1) return;
    handleItemChange(Math.max(0, activeIndex - 1));
  }, [data.items.length, activeIndex, handleItemChange]);

  const handleNext = useCallback(() => {
    if (data.items.length <= 1) return;
    handleItemChange(Math.min(data.items.length - 1, activeIndex + 1));
  }, [data.items.length, activeIndex, handleItemChange]);

  const handleJump = useCallback((index: number) => {
    handleItemChange(index);
  }, [handleItemChange]);

  // 导航条目（缩略图 = 首张剧照，无图 → kind 图标骨架）
  const navItems = useMemo(() => data.items.map((it) => ({
    id: it.id,
    title: it.name || undefined,
    thumb: <ItemThumb kind={it.kind} storageKey={it.images[0]?.storageKey} dark={isDark} />,
  })), [data.items, isDark]);

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const infoBg = theme.node.fill;
  // 内容区表面（对齐主体卡 contentSurface）
  const contentSurface = isDark ? '#161616' : '#ffffff';

  const title = node.title ?? (data.title || t('canvasNodes.stage.productionManager'));
  const ActiveKindIcon = activeItem ? KIND_ICON[activeItem.kind] : Rabbit;
  const showNav = data.items.length > 1;

  return (
    <>
      {/* BaseNodeView 包整个节点（含导航）：NodeShell 按节点全尺寸渲染壳与 pin，
          pin 落在节点左右边缘；否则 pin 会渲染在内容区（右主区左缘，视觉贴着 sidebar）。
          导航按钮自带 onPointerDown stopPropagation，不会误触发节点拖拽。 */}
      <BaseNodeView
        node={node}
        pins={pins}
        isSelected={isSelected}
        isHovered={isHovered}
        title={title}
        color={PM_COLOR}
        connectionController={connectionController}
        forceShowPins={forceShowPins}
        invK={invK}
        titleIcon={<Rabbit size={Math.max(10, 13 * (invK ?? 1))} />}
        updateNode={updateNode}
        externalRenaming={externalRenaming}
        onRenameFinish={onRenameFinish}
        contentPadding="0"
        store={store}
      >
        <div style={{ display: 'flex', width: '100%', height: '100%', minHeight: 0 }}>
          {/* 左侧垂直导航（与堆叠/主体同一套 ThumbNav 框架） */}
          {showNav && (
            <ThumbNav
              orientation="vertical"
              items={navItems}
              activeIndex={activeIndex}
              total={data.items.length}
              onPrev={handlePrev}
              onNext={handleNext}
              onJump={handleJump}
            />
          )}

          {/* 右侧主区：封面舞台 + 信息条 */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* 封面舞台（当前条目首张剧照，contain）— 2026-08-22: 移除双击打开编辑器, 双击回归画布聚焦契约(viewport-focus-contract); 全屏编辑统一走胶囊菜单 */}
            <div style={coverAreaStyle(contentSurface)}>
              {activeItem ? (
                <ItemCover storageKey={activeItem.images[0]?.storageKey} dark={isDark} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
                  <Rabbit size={40} />
                  <span style={{ fontSize: 11, opacity: 0.75 }}>{t('productionManager.viewEmpty')}</span>
                </div>
              )}
            </div>

            {/* 信息条（低对比：图标 + 文字，不用色块徽章） */}
            <div style={infoBarStyle(infoBg)}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeItem ? (activeItem.name || t('productionManager.unnamed')) : (data.title || t('canvasNodes.stage.productionManager'))}
                  </span>
                  {activeItem && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, background: `${KIND_COLOR[activeItem.kind]}18`, color: KIND_COLOR[activeItem.kind], borderRadius: 999, padding: '1px 8px 1px 5px', fontSize: 10, fontWeight: 600, lineHeight: '18px' }}>
                      <ActiveKindIcon size={10} />
                      {t(`entity.${activeItem.kind}`)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeItem
                    ? (activeItem.consistency || t('productionManager.itemTotal', { count: data.items.length }))
                    : t('productionManager.itemTotal', { count: 0 })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </BaseNodeView>

      {/* 统筹编辑器 Modal */}
      {editorOpen && (
        <ProductionManagerModal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          data={data}
          initialActiveItemId={activeItem?.id ?? null}
          onDataChange={(next) => updateNode({ data: { ...(node.data as Record<string, unknown>), ...next } })}
        />
      )}
    </>
  );
});

// ===== 样式（无边线风格：背景分层，同主体卡基线） =====

function coverAreaStyle(contentSurface: string): CSSProperties {
  return {
    flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
    background: contentSurface,
  };
}

function infoBarStyle(bg: string): CSSProperties {
  return {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', background: bg,
  };
}
