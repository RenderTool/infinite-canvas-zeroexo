/**
 * CreationSyncBadge - 自动保存状态指示器
 *
 * 两种模式：
 * - default：画布风格绿色圆点 + 标签
 * - compact：绿色 Check 图标 + 标签（适合内联在标题旁）
 */

import { Tooltip } from 'antd';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { type CSSProperties } from 'react';
import i18n from '@/i18n/config';

export type SaveStatus = 'idle' | 'saving' | 'error' | 'unsaved';

interface CreationSyncBadgeProps {
  status: SaveStatus;
  lastSavedAt?: string | null;
  theme: {
    toolbar: {
      text: string;
      accent: string;
      textMuted: string;
      danger?: string;
    };
  };
  /** compact 模式：绿色勾 + 小字，适合内联标题旁 */
  compact?: boolean;
}

const STATUS_CONFIG: Record<SaveStatus, { color: string; pulse: boolean; label: string; icon: 'check' | 'spinner' | 'alert' }> = {
  saving: { color: '#f59e0b', pulse: true, label: i18n.t('syncBadge.saving'), icon: 'spinner' },
  idle: { color: '#10b981', pulse: false, label: i18n.t('syncBadge.idle'), icon: 'check' },
  error: { color: '#ef4444', pulse: false, label: i18n.t('syncBadge.error'), icon: 'alert' },
  unsaved: { color: '#999', pulse: false, label: i18n.t('syncBadge.unsaved'), icon: 'alert' },
};

export function CreationSyncBadge({ status, lastSavedAt, theme: _theme, compact = false }: CreationSyncBadgeProps): React.ReactElement {
  const cfg = STATUS_CONFIG[status];
  const tooltipText = lastSavedAt ? i18n.t('syncBadge.lastSavedAt', { time: new Date(lastSavedAt).toLocaleTimeString() }) : undefined;

  if (compact) {
    return (
      <Tooltip title={tooltipText ?? cfg.label}>
        <div
          style={compactContainerStyle}
        >
        {cfg.icon === 'check' ? (
          <Check size={12} strokeWidth={2.5} color={cfg.color} />
        ) : cfg.icon === 'spinner' ? (
          <Loader2 size={12} color={cfg.color} style={{ animation: 'spin 1s linear infinite' }} />
        ) : (
          <AlertCircle size={12} color={cfg.color} />
        )}
        {/* Plan#50 T13:去掉状态文本,悬停按当前状态显示 tooltip(已保存/保存中/保存失败/未保存) */}
      </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={tooltipText ?? cfg.label}>
      <div
        style={containerStyle}
      >
      <div
        style={{
          ...dotStyle,
          backgroundColor: cfg.color,
          animation: cfg.pulse ? 'zeroexo-pulse 1.2s ease-in-out infinite' : 'none',
          opacity: cfg.pulse ? 1 : 0.8,
        }}
      />
      {/* Plan#50 T13:去掉状态文本,悬停按当前状态显示 tooltip */}
    </div>
    </Tooltip>
  );
}

const compactContainerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
};

const containerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 36,
  padding: '0 8px',
};

const dotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
};
