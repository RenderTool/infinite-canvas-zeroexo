/**
 * @zeroexo/plugin-render-react
 * React 渲染层插件
 *
 * 提供:
 * - ReactGraphStore: 基于 useSyncExternalStore 的状态订阅
 * - CanvasView: 画布主视图(Viewport + NodeLayer + EdgeLayer)
 * - NodeShell: 通用节点外壳
 * - PinView: 引脚视图
 * - Hooks: useGraph / useViewport / useSelection / useNode
 * - createRenderStore: 独立创建 store(无需插件)
 * - RenderReactPlugin: 插件形式(自动创建 store)
 */

import type { Plugin, PluginContext } from '@zeroexo/core';
import { ReactGraphStore } from './store.js';

// ===== Store & Hooks =====
export { ReactGraphStore } from './store.js';
export type { SelectionState } from './store.js';
export { useGraph, useViewport, useSelection, useNode, useNodeById } from './store.js';
export { ReactGraphStoreContext, useReactGraphStore } from './store.js';

// ===== 组件 =====
export { CanvasView } from './components/canvas-view.js';

export { ContextMenu } from './components/context-menu.js';
export type { ContextMenuProps, ContextMenuItem } from './components/context-menu.js';
export type { CanvasViewProps } from './components/canvas-view.js';
export { Viewport_ as Viewport } from './components/viewport.js';
export type { ViewportProps } from './components/viewport.js';
export { NodeLayer } from './components/node-layer.js';
export type { NodeLayerProps } from './components/node-layer.js';
export { EdgeLayer } from './components/edge-layer.js';
export type { EdgeLayerProps } from './components/edge-layer.js';
export { quantizeZoom } from './components/edge-layer.js';
export { NodeShell } from './components/node-shell.js';
export type { NodeShellProps } from './components/node-shell.js';
export { PinView } from './components/pin-view.js';
export type { PinViewProps } from './components/pin-view.js';
export { NodeHoverToolbar } from './components/node-hover-toolbar.js';
export type { NodeHoverToolbarProps } from './components/node-hover-toolbar.js';
export { NodeDetailPanel } from './components/node-detail-panel.js';
export type { NodeDetailPanelProps } from './components/node-detail-panel.js';
export { HelperLinesOverlay } from './components/helper-lines-overlay.js';
export type { HelperLinesOverlayProps } from './components/helper-lines-overlay.js';
export { PinDefaultsProvider, usePinDefaults } from './pin-defaults.js';
export type { PinDefaults } from './pin-defaults.js';
export { NodeDefaultsProvider, useNodeDefaults } from './pin-defaults.js';
export type { NodeDefaults } from './pin-defaults.js';

// ===== 工具函数 =====

/** 独立创建 ReactGraphStore(无需通过插件) */
export function createRenderStore(context: PluginContext): ReactGraphStore {
  return new ReactGraphStore(context.commandQueue, context.eventBus);
}

// ===== 插件形式 =====

export class RenderReactPlugin implements Plugin {
  id = 'render-react';
  private store?: ReactGraphStore;

  install(context: PluginContext): void {
    this.store = new ReactGraphStore(context.commandQueue, context.eventBus);
  }

  /** 获取 store(install 后可用) */
  getStore(): ReactGraphStore {
    if (!this.store) {
      throw new Error('RenderReactPlugin not installed: call editor.install(plugin) first');
    }
    return this.store;
  }

  deactivate(): void {
    // store 无需显式清理(EventBus 由 editor.dispose 统一 clear)
    this.store = undefined;
  }

  uninstall(): void {
    this.store = undefined;
  }
}
