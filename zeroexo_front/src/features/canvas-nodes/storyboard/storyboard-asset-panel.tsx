/**
 * StoryboardAssetPanel - 分镜生产台左区：圣经资产面板（Plan#53 T5）
 *
 * 角色/场景/道具三分类，展示锚点句（身份锚点句逐字复用核心）、锁定标记、
 * 参考图缩略。资产点击可选中（供中区舞台高亮/插入引用）。
 */
import { memo, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, User, MapPin, Package, ImageIcon } from 'lucide-react';
import type { StoryboardEntity } from './storyboard-types';

export interface StoryboardAssetPanelProps {
  entities: StoryboardEntity[];
  selectedEntityId?: string | null;
  onSelectEntity?: (entityId: string) => void;
  theme: any;
  isDark: boolean;
}

const KIND_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  character: { label: '角色', icon: <User size={12} />, color: '#e94560' },
  scene: { label: '场景', icon: <MapPin size={12} />, color: '#0ea5e9' },
  prop: { label: '道具', icon: <Package size={12} />, color: '#f59e0b' },
};

export const StoryboardAssetPanel = memo(function StoryboardAssetPanel({
  entities, selectedEntityId, onSelectEntity, theme, isDark,
}: StoryboardAssetPanelProps): ReactElement {
  const { t } = useTranslation();
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const panelBg = isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)';

  const grouped = useMemo(() => {
    const kinds: Array<'character' | 'scene' | 'prop'> = ['character', 'scene', 'prop'];
    return kinds.map((kind) => ({
      kind,
      meta: KIND_META[kind] ?? { label: kind, icon: <Package size={12} />, color: '#999' },
      items: entities.filter((e) => e.kind === kind),
    }));
  }, [entities]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: panelBg, borderRadius: 8, border: `1px solid ${cardBorder}`, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: textPrimary, borderBottom: `1px solid ${cardBorder}`, flexShrink: 0 }}>
        {t('storyboard.assets', '圣经资产')}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {grouped.map(({ kind, meta, items }) => (
          <div key={kind}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {meta.icon}
              <span>{t(`storyboard.assetKind.${kind}`, meta.label)}</span>
              <span style={{ opacity: 0.5 }}>({items.length})</span>
            </div>
            {items.length === 0 ? (
              <div style={{ fontSize: 10, color: textMuted, opacity: 0.6, padding: '2px 0 6px' }}>{t('storyboard.noAssets', '暂无')}</div>
            ) : (
              items.map((e) => {
                const isSelected = selectedEntityId === e.id;
                const primaryImg = e.referenceImages?.find((img) => img.isPrimary) ?? e.referenceImages?.[0];
                return (
                  <div
                    key={e.id}
                    onClick={() => onSelectEntity?.(e.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: isSelected ? (isDark ? 'rgba(233,69,96,0.14)' : 'rgba(233,69,96,0.08)') : 'transparent',
                      border: `1px solid ${isSelected ? meta.color : 'transparent'}`,
                      marginBottom: 4,
                      transition: 'background 0.1s',
                    }}
                  >
                    {/* 参考图缩略 */}
                    <div style={{ width: 32, height: 32, borderRadius: 4, overflow: 'hidden', background: isDark ? '#211d1a' : '#f5f5f4', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${cardBorder}` }}>
                      {primaryImg?.storageKey ? (
                        <img src={primaryImg.storageKey} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <ImageIcon size={14} color={textMuted} style={{ opacity: 0.4 }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                        {e.anchorLocked && <Lock size={10} color={meta.color} />}
                      </div>
                      {e.anchorSentence ? (
                        <div style={{ fontSize: 10, color: textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {e.anchorSentence}
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: textMuted, opacity: 0.5 }}>{t('storyboard.noAnchor', '无锚点句')}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ))}
        {entities.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: 120, color: textMuted, fontSize: 11, opacity: 0.7 }}>
            <Package size={20} />
            <span>{t('storyboard.assetPanelEmpty', '暂无圣经资产，请先在剧管/分镜表中创建主体')}</span>
          </div>
        )}
      </div>
    </div>
  );
});
