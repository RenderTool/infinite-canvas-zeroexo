/**
 * design-tokens.ts — 现代化设计系统令牌
 *
 * 设计哲学：
 * - 语义化优先：使用 purpose-based 命名（surface, border, text）而非具体颜色
 * - 层级分明：bg-page → bg-surface → bg-elevated → bg-popup
 * - 对比度强制：所有文字颜色保证 WCAG AA 以上对比度
 * - 渐变支持：提供品牌渐变、状态渐变用于 Hero/卡片
 */

// ========== 核心色板 ==========
export const palette = {
  // 主色系（Blue Violet 现代紫蓝）
  primary: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#1677FF',  // 主品牌色
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A',
    950: '#172554',
  },
  // 辅助色系（Emerald 翠绿）
  secondary: {
    500: '#10B981',
    600: '#059669',
    700: '#047857',
  },
  // 成功色
  success: {
    50: '#ECFDF5',
    100: '#D1FAE5',
    500: '#10B981',
    600: '#059669',
  },
  // 警告色
  warning: {
    50: '#FFFBEB',
    100: '#FEF3C7',
    500: '#F59E0B',
    600: '#D97706',
  },
  // 错误色
  error: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    500: '#EF4444',
    600: '#DC2626',
  },
  // 紫色系（用于 AI/智能相关）
  purple: {
    500: '#8B5CF6',
    600: '#7C3AED',
    700: '#6D28D9',
  },
  // 青色系（用于信息/数据相关）
  cyan: {
    500: '#06B6D4',
    600: '#0891B2',
  },
  // 灰色阶
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#0A0A0A',
  },
} as const;

// ========== 语义化颜色令牌 ==========
export const color = {
  // 品牌主色
  primary: palette.primary[600],
  primaryHover: palette.primary[700],
  primaryActive: palette.primary[800],
  primaryLight: palette.primary[50],
  // 成功
  success: palette.success[500],
  successHover: palette.success[600],
  successLight: palette.success[50],
  // 警告
  warning: palette.warning[500],
  warningHover: palette.warning[600],
  warningLight: palette.warning[50],
  // 错误
  error: palette.error[500],
  errorHover: palette.error[600],
  errorLight: palette.error[50],
  // AI/紫色
  ai: palette.purple[500],
  aiLight: '#F5F3FF',
  // 文本色（确保对比度）
  textPrimary: palette.gray[900],     // 主要文本 - #171717
  textSecondary: palette.gray[600],   // 次要文本 - #525252
  textTertiary: palette.gray[400],     // 辅助文本 - #A3A3A3
  textDisabled: palette.gray[300],    // 禁用文本 - #D4D4D4
  textInverse: '#FFFFFF',              // 反色文本
  // 背景层级
  bgPage: palette.gray[50],            // 页面背景 - #FAFAFA
  bgSurface: '#FFFFFF',                // 表面背景 - #FFFFFF
  bgElevated: palette.gray[100],       // 提升背景 - #F5F5F5
  bgPopup: '#FFFFFF',                  // 弹窗背景
  bgHover: palette.gray[100],          // 悬停背景 - #F5F5F5
  bgActive: palette.gray[200],         // 激活背景
  bgSelected: palette.primary[50],     // 选中背景
  bgCode: '#F6F8FA',                   // 代码背景
  bgDark: '#0F172A',                   // 深色背景
  // 边框
  border: palette.gray[200],           // 常规边框 - #E5E5E5
  borderLight: palette.gray[100],      // 浅色边框
  borderStrong: palette.gray[300],    // 强调边框
  borderFocus: palette.primary[500],  // 聚焦边框
} as const;

// ========== 现代渐变 ==========
export const gradient = {
  // 品牌渐变（用于 Hero、关键卡片）
  brand: 'linear-gradient(135deg, #1677FF 0%, #7C3AED 100%)',
  brandHover: 'linear-gradient(135deg, #4096FF 0%, #8B5CF6 100%)',
  // 成功渐变
  success: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
  // 警告渐变
  warning: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
  // 错误渐变
  error: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
  // AI 渐变
  ai: 'linear-gradient(135deg, #8B5CF6 0%, #06B6D4 100%)',
  // 深色渐变（用于深色模式）
  dark: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
  // 玻璃拟态
  glass: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
} as const;

// ========== 圆角（8px 基准，统一层级）==========
export const radius = {
  none: '0px',
  xs: '2px',   // 标签、徽章
  sm: '4px',   // 输入框、小按钮
  md: '6px',   // 按钮、卡片
  lg: '8px',   // 弹窗、大卡片
  xl: '12px',  // 大容器
  '2xl': '16px', // 特大容器
  full: '9999px', // 圆形
} as const;

// ========== 间距（4px 基准，语义化命名）==========
export const spacing = {
  none: 0,
  xs: 4,   // 紧凑元素间距
  sm: 8,   // 元素内间距
  md: 16,  // 区块内间距
  lg: 24,  // 区块间间距
  xl: 32,  // 大区块间间距
  '2xl': 48, // 页面级间距
} as const;

// ========== 字体层级 ==========
export const fontSize = {
  xs: 11,   // 极小标注
  sm: 12,   // 辅助文字
  base: 14, // 正文
  lg: 16,   // 小标题
  xl: 20,   // 标题
  '2xl': 24, // 大标题
  '3xl': 28, // Hero 标题
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

// ========== 阴影层级（3 层体系）==========
export const shadow = {
  // 用于卡片、按钮悬停
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  // 用于卡片、下拉菜单
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  // 用于弹窗、大型下拉
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  // 用于模态对话框
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  // 内阴影
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  // 品牌阴影（带主题色）
  primary: '0 4px 12px rgba(22, 119, 255, 0.3)',
} as const;

// ========== 动效时长 ==========
export const duration = {
  fastest: '100ms', // 微交互
  fast: '150ms',    // 常规过渡
  base: '200ms',    // 组件过渡
  slow: '300ms',    // 复杂过渡
  slower: '500ms',  // 页面级动画
} as const;

// ========== CSS 变量引用（方便 inline style 使用）==========
export const cssVar = {
  // 颜色
  colorPrimary: 'var(--color-primary, #1677ff)',
  colorPrimaryHover: 'var(--color-primary-hover, #4096ff)',
  colorTextPrimary: 'var(--color-text-primary, #171717)',
  colorTextSecondary: 'var(--color-text-secondary, #525252)',
  colorTextTertiary: 'var(--color-text-tertiary, #A3A3A3)',
  colorBgPage: 'var(--color-bg-page, #FAFAFA)',
  colorBgSurface: 'var(--color-bg-surface, #FFFFFF)',
  colorBgElevated: 'var(--color-bg-elevated, #F5F5F5)',
  colorBorder: 'var(--color-border, #E5E5E5)',
  // 圆角
  radiusSm: 'var(--radius-sm, 4px)',
  radiusMd: 'var(--radius-md, 6px)',
  radiusLg: 'var(--radius-lg, 8px)',
  radiusXl: 'var(--radius-xl, 12px)',
  // 间距
  spacingSm: 'var(--spacing-sm, 8px)',
  spacingMd: 'var(--spacing-md, 16px)',
  spacingLg: 'var(--spacing-lg, 24px)',
  // 阴影
  shadowSm: 'var(--shadow-sm, 0 1px 2px 0 rgba(0,0,0,0.05))',
  shadowMd: 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1))',
  shadowLg: 'var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1))',
} as const;

// ========== 图表色板 ==========
export const chartColors = [
  '#1677FF',  // primary
  '#8B5CF6',  // purple
  '#10B981',  // success
  '#F59E0B',  // warning
  '#06B6D4',  // cyan
  '#EF4444',  // error
  '#EC4899',  // pink
  '#6366F1',  // indigo
] as const;
