/**
 * layout-styles - 统一页面布局样式
 *
 * 所有列表页（画布、创作、素材、提示词）共享相同的布局框架：
 * - pageStyle: 外层容器
 * - toolbarStyle: 顶部工具栏
 * - contentScrollStyle: 可滚动内容区
 * - gridStyle: 卡片网格
 */

import type { CSSProperties } from 'react';

/** 页面外层容器 */
export const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  overflow: 'hidden',
};

/** 错误提示条 */
export const errorStyle: CSSProperties = {
  padding: '8px 12px',
  margin: '0 20px',
  borderRadius: 8,
  background: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.3)',
  fontSize: 12,
};

/** 可滚动内容区 */
export const contentScrollStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 24,
};

/** 顶部工具栏 */
export function toolbarStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    alignItems: isMobile ? 'stretch' : 'center',
    justifyContent: 'flex-start',
    padding: isMobile ? '10px 12px' : '12px 20px',
    flexShrink: 0,
    gap: isMobile ? 8 : 16,
  };
}

/** 卡片网格 */
export function gridStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? '1fr'
      : 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: isMobile ? 12 : 20,
    alignContent: 'start',
  };
}

/** 空状态容器 */
export const emptyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  gap: 12,
  padding: '60px 20px',
};

/** 空状态图标 */
export const emptyIconStyle: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 16,
  border: '2px dashed rgba(128,128,128,0.25)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all .2s',
};