/**
 * BannerRenderer - 状态横幅渲染器（内置 'banner' 类型）
 *
 * 居中状态条：message.text 为主文案（如 "已选择「抖音」"）。
 * 用于确认/完成/提示类轻量消息，不占用对话主视觉。
 */

import { type CSSProperties } from 'react';
import type { MessageRendererProps } from '../types.js';

export function BannerRenderer({ message, theme }: MessageRendererProps): React.ReactElement {
  return (
    <div style={bannerStyle(theme)}>
      <span style={{ fontSize: 12, lineHeight: 1.6 }}>{message.text}</span>
    </div>
  );
}

const bannerStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 10,
  background: theme.isDark ? `${theme.accent}14` : `${theme.accent}0a`,
  border: `1px solid ${theme.isDark ? `${theme.accent}30` : `${theme.accent}20`}`,
  color: theme.accent,
  fontWeight: 500,
  maxWidth: '80%',
  margin: '0 auto',
  textAlign: 'center',
});
