/**
 * canvas-agent/ui/context/theme-context.ts — 主题上下文
 *
 * 直接透传 @zeroexo/plugin-theme 的 useTheme()，
 * 提供类型安全的 theme tokens 快捷访问。
 */

import { useTheme } from '@zeroexo/plugin-theme';

export interface AgentThemeTokens {
  accent: string;
  isDark: boolean;
  background: string;
  border: string;
  text: string;
  textMuted: string;
  danger: string;
  cardBg: string;
  cardBorder: string;
}

export function useAgentTheme(): AgentThemeTokens {
  const { theme, mode } = useTheme();
  const isDark = mode === 'dark';

  return {
    accent: theme.toolbar.accent,
    isDark,
    background: theme.toolbar.background,
    border: theme.toolbar.border,
    text: theme.toolbar.text,
    textMuted: theme.toolbar.textMuted,
    danger: theme.toolbar.danger,
    cardBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
    cardBorder: theme.toolbar.border,
  };
}