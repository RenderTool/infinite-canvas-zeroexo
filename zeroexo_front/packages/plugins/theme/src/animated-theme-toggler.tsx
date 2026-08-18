/**
 * AnimatedThemeToggler - 带动画过渡的主题切换按钮
 *
 * 使用 View Transitions API + clip-path 实现多形状扩散过渡。
 *
 * 集成模式:
 * 1. 嵌套在 ThemeProvider 内 — 自动从 useThemeContext() 读取 mode/setMode
 * 2. 独立使用 — 传 theme/targetTheme/onThemeChange props
 *
 * 浏览器不支持 View Transitions API 时优雅降级为直接切换
 */

import React, { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { ThemeMode } from '@zeroexo/shared';
import { getThemeTransitionClipPaths } from './clip-paths.js';
import type { TransitionVariant } from './clip-paths.js';
import { useThemeContext } from './theme-context.js';

export type { TransitionVariant };

export interface AnimatedThemeTogglerProps
  extends React.ComponentPropsWithoutRef<'button'> {
  /** 过渡时长(毫秒),默认 400 */
  duration?: number;
  /** 扩散形状,默认 'circle' */
  variant?: TransitionVariant;
  /** 从视口中心扩散而非按钮中心,默认 false */
  fromCenter?: boolean;
  /** 显式传入当前主题(独立使用模式,优先于 Context) */
  theme?: ThemeMode;
  /** 显式指定切换目标(默认在 dark/light 之间翻转) */
  targetTheme?: ThemeMode;
  /** 主题变更回调(独立使用模式,优先于 Context) */
  onThemeChange?: (theme: ThemeMode) => void;
  /** 自定义子内容(默认根据当前主题显示 Sun/Moon) */
  children?: React.ReactNode;
  /** 内置 Sun/Moon 图标尺寸(px),默认 24。用于与其他工具 ICON 尺寸保持一致的场景 */
  iconSize?: number;
}

/** Sun 图标(亮色模式时显示,提示切换到暗色) */
function SunIcon({ size = 24 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

/** Moon 图标(暗色模式时显示,提示切换到亮色) */
function MoonIcon({ size = 24 }: { size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export const AnimatedThemeToggler = React.forwardRef<HTMLButtonElement, AnimatedThemeTogglerProps>(function AnimatedThemeToggler({
  duration = 400,
  variant = 'circle',
  fromCenter = false,
  theme,
  targetTheme,
  onThemeChange,
  children,
  iconSize = 24,
  ...props
}, ref) {
  const ctx = useThemeContext();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // 优先用 props,其次用 Context(独立使用模式 vs 嵌套模式)
  const currentMode: ThemeMode = theme ?? ctx?.mode ?? 'dark';
  const handleThemeChange = onThemeChange ?? ctx?.setMode;

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current;
    if (!button || !handleThemeChange) return;

    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    let x: number;
    let y: number;
    if (fromCenter) {
      x = viewportWidth / 2;
      y = viewportHeight / 2;
    } else {
      const { top, left, width, height } = button.getBoundingClientRect();
      x = left + width / 2;
      y = top + height / 2;
    }

    const maxRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y),
    );

    const nextTheme: ThemeMode = targetTheme ?? (currentMode === 'dark' ? 'light' : 'dark');
    if (nextTheme === currentMode) return;

    const applyTheme = () => {
      // colorScheme 影响表单控件/滚动条原生样式,与 React Context 主题并行设置
      document.documentElement.style.colorScheme = nextTheme;
      handleThemeChange(nextTheme);
    };

    // 浏览器不支持 View Transitions API 时直接切换
    if (typeof document.startViewTransition !== 'function') {
      applyTheme();
      return;
    }

    const clipPath = getThemeTransitionClipPaths({
      variant,
      cx: x,
      cy: y,
      maxRadius,
      viewportWidth,
      viewportHeight,
    });

    const root = document.documentElement;
    root.dataset.magicuiThemeVt = 'active';
    root.style.setProperty('--magicui-theme-toggle-vt-duration', `${duration}ms`);
    // 在 ready.then 之前先钉住 collapsed clip-path,避免 Firefox 在快照到 JS 动画之间漏出未裁剪的新主题
    root.style.setProperty('--magicui-theme-vt-clip-from', clipPath[0]);
    const cleanup = () => {
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty('--magicui-theme-toggle-vt-duration');
      root.style.removeProperty('--magicui-theme-vt-clip-from');
    };

    const transition = document.startViewTransition(() => {
      flushSync(applyTheme);
    });
    if (typeof transition?.finished?.finally === 'function') {
      transition.finished.finally(cleanup);
    } else {
      cleanup();
    }

    const ready = transition?.ready;
    if (ready && typeof ready.then === 'function') {
      ready.then(() => {
        document.documentElement.animate(
          { clipPath },
          {
            duration,
            // star 形状用 linear 避免 polygon 插值在 t→1 时与缓动函数冲突
            easing: variant === 'star' ? 'linear' : 'ease-in-out',
            fill: 'forwards',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      });
    }
  }, [variant, fromCenter, duration, currentMode, targetTheme, handleThemeChange]);

  const isDark = currentMode === 'dark';

  // 合并内部 ref 与 forwardRef 外界传入的 ref,确保 getBoundingClientRect 与外界访问都可用
  const setButtonRef = useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }, [ref]);

  return (
    <button type="button" ref={setButtonRef} onClick={toggleTheme} {...props}>
      {children ?? (isDark ? <SunIcon size={iconSize} /> : <MoonIcon size={iconSize} />)}
      <span className="sr-only">{props['aria-label'] || '切换主题'}</span>
    </button>
  );
});
