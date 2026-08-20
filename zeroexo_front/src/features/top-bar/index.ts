/**
 * top-bar feature - 顶部工具栏
 *
 * 容器 TopBar 注入主题,展示组件(TitleEditor/AgentBadge)消费。
 * CanvasMenu(logo 触发器)由 EditorPage 直接渲染,作为 CanvasControls 的 menuSlot。
 * 设置弹窗(ConfigDialog,含画布/节点配色/快捷键 3 Tab)由 EditorPage 直接渲染。
 */

export { TopBar } from './components/top-bar.js';
export type { TopBarProps } from './components/top-bar.js';
export { CanvasMenu } from './components/canvas-menu.js';
export type { CanvasMenuProps } from './components/canvas-menu.js';
export { ConfigDialog, DEFAULT_CANVAS_CONFIG, configToPinDefaults, configToNodeDefaults, configToGroupDefaults, loadCanvasConfig, saveCanvasConfig } from './components/config-dialog.js';
export type { CanvasConfig, ConfigDialogProps } from './components/config-dialog.js';
export { VersionDialogs } from './components/version-dialogs.js';
export type { VersionDialogsProps } from './components/version-dialogs.js';
