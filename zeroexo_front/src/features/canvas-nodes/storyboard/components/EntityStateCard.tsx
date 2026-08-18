/**
 * EntityStateCard - 实体状态卡片组件
 *
 * 状态卡片：占位图 + 状态名称；状态切换下拉菜单；占位图重新生成按钮。
 */
import { ReactElement, useState } from 'react';import { Button, Dropdown, Tooltip } from 'antd';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import type { EntityState } from '../storyboard-types';

export interface EntityStateCardProps {
  states: EntityState[];
  currentStateId?: string;
  onStateChange?: (stateId: string) => void;
  onRegeneratePlaceholder?: (stateId: string) => void;
}

export function EntityStateCard({
  states,
  currentStateId,
  onStateChange,
  onRegeneratePlaceholder,
}: EntityStateCardProps): ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const bgCanvas = isDark ? '#171717' : '#ffffff';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';
  const bgCard = isDark ? '#1f1f1f' : '#f5f5f5';

  const currentState = states.find((s) => s.id === currentStateId) ?? states[0];
  const [imgError, setImgError] = useState(false);

  if (!currentState) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, color: mutedColor }}>
        {t('entityState.noStates')}
      </div>
    );
  }

  const dropdownItems = states.map((state) => ({
    key: state.id,
    label: state.name,
    onClick: () => onStateChange?.(state.id),
  }));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        border: `1px solid ${borderMuted}`,
        background: bgCanvas,
        overflow: 'hidden',
      }}
    >
      {/* 占位图区域 */}
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          background: bgCard,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          color: mutedColor,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {currentState.placeholderImageUrl && !imgError ? (
          <img
            src={currentState.placeholderImageUrl}
            alt={currentState.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
          />
        ) : (
          <span style={{ opacity: 0.5 }}>{t('entityState.placeholder')}</span>
        )}
        {onRegeneratePlaceholder && (
          <Tooltip title={t('entityState.regeneratePlaceholder')}>
            <Button
              size="small"
              type="text"
              icon={<RotateCcw size={12} />}
              onClick={(e) => { e.stopPropagation(); onRegeneratePlaceholder(currentState.id); }}
              style={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                color: mutedColor,
                background: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)',
                width: 22,
                height: 22,
                borderRadius: 4,
              }}
            />
          </Tooltip>
        )}
      </div>

      {/* 状态信息 */}
      <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        {onStateChange && states.length > 1 ? (
          <Dropdown menu={{ items: dropdownItems }} trigger={['click']}>
            <Button
              size="small"
              type="text"
              style={{ fontSize: 11, color: textColor, padding: '0 4px', fontWeight: 500 }}
            >
              {currentState.name} ▾
            </Button>
          </Dropdown>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 500, color: textColor }}>{currentState.name}</span>
        )}
        {currentState.id === currentStateId && (
          <span style={{ fontSize: 9, color: accent, background: `${accent}14`, padding: '1px 6px', borderRadius: 10 }}>
            {t('entityState.current')}
          </span>
        )}
      </div>
    </div>
  );
}