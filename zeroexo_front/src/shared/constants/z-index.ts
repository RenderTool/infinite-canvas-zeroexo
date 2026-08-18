/**
 * 统一 z-index 层级常量
 *
 * 所有组件必须使用此常量而非硬编码 z-index 值，确保全局层级一致。
 * 层级从低到高排列，避免因随意叠加导致覆盖混乱。
 *
 * 使用方式：
 * ```ts
 * import { Z_INDEX } from '@/shared/constants/z-index.js';
 * style={{ zIndex: Z_INDEX.DROPDOWN }}
 * ```
 */
export const Z_INDEX = {
  /** 基础层 - 最低层元素 */
  BASE: 1,

  /** 内联覆盖层 - 卡片内的选中标记、标签等 */
  INLINE: 2,

  /** 浮动层 - 搜索结果、输入建议、多选选中标记等 */
  FLOATING: 10,

  /** 富文本编辑器工具栏 */
  EDITOR_TOOLBAR: 20,

  /** 用户菜单下拉 */
  USER_MENU: 30,

  /** 浮动操作按钮 */
  FAB: 40,

  /** 侧边栏、工具栏等导航元素 */
  SIDEBAR: 50,

  /** 应用布局层（导航栏、布局容器、移动端导航按钮） */
  LAYOUT: 100,

  /** 左侧工具栏拓展面板、Agent 面板 */
  LEFT_SIDEBAR_EXTEND: 200,

  /** 工具提示 */
  TOOLTIP: 300,

  /** 节点创建菜单遮罩 */
  NODE_CREATE_MASK: 998,

  /** 节点创建菜单 */
  NODE_CREATE_MENU: 999,

  /** 下拉菜单、选择器面板、资源选择器、连接菜单 */
  DROPDOWN: 1000,

  /** Agent 面板 */
  AGENT_PANEL: 1050,

  /** 设置弹窗 */
  SETTINGS_POPOVER: 1200,

  /** 配置对话框、快捷键弹窗 */
  MODAL: 3000,

  /** 全屏覆盖层 - 全屏编辑器、全屏阅读器等 */
  FULLSCREEN: 30000,

  /** 全屏内部下拉菜单遮罩 */
  FULLSCREEN_DROPDOWN_MASK: 31000,

  /** 全屏内部下拉菜单/弹窗内容 */
  FULLSCREEN_DROPDOWN: 32000,

  /** 全屏内部弹窗（Modal） */
  FULLSCREEN_MODAL: 33000,

  /** 全屏编辑器中 ScriptStructuredEditor 的菜单 */
  FULLSCREEN_EDITOR_MENU: 34000,

  /** 上传队列覆盖层 - 最高层 */
  UPLOAD_QUEUE: 100000,
} as const;