/**
 * ThemeProvider - 主题上下文 Provider(React Context 注入)
 *
 * 设计:
 * - 受控/非受控双模式(传 mode 受控,不传则内部 useState 管理)
 * - 主题数据来自 @zeroexo/shared 的 THEMES 映射表
 * - useTheme() 在 Provider 外使用抛错(开发期 fail-fast)
 * - useThemeContext() 内部使用,返回 null 不抛错(供 AnimatedThemeToggler 优雅降级)
 *
 * 零运行时依赖(react/react-dom 作为 peerDependencies)
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ThemeMode, ThemeConfig } from '@zeroexo/shared';
import { THEMES } from '@zeroexo/shared';

export interface ThemeContextValue {
  /** 当前主题完整 token 数据 */
  theme: ThemeConfig;
  /** 当前主题模式 */
  mode: ThemeMode;
  /** 设置主题模式(受控时仅触发 onModeChange,非受控时同步内部 state) */
  setMode: (mode: ThemeMode) => void;
  /** 在 dark <-> light 之间切换 */
  toggle: () => void;
}

export interface ThemeProviderProps {
  /** 非受控初始模式(默认 'dark') */
  initialMode?: ThemeMode;
  /** 受控模式(传入则受控,内部不维护 state) */
  mode?: ThemeMode;
  /** 模式变更回调 */
  onModeChange?: (mode: ThemeMode) => void;
  children: React.ReactNode;
}

/** 内部 Context(默认 null,允许 useThemeContext 在 Provider 外返回 null) */
const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = 'zeroexo:themeMode';

/** 从 localStorage 读取已保存的主题模式(非受控模式下作为初始值) */
function readStoredMode(fallback: ThemeMode): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage 不可用时静默回退
  }
  return fallback;
}

/** 写入主题模式到 localStorage */
function writeStoredMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 忽略写入失败
  }
}

export function ThemeProvider({
  initialMode = 'dark',
  mode,
  onModeChange,
  children,
}: ThemeProviderProps): React.ReactElement {
  // 非受控模式:优先从 localStorage 恢复,无记录时用 initialMode
  const [internalMode, setInternalMode] = useState<ThemeMode>(() =>
    mode !== undefined ? mode : readStoredMode(initialMode),
  );
  const isControlled = mode !== undefined;
  const currentMode = isControlled ? mode : internalMode;

  const setMode = useCallback(
    (next: ThemeMode) => {
      if (!isControlled) {
        setInternalMode(next);
        writeStoredMode(next);
      }
      onModeChange?.(next);
    },
    [isControlled, onModeChange],
  );

  const toggle = useCallback(() => {
    setMode(currentMode === 'dark' ? 'light' : 'dark');
  }, [currentMode, setMode]);

  const theme = THEMES[currentMode];

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, mode: currentMode, setMode, toggle }),
    [theme, currentMode, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * 业务消费 hook,必须在 ThemeProvider 内使用(Provider 外抛错)
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/**
 * 内部 hook,Provider 外返回 null(用于 AnimatedThemeToggler 优雅降级,
 * 允许 Toggler 不嵌在 Provider 内时仍可独立工作)
 */
export function useThemeContext(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
