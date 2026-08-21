/**
 * ProductionManagerView - 统筹节点视图（Plan#29 V3）
 *
 * 视觉 1:1 继承 SubjectNodeView（Plan#20 打磨成果），禁止自由发挥：
 * - BaseNodeView 壳（标题栏 + pins + 重命名，titleIcon=Clapperboard 琥珀色）
 * - 内容区 = 封面舞台（条目网格：asset-card 同款 239.2/135.4 缩略卡 + kind 徽章）+ 信息条（剧名 + 分组统计徽章）
 * - 详情编辑走胶囊菜单「详情」→ nodeActionBus 'productionManager:openEditor' → 打开 ProductionManagerModal
 * - 图片 draggable=false，拖拽节点不误触发素材投放
 */
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Clapperboard, UserRound, MapPin, Package } from 'lucide-react';
import type { NodeRendererProps } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, nodeActionBus, useHydratedContent } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import type { ProductionItem, ProductionItemKind, ProductionManagerData } from './production-manager-types';
import { ProductionManagerModal } from './ProductionManagerModal';

export interface ProductionManagerViewProps extends NodeRendererProps {
  connectionController: any;
  store?: any;
}

const PM_COLOR = '#f59e0b'; // 琥珀色（制片/统筹氛围）

const KIND_ICON: Record<ProductionItemKind, React.ComponentType<{ size?: number | string }>> = {
  character: UserRound,
  scene: MapPin,
  prop: Package,
};

const KIND_COLOR: Record<ProductionItemKind, string> = {
  character: '#5DDCFF',
  scene: '#4ade80',
  prop: '#fbbf24',
};

function parseData(data: Record<string, unknown> | undefined): ProductionManagerData {
  if (!data) return { title: '', items: [] };
  return {
    title: (data.title as string) ?? '',
    scriptId: data.scriptId as string | undefined,
    items: Array.isArray(data.items) ? (data.items as ProductionItem[]) : [],
  };
}

/** 条目缩略卡（asset-card 同款比例 239.2/135.4 + kind 徽章；无图 → kind 图标骨架） */
function ItemCard({ item, dark }: { item: ProductionItem; dark: boolean }): React.ReactElement {
  const firstKey = item.images[0]?.storageKey;
  const hydrated = useHydratedContent(firstKey ?? '', firstKey ? (getResourceUrl(firstKey, 'preview') ?? '') : '');
  const Icon = KIND_ICON[item.kind];
  const color = KIND_COLOR[item.kind];
  return (
    <div style={{
      position: 'relative', width: '100%', aspectRatio: '239.2 / 135.4', borderRadius: 8, overflow: 'hidden',
      background: dark ? 'rgba(255,255,255,0.02)' : '#ffffff',
      border: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : '#e5e7eb'}`,
    }}>
      {hydrated ? (
        <img src={hydrated} alt={item.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: dark ? 'rgba(255,255,255,0.35)' : 'rgba(15,23,42,0.3)' }}>
          <Icon size={22} />
        </div>
      )}
      {/* kind 徽章（与主体卡同款：color 20% 底 + 色字） */}
      <span style={{
        position: 'absolute', left: 4, bottom: 4,
        fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
        background: `${color}20`, color, backdropFilter: 'blur(4px)',
        maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {item.name || '—'}
      </span>
    </div>
  );
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
    const unsub = nodeActionBus.on('productionManager:openEditor', (event: { nodeId: string }) => {
      if (event.nodeId === node.id) setEditorOpen(true);
    });
    return unsub;
  }, [node.id]);

  const counts = useMemo(() => ({
    character: data.items.filter((i) => i.kind === 'character').length,
    scene: data.items.filter((i) => i.kind === 'scene').length,
    prop: data.items.filter((i) => i.kind === 'prop').length,
  }), [data.items]);

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const infoBg = theme.node.fill;
  // 内容区表面（对齐主体卡 contentSurface：明暗主题分支取中性表面色）
  const contentSurface = isDark ? '#161616' : '#ffffff';

  const title = node.title ?? (data.title || t('canvasNodes.stage.productionManager'));

  return (
    <>
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
        titleIcon={<Clapperboard size={Math.max(10, 13 * (invK ?? 1))} />}
        updateNode={updateNode}
        externalRenaming={externalRenaming}
        onRenameFinish={onRenameFinish}
        contentPadding="0"
        store={store}
      >
        <div style={cardRootStyle}>
          {/* 封面舞台：条目网格 */}
          <div style={coverAreaStyle(contentSurface)} onDoubleClick={() => setEditorOpen(true)}>
            {data.items.length === 0 ? (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
                <Clapperboard size={40} />
                <span style={{ fontSize: 11, opacity: 0.75 }}>{t('productionManager.viewEmpty')}</span>
              </div>
            ) : (
              <div style={{
                width: '100%', height: '100%', overflow: 'auto', padding: 10,
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8, alignContent: 'start',
              }}>
                {data.items.map((item) => <ItemCard key={item.id} item={item} dark={isDark} />)}
              </div>
            )}
          </div>

          {/* 信息条（与主体卡同款：名字 + 徽章 + 摘要） */}
          <div style={infoBarStyle(infoBg)}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {data.title || t('canvasNodes.stage.productionManager')}
                </span>
                <span style={kindBadgeStyle(KIND_COLOR.character)}>{t('entity.character')} {counts.character}</span>
                <span style={kindBadgeStyle(KIND_COLOR.scene)}>{t('entity.scene')} {counts.scene}</span>
                <span style={kindBadgeStyle(KIND_COLOR.prop)}>{t('entity.prop')} {counts.prop}</span>
              </div>
              <div style={{ fontSize: 10, color: textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('productionManager.itemTotal', { count: data.items.length })}
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
          onDataChange={(next) => updateNode({ data: { ...(node.data as Record<string, unknown>), ...next } })}
        />
      )}
    </>
  );
});

// ===== 样式（无边线风格：背景分层替代硬边框，遵循 DESIGN.md，同 SubjectNodeView） =====

const cardRootStyle: CSSProperties = {
  width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
  overflow: 'hidden', minHeight: 0,
};

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

function kindBadgeStyle(color: string): CSSProperties {
  return {
    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
    background: `${color}20`, color, flexShrink: 0,
  };
}
