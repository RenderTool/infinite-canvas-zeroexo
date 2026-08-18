/**
 * ThinkingRenderer - 深度思考渲染器（内置 'thinking' 类型）
 *
 * 视觉规范（与立项深度思考统一）：
 * - 标题为中性灰（暗色 rgba(255,255,255,0.7) / 亮色 rgba(0,0,0,0.55)）
 * - 正文左侧边线为中性灰（暗色 rgba(255,255,255,0.18) / 亮色 rgba(0,0,0,0.15)）
 * - 默认折叠，点击展开；title 从 meta.title 读取，默认 "深度思考"
 */

import { useState, type CSSProperties } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { MessageRendererProps } from '../types.js';

export function ThinkingRenderer({ message, theme }: MessageRendererProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(true);
  const title = (message.meta?.title as string | undefined) ?? '深度思考';

  const titleColor = theme.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)';
  const lineColor = theme.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';

  return (
    <div style={containerStyle(theme)}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        style={headerStyle(titleColor)}
      >
        <Sparkles size={12} />
        <span>{title}</span>
        <ChevronDown
          size={12}
          style={{
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {!collapsed && message.text && (
        <div style={thinkingBodyStyle(lineColor)}>
          <div style={{
            fontSize: 12,
            lineHeight: 1.7,
            color: theme.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {message.text}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== 样式 =====

const containerStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  borderRadius: '4px 12px 12px 12px',
  border: `1px solid ${theme.cardBorder}`,
  background: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.015)',
  padding: '8px 12px',
});

const headerStyle = (titleColor: string): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'transparent',
  border: 'none',
  color: titleColor,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
  lineHeight: 1.5,
});

const thinkingBodyStyle = (lineColor: string): CSSProperties => ({
  marginTop: 6,
  paddingLeft: 12,
  borderLeft: `2px solid ${lineColor}`,
});
