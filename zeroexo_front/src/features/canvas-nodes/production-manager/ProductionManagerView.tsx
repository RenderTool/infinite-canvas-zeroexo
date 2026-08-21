/**
 * ProductionManagerView - 统筹节点视图（剧级聚合卡，Plan#29 V3）
 *
 * 顶部：剧标题 + 分组统计（演员/场景/道具）
 * 内容：条目网格（kind 色徽章 + 首张剧照缩略图），超出显示 +N
 * 胶囊「详情」/双击 → 打开 ProductionManagerModal 编辑条目
 */
import { memo, useEffect, useMemo, useState } from 'react';
import type { NodeRendererProps } from '@zeroexo/core';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { useTheme } from '@zeroexo/plugin-theme';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { useTranslation } from 'react-i18next';
import { UserRound, MapPin, Package, Clapperboard } from 'lucide-react';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { ProductionManagerModal } from './ProductionManagerModal';
import type { ProductionItem, ProductionItemKind, ProductionManagerData } from './production-manager-types';

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

export function createProductionManagerDefaultViewData(): ProductionManagerData {
  return { title: '统筹', items: [] };
}

function parseData(data: Record<string, unknown> | undefined): ProductionManagerData {
  if (!data) return createProductionManagerDefaultViewData();
  return {
    title: (data.title as string) ?? '统筹',
    scriptId: data.scriptId as string | undefined,
    items: Array.isArray(data.items) ? (data.items as ProductionItem[]) : [],
  };
}

/** 条目缩略图（首张剧照 + kind 徽章） */
const ItemThumb = memo(function ItemThumb({ item, theme }: { item: ProductionItem; theme: ReturnType<typeof useTheme>['theme'] }) {
  const firstKey = item.images[0]?.storageKey;
  const hydrated = useHydratedContent(firstKey, firstKey ? (getResourceUrl(firstKey, 'preview') ?? '') : '');
  const Icon = KIND_ICON[item.kind];
  return (
    <div style={{ position: 'relative', width: 64, height: 64, borderRadius: 8, overflow: 'hidden', background: 'rgba(127,127,127,0.15)', flexShrink: 0 }}>
      {hydrated ? (
        <img src={hydrated} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} />
        </div>
      )}
      <span style={{
        position: 'absolute', left: 3, bottom: 3, width: 7, height: 7, borderRadius: '50%',
        background: KIND_COLOR[item.kind], border: `1px solid ${theme.mode === 'dark' ? '#000' : '#fff'}`,
      }} />
    </div>
  );
});

export const ProductionManagerView = memo(function ProductionManagerView({
  node, isSelected, updateNode,
}: NodeRendererProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;

  const data = useMemo(() => parseData(node.data as Record<string, unknown> | undefined), [node.data]);
  const [editorOpen, setEditorOpen] = useState(false);

  // 胶囊「详情」事件 → 打开编辑器
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

  const MAX_VISIBLE = 8;
  const visible = data.items.slice(0, MAX_VISIBLE);
  const overflow = data.items.length - visible.length;

  return (
    <div
      style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        borderRadius: 12, overflow: 'hidden',
        background: isDark ? '#17181c' : '#fbfaf7',
        outline: isSelected ? `2px solid ${theme.toolbar.accent}` : `1px solid ${border}`,
      }}
      onDoubleClick={() => setEditorOpen(true)}
    >
      {/* 头部：标题 + 统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
        <Clapperboard size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.title}
        </span>
        <span style={{ fontSize: 10, color: textMuted, flexShrink: 0 }}>
          {t('entity.character')} {counts.character} · {t('entity.scene')} {counts.scene} · {t('entity.prop')} {counts.prop}
        </span>
      </div>

      {/* 条目网格 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
        {data.items.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: textMuted }}>
            <Clapperboard size={26} style={{ opacity: 0.4 }} />
            <span style={{ fontSize: 11 }}>{t('productionManager.viewEmpty')}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 10, justifyItems: 'center' }}>
            {visible.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: 64, cursor: 'pointer' }} onClick={() => setEditorOpen(true)}>
                  <ItemThumb item={item} theme={theme} />
                  <span style={{
                    fontSize: 9, color: text, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 2,
                  }}>
                    <Icon size={8} />
                    {item.name || t('productionManager.unnamed')}
                  </span>
                </div>
              );
            })}
            {overflow > 0 && (
              <div style={{ width: 64, height: 64, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(127,127,127,0.1)', color: textMuted, fontSize: 13, fontWeight: 700, cursor: 'pointer' }} onClick={() => setEditorOpen(true)}>
                +{overflow}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 编辑器 Modal */}
      {editorOpen && (
        <ProductionManagerModal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          data={data}
          onDataChange={(next) => updateNode({ data: { ...next } })}
        />
      )}
    </div>
  );
});
