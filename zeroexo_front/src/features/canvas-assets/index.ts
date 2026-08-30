/**
 * canvas-assets - 画布资产抽屉（与主页资产库独立的第二套架构，2026-08-30）
 *
 * 主页资产库 = AssetLibraryPage / use-asset-library（主页专属）。
 * 画布资产抽屉 = 本模块（数据驱动 store + 分组组件），展示组件可复用 shared。
 */

export { CanvasAssetsPanel } from './CanvasAssetsPanel.js';
export type { CanvasAssetsPanelProps } from './CanvasAssetsPanel.js';
export { useCanvasAssetsPanel } from './store.js';
export type { CanvasAssetsPanelStore, DrawerGroup, PromptSource, SendToCanvasItem } from './store.js';
