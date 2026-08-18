/**
 * @zeroexo/plugin-theme
 *
 * 主题系统插件:
 * - ThemeProvider(React Context 注入)
 * - useTheme() / useThemeContext() hook
 * - AnimatedThemeToggler(View Transitions API 动画切换按钮)
 *
 * 主题 token 数据来自 @zeroexo/shared(DARK_THEME / LIGHT_THEME / THEMES)
 */

export { ThemeProvider, useTheme, useThemeContext } from './theme-context.js';
export type { ThemeProviderProps, ThemeContextValue } from './theme-context.js';

export { AnimatedThemeToggler } from './animated-theme-toggler.js';
export type { AnimatedThemeTogglerProps } from './animated-theme-toggler.js';
export type { TransitionVariant } from './clip-paths.js';

export { getThemeTransitionClipPaths } from './clip-paths.js';
export type { ClipPathInput } from './clip-paths.js';

// 主题数据从 @zeroexo/shared 透传,方便业务方一处导入
export type {
  ThemeMode,
  ThemeConfig,
  CanvasTokens,
  NodeTokens,
  ToolbarTokens,
  GroupTokens,
  EdgeTokens,
} from '@zeroexo/shared';
export { DARK_THEME, LIGHT_THEME, THEMES } from '@zeroexo/shared';
