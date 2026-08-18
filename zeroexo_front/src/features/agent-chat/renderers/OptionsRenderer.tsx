/**
 * OptionsRenderer - 通用选项卡渲染器（内置 'options' 类型）
 *
 * 数据驱动：message.options（AgentOptionGroup）驱动卡片网格。
 * - 单选：点击卡片立即触发 callbacks.onSelectOption(stepKey, value, label)
 * - 多选：本地选中，点「确认选择」触发 callbacks.onMultiConfirmOption
 * - 只读：options.items 中任一 item.checked 为 true 时展示已确认状态
 * 视觉与其余消息框统一（深度思考配色），不依赖具体业务主题。
 */

import { useState, useCallback, useMemo, type CSSProperties } from 'react';
import { Tooltip } from 'antd';
import { Check, CheckCheck } from 'lucide-react';
import type { MessageRendererProps } from '../types.js';

export function OptionsRenderer({ message, theme, callbacks }: MessageRendererProps): React.ReactElement {
  const options = message.options;
  const items = options?.items ?? [];
  const isMulti = options?.multi ?? false;
  const readonly = items.some((it) => it.checked);

  const [selectedValues, setSelectedValues] = useState<Set<string>>(new Set());

  const checkedSet = useMemo(
    () => new Set(items.filter((it) => it.checked).map((it) => it.value)),
    [items],
  );

  const handleCardClick = useCallback(
    (value: string, label: string) => {
      if (readonly) return;
      if (isMulti) {
        setSelectedValues((prev) => {
          const next = new Set(prev);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          return next;
        });
      } else {
        callbacks.onSelectOption?.(message.stepKey, value, label);
      }
    },
    [readonly, isMulti, message.stepKey, callbacks],
  );

  const handleMultiConfirm = useCallback(() => {
    const picked = items.filter((it) => selectedValues.has(it.value));
    if (picked.length === 0) return;
    callbacks.onMultiConfirmOption?.(
      message.stepKey,
      picked.map((it) => it.value),
      picked.map((it) => it.label),
    );
  }, [items, selectedValues, message.stepKey, callbacks]);

  return (
    <div>
      {/* 引导语气泡 */}
      {message.guideText && (
        <div style={{
          ...guideBubbleStyle(theme),
          marginBottom: 10,
        }}>
          {message.guideText}
        </div>
      )}

      {/* 选项卡片网格 */}
      <div style={gridStyle}>
        {items.map((item) => {
          const isSelected = readonly
            ? checkedSet.has(item.value)
            : selectedValues.has(item.value);
          return (
            <Tooltip key={item.value} title={item.desc}>
            <div
              onClick={() => handleCardClick(item.value, item.label)}
              style={cardStyle({
                selected: isSelected,
                theme,
                ai: !!item.ai,
                readonly,
              })}
            >
              {item.ai && (
                <div style={aiBadgeStyle(theme)}>AI</div>
              )}
              {isSelected && (
                <div style={checkMarkStyle(theme.accent)}>
                  <Check size={12} color="#fff" />
                </div>
              )}
              {item.icon && (
                <div style={iconStyle}>
                  <span style={{ fontSize: 22 }}>{item.icon}</span>
                </div>
              )}
              <div style={labelStyle}>{item.label}</div>
              {item.desc && <div style={descStyle(theme)}>{item.desc}</div>}
            </div>
            </Tooltip>
          );
        })}
      </div>

      {/* 多选确认 */}
      {isMulti && selectedValues.size > 0 && !readonly && (
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={confirmBtnStyle(theme.accent)}
            onClick={handleMultiConfirm}
          >
            <CheckCheck size={14} />
            <span>确认选择（{selectedValues.size}）</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ===== 样式 =====

const guideBubbleStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  padding: '9px 13px',
  fontSize: 13,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: theme.cardBg,
  border: `1px solid ${theme.cardBorder}`,
  color: theme.labelColor,
  borderRadius: '4px 12px 12px 12px',
});

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: 8,
  padding: '4px 0 8px',
};

const iconStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 6,
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textAlign: 'center',
  marginBottom: 2,
};

const descStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  fontSize: 11,
  color: theme.mutedColor,
  textAlign: 'center',
  lineHeight: 1.4,
});

const checkMarkStyle = (accent: string): CSSProperties => ({
  position: 'absolute',
  top: 4,
  right: 4,
  width: 18,
  height: 18,
  borderRadius: '50%',
  background: accent,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const aiBadgeStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  position: 'absolute',
  top: 4,
  left: 4,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 8,
  fontWeight: 700,
  lineHeight: 1,
  padding: '2px 4px',
  borderRadius: 3,
  color: theme.isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)',
  background: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  border: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
  opacity: 0.9,
});

function cardStyle({
  selected,
  theme,
  ai,
  readonly,
}: {
  selected: boolean;
  theme: MessageRendererProps['theme'];
  ai?: boolean;
  readonly?: boolean;
}): CSSProperties {
  const base: CSSProperties = {
    position: 'relative',
    padding: '14px',
    borderRadius: 12,
    transition: 'all 0.15s ease',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    userSelect: 'none',
  };
  if (readonly) {
    return {
      ...base,
      cursor: 'default',
      background: selected ? (theme.isDark ? `${theme.accent}18` : `${theme.accent}08`) : theme.cardBg,
      border: `1px solid ${selected ? theme.accent : theme.cardBorder}`,
      color: selected ? theme.accent : theme.labelColor,
      opacity: 0.92,
    };
  }
  return {
    ...base,
    cursor: 'pointer',
    background: selected
      ? theme.isDark ? `${theme.accent}18` : `${theme.accent}08`
      : ai
        ? (theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)')
        : theme.cardBg,
    border: `1px solid ${selected ? theme.accent : theme.cardBorder}`,
    color: selected ? theme.accent : theme.labelColor,
  };
}

const confirmBtnStyle = (accent: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 14px',
  borderRadius: 8,
  border: 'none',
  background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1.5,
});
