/**
 * AgentAvatar - 扁平风格 AI 助手头像（框架内置）
 *
 * 设计特点：
 * - 扁平圆角方形外观（borderRadius: 8px）
 * - 纯色背景 + 细描边（无渐变、无光晕）
 * - Lucide Bot 机器人图标
 * - 可选在线状态点
 *
 * 框架所有渲染器统一使用此头像，保证视觉一致。
 */
import { Bot } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';

export interface AgentAvatarProps {
  /** 主题强调色（hex 字符串） */
  accent: string;
  /** 是否深色模式 */
  isDark: boolean;
  /** 头像尺寸（默认 32） */
  size?: number;
  /** 是否显示在线状态点（右下角） */
  online?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 将 hex 颜色转为 rgba
 */
function hexToRgba(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith('#')) return `rgba(128, 128, 128, ${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function AgentAvatar({
  accent,
  isDark,
  size = 32,
  online = false,
  className,
}: AgentAvatarProps): ReactElement {
  // 扁平风格：纯色背景 + 细描边，无渐变光晕
  const fillBg = isDark
    ? hexToRgba(accent, 0.18)
    : hexToRgba(accent, 0.12);
  const stroke = isDark
    ? hexToRgba(accent, 0.45)
    : hexToRgba(accent, 0.35);

  const containerStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    position: 'relative',
    background: fillBg,
    border: `1px solid ${stroke}`,
    boxShadow: isDark
      ? 'inset 0 1px 0 rgba(255,255,255,0.04)'
      : 'inset 0 1px 0 rgba(255,255,255,0.6)',
    transition: 'transform 0.2s ease, border-color 0.2s ease',
  };

  const iconSize = Math.max(12, Math.round(size * 0.55));

  return (
    <span className={className} style={containerStyle} aria-label="AI 助手">
      <Bot
        size={iconSize}
        color={accent}
        strokeWidth={1.8}
        aria-hidden
      />
      {online && (
        <span
          style={onlineDotStyle(size, isDark)}
          aria-label="在线"
        />
      )}
    </span>
  );
}

function onlineDotStyle(size: number, isDark: boolean): CSSProperties {
  const dotSize = Math.max(6, Math.round(size * 0.28));
  return {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: dotSize,
    height: dotSize,
    borderRadius: '50%',
    background: '#10b981',
    border: `2px solid ${isDark ? '#1a1a1a' : '#ffffff'}`,
    boxShadow: '0 0 4px rgba(16, 185, 129, 0.6)',
  };
}
