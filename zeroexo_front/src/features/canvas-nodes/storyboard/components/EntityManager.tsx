/**
 * EntityManager - @提及主体管理组件
 *
 * 提供 @提及主体下拉选择 UI，供分镜表格中画面描述编辑区使用。
 */
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoryboardEntity } from '../storyboard-types';
import { Z_INDEX } from '@/shared/constants/z-index.js';

export interface MentionDropdownProps {
  /** 当前@提及的镜头 id，非 null 时显示下拉 */
  mentionShotId: string | null;
  /** 全部主体列表 */
  entities: StoryboardEntity[];
  /** 选择主体回调 */
  onSelect: (entity: StoryboardEntity) => void;
  /** 主题色 */
  textColor: string;
  mutedColor: string;
  bgHover: string;
  bgCanvas: string;
  borderMuted: string;
}

/**
 * MentionDropdown - @提及主体下拉选择
 *
 * 在画面描述编辑区输入 @ 时弹出，供选择已添加的主体（角色/场景/道具）。
 * 由父组件控制显隐（mentionOpen && mentionShotId === shot.id）。
 */
export function MentionDropdown({
  mentionShotId,
  entities,
  onSelect,
  textColor,
  mutedColor,
  bgHover,
  bgCanvas,
  borderMuted,
}: MentionDropdownProps): ReactElement | null {
  const { t } = useTranslation();
  if (!mentionShotId) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        // 全局 z-index 体系:下拉菜单统一用 Z_INDEX.DROPDOWN(1000),非 SIDEBAR(50)
        zIndex: Z_INDEX.DROPDOWN,
        width: 220,
        maxHeight: 160,
        overflow: 'auto',
        border: `1px solid ${borderMuted}`,
        borderRadius: 4,
        background: bgCanvas,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}
    >
      <div
        style={{
          padding: '4px 6px',
          fontSize: 10,
          color: mutedColor,
          borderBottom: `1px solid ${borderMuted}`,
        }}
      >
        {t('entity.selectEntity')}
      </div>
      {entities.map((entity) => (
        <div
          key={entity.id}
          onClick={() => onSelect(entity)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 6px',
            cursor: 'pointer',
            fontSize: 11,
            color: textColor,
            borderRadius: 2,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = bgHover;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = 'transparent';
          }}
        >
          <span
            style={{
              width: 14,
              textAlign: 'center' as const,
              fontSize: 10,
              color: mutedColor,
            }}
          >
            {entity.kind === 'character'
              ? '\u{1F464}'
              : entity.kind === 'scene'
                ? '\u{1F4CD}'
                : '\u{1F4E6}'}
          </span>
          <span style={{ flex: 1 }}>{entity.name}</span>
          <span style={{ fontSize: 10, color: mutedColor }}>
            {entity.kind === 'character'
              ? t('entity.character')
              : entity.kind === 'scene'
                ? t('entity.scene')
                : t('entity.prop')}
          </span>
        </div>
      ))}
      {entities.length === 0 && (
        <div
          style={{
            padding: 8,
            fontSize: 11,
            color: mutedColor,
            textAlign: 'center' as const,
          }}
        >
          {t('entity.noEntities')}
        </div>
      )}
    </div>
  );
}