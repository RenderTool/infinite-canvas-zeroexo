/**
 * StepView - Step 分镜视图组件
 *
 * 显示当前 Step 的镜头信息、关联角色卡片（带占位图）、场景/道具、冲突提示。
 */
import { type ReactElement, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { StepRecord, Shot, StoryboardEntity, EntityConflict } from '../storyboard-types';
import { ENTITY_KIND_META } from '../storyboard-utils';

export interface StepViewProps {
  step: StepRecord;
  entities: StoryboardEntity[];
  conflicts: EntityConflict[];
  allShots: Shot[];
  onEntityClick?: (entityId: string) => void;
  onConflictClick?: (groupId: string) => void;
}

export function StepView({
  step,
  entities,
  conflicts,
  onEntityClick,
  onConflictClick,
}: StepViewProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const bgCard = isDark ? '#1f1f1f' : '#f5f5f5';

  const shot = step.shot;
  const stepEntities = useMemo(
    () => entities.filter((e) => step.entityIds.includes(e.id)),
    [entities, step.entityIds],
  );
  const stepConflicts = useMemo(
    () => conflicts.filter((c) => step.conflictIds.includes(c.groupId)),
    [conflicts, step.conflictIds],
  );

  const characters = stepEntities.filter((e) => e.kind === 'character');
  const scenes = stepEntities.filter((e) => e.kind === 'scene');
  const props = stepEntities.filter((e) => e.kind === 'prop');

  const renderEntityCard = (entity: StoryboardEntity) => (
    <div
      key={entity.id}
      onClick={() => onEntityClick?.(entity.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        background: bgCard,
        border: `1px solid ${borderMuted}`,
        cursor: onEntityClick ? 'pointer' : 'default',
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
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
        {entity.placeholderImageUrl ? (
          <img src={entity.placeholderImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          ENTITY_KIND_META[entity.kind].emoji
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {entity.name}
        </div>
        <div style={{ fontSize: 10, color: mutedColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t(ENTITY_KIND_META[entity.kind].labelKey)}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, height: '100%', overflow: 'auto' }}>
      {/* 镜头信息 */}
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 8,
          background: bgCard,
          border: `1px solid ${borderMuted}`,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: textColor, marginBottom: 6 }}>
          {t('stepView.shotNumber', { number: shot.number })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11 }}>
          <span style={{ color: mutedColor }}>{t('stepView.shotId')}</span>
          <span style={{ color: textColor }}>{shot.id}</span>
          <span style={{ color: mutedColor }}>{t('stepView.duration')}</span>
          <span style={{ color: textColor }}>{shot.duration}s</span>
          <span style={{ color: mutedColor }}>{t('stepView.shotSize')}</span>
          <span style={{ color: accent }}>{shot.shotType}</span>
          <span style={{ color: mutedColor }}>{t('stepView.cameraMovement')}</span>
          <span style={{ color: textColor }}>{shot.cameraMovement}</span>
        </div>
        {shot.description && (
          <div style={{ marginTop: 6, fontSize: 11, color: mutedColor, lineHeight: 1.5 }}>
            {shot.description}
          </div>
        )}
      </div>

      {/* 角色卡片 */}
      {characters.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: mutedColor, marginBottom: 6 }}>{t('stepView.characters')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {characters.map(renderEntityCard)}
          </div>
        </div>
      )}

      {/* 场景/道具 */}
      {(scenes.length > 0 || props.length > 0) && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: mutedColor, marginBottom: 6 }}>{t('stepView.scenesProps')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...scenes, ...props].map(renderEntityCard)}
          </div>
        </div>
      )}

      {/* 冲突提示 */}
      {stepConflicts.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: mutedColor, marginBottom: 6 }}>{t('stepView.conflicts')}</div>
          {stepConflicts.map((conflict) => (
            <div
              key={conflict.groupId}
              onClick={() => onConflictClick?.(conflict.groupId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 10px',
                borderRadius: 6,
                background: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.08)',
                border: `1px solid ${isDark ? 'rgba(251,191,36,0.3)' : 'rgba(251,191,36,0.2)'}`,
                cursor: onConflictClick ? 'pointer' : 'default',
                marginBottom: 4,
              }}
            >
              <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <div style={{ fontSize: 11, color: textColor, flex: 1 }}>
                {conflict.entities.map((e) => e.name).join(' / ')}
                {conflict.suggestedName && (
                  <span style={{ color: mutedColor }}> → {t('entity.suggestedName')}: {conflict.suggestedName}</span>
                )}
              </div>
              <span style={{ fontSize: 10, color: mutedColor, flexShrink: 0 }}>
                {(conflict.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {stepEntities.length === 0 && stepConflicts.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: mutedColor }}>
          {t('stepView.noEntities')}
        </div>
      )}
    </div>
  );
}