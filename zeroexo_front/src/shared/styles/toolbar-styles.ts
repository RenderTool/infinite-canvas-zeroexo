/**
 * toolbar-styles.ts - 统一卡片风格工具栏样式工厂函数
 *
 * 从 editor-creation 模块抽取，确保所有引用相同样式的页面
 * toolbar 高度、背景、边框、按钮间距完全一致。
 *
 * 设计规范：
 * - 高度：42px（padding: 8px 14px）
 * - 背景：暗色 #1a1a1a / 亮色 #f8f7f5
 * - 边框：1px solid, 圆角 10px（卡片风格）
 * - 按钮：inline-flex, gap: 4px, fontSize: 12px
 * - 分隔线：1px 宽, 16px 高
 */

import type { CSSProperties } from 'react';
import { LAYOUT } from '@/shared/components/LAYOUT_CONSTANTS.js';

export const toolbarRowStyle = (
  isDark: boolean,
  border: string,
  bordered = true,
): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 14px',
  background: isDark ? '#1a1a1a' : '#f8f7f5',
  border: bordered ? `1px solid ${border}` : 'none',
  borderRadius: bordered ? 10 : 0,
  gap: 12,
  flexShrink: 0,
  minHeight: LAYOUT.STAGE_TOOLBAR_HEIGHT,
});

export const toolBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  color: '#a0a0b8',
  cursor: 'pointer',
  transition: 'all 0.15s',
  fontFamily: 'inherit',
  position: 'relative',
};

export const sepStyle = (color: string): CSSProperties => ({
  width: 1,
  height: 16,
  background: color,
  flexShrink: 0,
});