/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetBrowser - 样式常量
 *
 * 参考 zeroexo-asset-manager-v2.html 的 CSS 变量设计，
 * 映射到当前项目的 theme.toolbar 体系。
 */

import type { CSSProperties } from 'react';
import type { AssetBrowserProps } from './types.js';

/** 侧边栏宽度 */
export const SIDEBAR_WIDTH = 220;

/** 侧边栏折叠宽度(与主页 Sidebar 一致) */
export const SIDEBAR_COLLAPSED_WIDTH = 60;

/** 内容区最小宽度 */
export const CONTENT_MIN_WIDTH = 320;

/** 上下文面板宽度 */
export const CONTEXT_PANEL_WIDTH = 300;

/** 创建主题适配的样式函数 */
export function createStyles(theme: AssetBrowserProps['theme']) {
  const isDark = theme.mode === 'dark';

  return {
    /** 主容器 */
    container: (): CSSProperties => ({
      display: 'flex',
      flexDirection: 'row',
      height: '100%',
      overflow: 'hidden',
      background: isDark ? '#161412' : '#ffffff',
      color: theme.toolbar.text,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: 13,
      borderRadius: 0,
    }),

    /** 分类侧边栏(折叠时与主页 Sidebar 一致 60px) */
    sidebar: (collapsed: boolean, borderRadius?: number): CSSProperties => ({
      width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
      minWidth: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
      background: isDark ? '#1c1c1c' : '#ffffff',
      borderRight: `1px solid ${theme.toolbar.border}`,
      borderRadius: borderRadius ?? 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.2s ease, min-width 0.2s ease',
    }),

    /** 侧边栏头部(折叠时居中显示折叠按钮,与主页 Sidebar 一致) */
    sidebarHeader: (collapsed: boolean): CSSProperties => ({
      padding: collapsed ? '10px 0' : '12px 14px 8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: collapsed ? 'center' : 'space-between',
      minHeight: 40,
    }),

    /** 侧边栏标题 */
    sidebarTitle: (collapsed: boolean): CSSProperties => ({
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: theme.toolbar.textMuted,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      display: collapsed ? 'none' : 'block',
    }),

    /** 侧边栏折叠按钮 */
    collapseBtn: (): CSSProperties => ({
      width: 24,
      height: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 'none',
      color: theme.toolbar.textMuted,
      borderRadius: 4,
      cursor: 'pointer',
      transition: 'all 0.15s',
    }),

    /** 导航树容器 */
    navTree: (collapsed: boolean): CSSProperties => ({
      flex: 1,
      overflowY: 'auto',
      padding: collapsed ? '4px 4px 16px' : '4px 8px 16px',
    }),

    /** 导航分组 */
    navGroup: (): CSSProperties => ({
      marginBottom: 2,
    }),

    /** 导航分组标签(折叠时与主页 Sidebar 按钮一致: 40px 高,居中) */
    navGroupLabel: (collapsed: boolean): CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: collapsed ? '0' : '6px 10px',
      height: collapsed ? 40 : 'auto',
      fontSize: 12,
      fontWeight: 500,
      color: theme.toolbar.textMuted,
      cursor: 'pointer',
      borderRadius: 10,
      transition: 'background 0.15s',
      userSelect: 'none',
      justifyContent: collapsed ? 'center' : 'flex-start',
      margin: collapsed ? '0 10px 2px' : '0',
    }),

    /** 导航图标(折叠时 20px,与主页 Sidebar 一致) */
    navIcon: (): CSSProperties => ({
      width: 20,
      height: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }),

    /** 导航计数 */
    navCount: (collapsed: boolean): CSSProperties => ({
      marginLeft: 'auto',
      fontSize: 11,
      fontWeight: 500,
      color: theme.toolbar.textMuted,
      background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
      padding: '1px 7px',
      borderRadius: 9999,
      display: collapsed ? 'none' : 'block',
    }),

    /** 子导航容器 */
    navChildren: (expanded: boolean, collapsed: boolean): CSSProperties => ({
      paddingLeft: collapsed ? 0 : 28,
      marginTop: 2,
      display: expanded ? 'block' : 'none',
    }),

    /** 子导航项 */
    navChild: (active: boolean): CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 10px',
      fontSize: 12,
      color: active ? theme.toolbar.accent : (theme.toolbar as any).textSecondary || theme.toolbar.textMuted,
      borderRadius: 6,
      cursor: 'pointer',
      transition: 'all 0.15s',
      position: 'relative',
      background: active ? `${theme.toolbar.accent}12` : 'transparent',
      fontWeight: active ? 500 : 400,
    }),

    /** 子导航指示点 */
    navDot: (active: boolean): CSSProperties => ({
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: active ? theme.toolbar.accent : theme.toolbar.textMuted,
      flexShrink: 0,
    }),

    /** 侧边栏快捷操作区 */
    sidebarFooter: (collapsed: boolean): CSSProperties => ({
      padding: collapsed ? '8px 4px' : '10px 12px',
      borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }),

    /** 内容区 */
    contentArea: (): CSSProperties => ({
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minWidth: 0,
    }),

    /** 内容工具栏 */
    contentToolbar: (): CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      padding: '8px 16px',
      gap: 10,
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}`,
      background: isDark ? '#161412' : '#ffffff',
      flexShrink: 0,
    }),

    /** 视图切换按钮组 */
    viewToggle: (): CSSProperties => ({
      display: 'flex',
      background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
      borderRadius: 8,
      padding: 2,
    }),

    /** 视图切换按钮 */
    viewBtn: (active: boolean): CSSProperties => ({
      width: 28,
      height: 26,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? (isDark ? 'rgba(255,255,255,0.1)' : '#ffffff') : 'transparent',
      border: 'none',
      color: active ? theme.toolbar.text : theme.toolbar.textMuted,
      borderRadius: 5,
      cursor: 'pointer',
      transition: 'all 0.15s',
    }),

    /** 搜索框容器 */
    searchWrap: (): CSSProperties => ({
      position: 'relative',
      width: 160,
    }),

    /** 搜索框 */
    searchInput: (): CSSProperties => ({
      width: '100%',
      height: 28,
      padding: '0 8px 0 26px',
      fontSize: 12,
      background: 'transparent',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`,
      borderRadius: 6,
      color: theme.toolbar.text,
      outline: 'none',
    }),

    /** 筛选 Chip */
    filterChip: (active: boolean): CSSProperties => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 10px',
      background: active ? `${theme.toolbar.accent}12` : 'transparent',
      border: `1px solid ${active ? theme.toolbar.accent : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)')}`,
      borderRadius: 9999,
      fontSize: 11,
      color: active ? theme.toolbar.accent : theme.toolbar.textMuted,
      cursor: 'pointer',
      transition: 'all 0.15s',
      whiteSpace: 'nowrap',
    }),

    /** 资产滚动容器 */
    assetScroll: (): CSSProperties => ({
      flex: 1,
      overflowY: 'auto',
      padding: 16,
    }),

    /** 网格容器（与主页 ProjectCard 网格一致） */
    assetGrid: (): CSSProperties => ({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 20,
      alignContent: 'start',
    }),

    /** 资产卡片 */
    assetCard: (hovered: boolean): CSSProperties => ({
      background: isDark ? '#1c1917' : '#fafaf9',
      border: hovered
        ? `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)'}`
        : '1px solid transparent',
      borderRadius: 12,
      overflow: 'hidden',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      position: 'relative',
    }),

    /** 卡片缩略图 */
    cardThumb: (): CSSProperties => ({
      aspectRatio: '16/10',
      background: isDark ? '#211d1a' : '#f5f5f4',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }),

    /** 卡片缩略图覆盖层 */
    cardThumbOverlay: (): CSSProperties => ({
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 50%)',
      display: 'flex',
      alignItems: 'flex-end',
      padding: 8,
      opacity: 0,
      transition: 'opacity 0.2s',
    }),

    /** 卡片体 */
    cardBody: (): CSSProperties => ({
      padding: '10px 12px 12px',
    }),

    /** 卡片标题行 */
    cardHeaderRow: (): CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    }),

    /** 卡片类型图标 */
    cardIconType: (color: string): CSSProperties => ({
      width: 20,
      height: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 5,
      flexShrink: 0,
      background: `${color}15`,
      color: color,
    }),

    /** 卡片名称 */
    cardName: (): CSSProperties => ({
      fontWeight: 500,
      fontSize: 13,
      color: theme.toolbar.text,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      flex: 1,
    }),

    /** 卡片元信息行 */
    cardMetaRow: (): CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      color: theme.toolbar.textMuted,
      marginBottom: 6,
    }),

    /** 卡片标签 */
    cardTags: (): CSSProperties => ({
      display: 'flex',
      gap: 4,
      flexWrap: 'wrap',
    }),

    cardTag: (): CSSProperties => ({
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 500,
      background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
      color: theme.toolbar.textMuted,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
    }),

    /** 空状态 */
    emptyState: (): CSSProperties => ({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 0',
      color: theme.toolbar.textMuted,
      fontSize: 13,
      gap: 8,
    }),

    /** 列表视图表格 */
    listTable: (): CSSProperties => ({
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12,
    }),

    listTableHead: (): CSSProperties => ({
      textAlign: 'left',
      padding: '8px 12px',
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: theme.toolbar.textMuted,
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
      background: isDark ? '#1c1917' : '#fafaf9',
      position: 'sticky',
      top: 0,
      zIndex: 1,
    }),

    listTableCell: (): CSSProperties => ({
      padding: '8px 12px',
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'}`,
      color: theme.toolbar.textMuted,
      verticalAlign: 'middle',
    }),

    /** 上下文面板 */
    contextPanel: (visible: boolean): CSSProperties => ({
      width: visible ? CONTEXT_PANEL_WIDTH : 0,
      minWidth: visible ? CONTEXT_PANEL_WIDTH : 0,
      overflow: 'hidden',
      background: isDark ? '#1c1917' : '#fafaf9',
      borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.2s ease, min-width 0.2s ease',
    }),

    contextHeader: (): CSSProperties => ({
      padding: '12px 16px',
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}`,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }),

    contextTitle: (): CSSProperties => ({
      fontWeight: 600,
      fontSize: 14,
      flex: 1,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),

    contextBody: (): CSSProperties => ({
      flex: 1,
      overflowY: 'auto',
      padding: '14px 16px',
    }),

    contextSection: (): CSSProperties => ({
      marginBottom: 20,
    }),

    contextSectionTitle: (): CSSProperties => ({
      fontSize: 10,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      color: theme.toolbar.textMuted,
      marginBottom: 8,
    }),

    contextRow: (): CSSProperties => ({
      display: 'flex',
      gap: 8,
      marginBottom: 6,
      fontSize: 12,
    }),

    contextLabel: (): CSSProperties => ({
      color: theme.toolbar.textMuted,
      minWidth: 56,
      flexShrink: 0,
    }),

    contextValue: (): CSSProperties => ({
      color: theme.toolbar.text,
    }),

    /** 状态指示点 */
    statusDot: (status: string): CSSProperties => ({
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: status === 'active' ? '#10b981' : status === 'draft' ? '#f59e0b' : theme.toolbar.textMuted,
      flexShrink: 0,
      display: 'inline-block',
    }),

    /** 加载态 */
    loadingOverlay: (): CSSProperties => ({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 48,
      color: theme.toolbar.textMuted,
    }),
  };
}