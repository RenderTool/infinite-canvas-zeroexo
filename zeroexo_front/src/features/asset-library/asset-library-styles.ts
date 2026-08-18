/**
 * asset-library-styles - 资产库页面样式工厂函数
 *
 * 从 asset-library-page.tsx 抽离，保持相同签名。
 */

import type { CSSProperties } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { Z_INDEX } from '@/shared/constants/z-index.js';

// ===== 页面布局 =====

export function pageStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  };
}

export function layoutBodyStyle(_isMobile: boolean): CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    overflow: 'hidden',
    flexDirection: 'column',
  };
}

export function contentAreaStyle(): CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };
}

// ===== 工具栏 =====

export function toolbarRowStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    flexWrap: isMobile ? 'wrap' : 'nowrap',
    gap: 8,
    padding: isMobile ? '10px 12px' : '12px 20px',
    flexShrink: 0,
  };
}

// ===== 网格 =====

export function gridContainerStyle(isMobile: boolean): CSSProperties {
  return {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: isMobile ? '12px' : '20px',
  };
}

export function gridStyle(isMobile: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: isMobile
      ? '1fr'
      : 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: isMobile ? 10 : 20,
    alignContent: 'start',
  };
}

// ===== 卡片通用 =====

export function cardStyle(theme: ThemeConfig, hovered: boolean): CSSProperties {
  return {
    position: 'relative',
    borderRadius: 12,
    background: hovered ? `${theme.toolbar.accent}06` : theme.toolbar.background,
    border: `1px solid ${hovered ? theme.toolbar.accent : theme.toolbar.border}`,
    cursor: 'pointer',
    transition: 'background 0.2s, border-color 0.2s',
    overflow: 'hidden',
  };
}

export function cardTitleStyle(theme: ThemeConfig): CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 500,
    color: theme.toolbar.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

export function cardMetaStyle(_theme: ThemeConfig): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  };
}

export function subjectIconStyle(_theme: ThemeConfig, color: string): CSSProperties {
  return {
    width: '100%',
    aspectRatio: '239.2 / 135.4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `${color}08`,
    borderBottom: `1px solid ${color}20`,
  };
}

export function cardBodyStyle(): CSSProperties {
  return {
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  };
}

export function cardActionsStyle(theme: ThemeConfig): CSSProperties {
  return {
    position: 'absolute',
    bottom: 8,
    right: 8,
    display: 'flex',
    gap: 4,
    background: theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
    borderRadius: 8,
    padding: '2px 4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    zIndex: Z_INDEX.INLINE,
  };
}

export function actionBtnStyle(): CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    padding: '4px 6px',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  };
}

// ===== 列表视图 =====

export function listContainerStyle(): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '0 20px',
    height: '100%',
    overflow: 'auto',
  };
}

export function listHeaderStyle(theme: ThemeConfig): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: `1px solid ${theme.toolbar.border}`,
    fontSize: 11,
    fontWeight: 600,
    color: theme.toolbar.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  };
}

export function listRowStyle(theme: ThemeConfig): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 12,
    color: theme.toolbar.text,
    cursor: 'default',
    transition: 'background 0.15s',
  };
}