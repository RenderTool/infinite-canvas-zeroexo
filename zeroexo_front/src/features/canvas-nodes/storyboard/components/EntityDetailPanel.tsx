/**
 * EntityDetailPanel - 实体详情面板组件
 *
 * 实体详情：名称/类型/描述；状态列表：每个状态有名称/占位图/描述；编辑/删除按钮。
 */
import { type ReactElement } from 'react';
import { Button, Tooltip } from 'antd';
import { Edit3, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { StoryboardEntity } from '../storyboard-types';

export interface EntityDetailPanelProps {
  entity: StoryboardEntity;
  onEdit?: (entityId: string) => void;
  onDelete?: (entityId: string) => void;
}

export function EntityDetailPanel({
  entity,
  onEdit,
  onDelete,
}: EntityDetailPanelProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const bgCanvas = isDark ? '#171717' : '#ffffff';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const bgCard = isDark ? '#1f1f1f' : '#f5f5f5';

  const kindLabel = entity.kind === 'character' ? t('entity.character') : entity.kind === 'scene' ? t('entity.scene') : t('entity.prop');
  const sourceLabel = entity.source === 'ai_generated' ? t('entity.sourceAiGenerated') : entity.source === 'user_manual' ? t('entity.sourceUserManual') : entity.source === 'merged' ? t('entity.sourceMerged') : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bgCanvas, borderRadius: 8, border: `1px solid ${borderMuted}`, overflow: 'hidden' }}>
      {/* 头部 */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${borderMuted}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{entity.name}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {onEdit && (
            <Tooltip title={t('storyboard.edit')}>
              <Button size="small" type="text" icon={<Edit3 size={13} />} onClick={() => onEdit(entity.id)} style={{ color: mutedColor, width: 24, height: 24 }} />
            </Tooltip>
          )}
          {onDelete && (
            <Tooltip title={t('common.delete')}>
              <Button size="small" type="text" danger icon={<Trash2 size={13} />} onClick={() => onDelete(entity.id)} style={{ width: 24, height: 24 }} />
            </Tooltip>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 基本信息 */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: mutedColor, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{t('entity.basicInfo')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 11 }}>
            <span style={{ color: mutedColor }}>{t('entity.type')}</span>
            <span style={{ color: textColor }}>{kindLabel}</span>
            <span style={{ color: mutedColor }}>{t('entity.source')}</span>
            <span style={{ color: textColor }}>{sourceLabel || '—'}</span>
            {entity.mergedFrom && entity.mergedFrom.length > 0 && (
              <>
                <span style={{ color: mutedColor }}>{t('entity.mergedFrom')}</span>
                <span style={{ color: textColor }}>{entity.mergedFrom.join(', ')}</span>
              </>
            )}
          </div>
        </div>

        {/* 描述 */}
        {entity.description && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: mutedColor, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{t('entity.description')}</div>
            <div style={{ fontSize: 11, color: mutedColor, lineHeight: 1.5, background: bgCard, padding: '6px 8px', borderRadius: 4 }}>
              {entity.description}
            </div>
          </div>
        )}

        {/* 状态列表 */}
        {entity.states && entity.states.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: mutedColor, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('entity.statesList', { count: entity.states.length })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {entity.states.map((state) => (
                <div
                  key={state.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: bgCard,
                    border: `1px solid ${borderMuted}`,
                    borderLeft: state.id === entity.defaultStateId ? `3px solid ${accent}` : `1px solid ${borderMuted}`,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      background: isDark ? '#2a2a2a' : '#e0e0e0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: mutedColor,
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}
                  >
                    {state.placeholderImageUrl ? (
                      <img src={state.placeholderImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {state.name}
                      {state.id === entity.defaultStateId && (
                        <span style={{ fontSize: 9, color: accent, marginLeft: 4 }}>{t('entity.default')}</span>
                      )}
                    </div>
                    {state.description && (
                      <div style={{ fontSize: 10, color: mutedColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {state.description}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}