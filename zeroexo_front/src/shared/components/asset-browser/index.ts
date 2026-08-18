/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetBrowser - 通用资产浏览器组件
 *
 * 封装资产分类侧边栏 + 网格/列表视图 + 上下文详情面板。
 * 支持三种显示模式，方便主页资产模块和画布资产导入复用。
 *
 * 导出：
 * - AssetBrowser - 主组件
 * - AssetCategorySidebar - 分类侧边栏（独立使用）
 * - AssetGrid - 网格视图（独立使用）
 * - AssetList - 列表视图（独立使用）
 * - AssetContent - 内容区（独立使用）
 * - AssetContextPanel - 上下文面板（独立使用）
 * - 所有类型定义
 */

export { AssetBrowser } from './asset-browser.js';
export { AssetCategorySidebar } from './asset-category-sidebar.js';
export { AssetGrid } from './asset-grid.js';
export { AssetList } from './asset-list.js';
export { AssetContent } from './asset-content.js';
export { AssetContextPanel } from './asset-context-panel.js';
export type * from './types.js';