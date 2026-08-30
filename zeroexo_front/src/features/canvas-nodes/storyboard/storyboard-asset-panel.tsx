/**
 * StoryboardAssetPanel - 分镜生产台左侧边栏：资产面板（Plan#53 T5）
 *
 * 无标题栏无 tab 导航，直接展示全部资产卡片列表。
 * 右上角悬浮上传/新建按钮。
 */
import { memo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Wand2, ImageIcon, Plus } from 'lucide-react';
import type { StoryboardEntity } from './storyboard-types';

export interface StoryboardAssetPanelProps {
  entities: StoryboardEntity[];
  selectedEntityId?: string | null;
  onSelectEntity?: (entityId: string) => void;
  onAddEntity?: (kind: string) => void;
  onGeneratePortrait?: (entityId: string) => void;
  collapsed?: boolean;
  theme: any;
  isDark: boolean;
}

export const StoryboardAssetPanel = memo(function StoryboardAssetPanel({
  entities, selectedEntityId, onSelectEntity, onAddEntity, onGeneratePortrait,
  theme, isDark,
}: StoryboardAssetPanelProps): ReactElement {
  const { t } = useTranslation();

  const OPENCUT_ACCENT = '#3b82f6';
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = OPENCUT_ACCENT;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const tabBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const tabActiveBg = isDark ? 'rgba(59,130,246,0.14)' : 'rgba(59,130,246,0.08)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* 卡片列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entities.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: 100, color: textMuted, fontSize: 10, opacity: 0.7 }}>
            <span>{t('storyboard.assetPanelEmpty', '暂无资产')}</span>
            {onAddEntity && (
              <button
                type="button"
                onClick={() => onAddEntity('character')}
                style={{ fontSize: 10, color: accent, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Plus size={11} />
                {t('storyboard.createEntity', '新建')}
              </button>
            )}
          </div>
        ) : (
          entities.map((e) => {
            const isSelected = selectedEntityId === e.id;
            const primaryImg = e.referenceImages?.find((img) => img.isPrimary) ?? e.referenceImages?.[0];
            return (
              <div
                key={e.id}
                onClick={() => onSelectEntity?.(e.id)}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '8px 10px 12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  background: isSelected ? tabActiveBg : 'transparent',
                  border: `1px solid ${isSelected ? accent : 'transparent'}`,
                  transition: 'all 0.15s',
                  transform: isSelected ? 'translateY(-1px)' : 'none',
                  boxShadow: isSelected ? `0 2px 8px ${accent}22` : 'none',
                }}
                onMouseEnter={(e) => { if (!isSelected) { e.currentTarget.style.background = tabBg; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'none'; } }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 14, overflow: 'hidden', background: isDark ? theme.canvas.background : '#f5f5f4', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${cardBorder}` }}>
                  {primaryImg?.storageKey ? (
                    <img src={primaryImg.storageKey} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <ImageIcon size={16} color={textMuted} style={{ opacity: 0.4 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                    {e.anchorLocked && <Lock size={9} color={accent} />}
                  </div>
                  {e.anchorSentence ? (
                    <div style={{ fontSize: 11, color: textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.4 }}>
                      &ldquo;{e.anchorSentence}&rdquo;
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: textMuted, opacity: 0.5 }}>{t('storyboard.noAnchor', '无锚点句')}</div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 1 }}>
                    {onGeneratePortrait && (
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); onGeneratePortrait(e.id); }}
                        title={t('storyboard.generatePortrait', '生成定妆图')}
                        style={{ fontSize: 10, color: accent, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 2 }}
                      >
                        <Wand2 size={10} />
                        {t('storyboard.generate', '生成')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});