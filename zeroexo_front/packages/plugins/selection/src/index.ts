/**
 * @zeroexo/plugin-selection
 * 选择层插件: 框选(Marquee)状态机 + 命中检测 + 视觉渲染
 *
 * 依赖: @zeroexo/plugin-render-react (需要 ReactGraphStore)
 * 提供:
 * - SelectionController: 框选状态机 + AABB 命中检测
 * - SelectionBoxLayer: 框选矩形渲染层(React)
 * - SelectionPlugin: 插件形式
 */

import type { Plugin, PluginContext } from '@zeroexo/core';
import type { RenderReactPlugin } from '@zeroexo/plugin-render-react';
import { SelectionController } from './controller.js';
export type { MarqueeRect } from './controller.js';
export { SelectionController } from './controller.js';
export { SelectionBoxLayer, useMarquee } from './selection-box-layer.js';
export type { SelectionBoxLayerProps } from './selection-box-layer.js';

export class SelectionPlugin implements Plugin {
  id = 'selection';
  dependencies = ['render-react'];

  private controller?: SelectionController;

  install(context: PluginContext): void {
    const renderPlugin = context.getPlugin<RenderReactPlugin>('render-react');
    const store = renderPlugin?.getStore();
    if (!store) {
      throw new Error('SelectionPlugin requires RenderReactPlugin to be installed first');
    }
    this.controller = new SelectionController(store);
  }

  /** 获取选择控制器(install 后可用) */
  getController(): SelectionController {
    if (!this.controller) {
      throw new Error('SelectionPlugin not installed');
    }
    return this.controller;
  }

  deactivate(): void {
    this.controller = undefined;
  }

  uninstall(): void {
    this.controller = undefined;
  }
}
