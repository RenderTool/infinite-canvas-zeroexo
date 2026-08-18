/**
 * LAYOUT_CONSTANTS.ts - 全局布局常量
 *
 * 统一管理所有布局层级的高度、宽度常量。
 * 所有 TopBar、Toolbar、Sidebar 应引用此处的常量，避免硬编码。
 */
export const LAYOUT = {
  /** 所有 TopBar 统一高度（TopNav / CreationTopBar / TopBar） */
  NAV_HEIGHT: 54,
  /** 阶段内 toolbar 高度（StageToolbar） */
  STAGE_TOOLBAR_HEIGHT: 42,
  /** 侧栏展开宽度 */
  SIDEBAR_EXPANDED: 220,
  /** 侧栏折叠宽度 */
  SIDEBAR_COLLAPSED: 60,
} as const;

/**
 * STAGE_COLORS - 阶段页面辅助色调色板
 *
 * 仅保留绿色完成态，蓝/紫辅助色已移除。
 * 操作按钮统一使用 accent (#e94560) 或中性灰。
 */
export const STAGE_COLORS = {
  /** 完成/确认态（绿色） */
  completed: '#10b981',
} as const;
