/**
 * @zeroexo/plugin-connection
 * 连线层插件: 端口拖拽创建连线、方向校验、临时连线渲染
 *
 * 依赖: @zeroexo/plugin-render-react (需要 ReactGraphStore)
 *
 * 使用方式:
 * 1. install 后通过 getController() 获取 ConnectionController
 * 2. 在画布挂载后调用 setContainer(containerEl) 注入容器(用于坐标转换修正)
 * 3. 将控制器的 handlePinPointerDown/Enter/Leave 注入到引脚渲染组件
 * 4. 在画布容器上绑定 handlePointerMove/Up (全局事件)
 * 5. 渲染 <PendingConnectionLayer controller={...} viewport={...} />
 */

import type { Plugin, PluginContext } from '@zeroexo/core';
import type { RenderReactPlugin } from '@zeroexo/plugin-render-react';
import { ConnectionController } from './controller.js';

export { ConnectionController } from './controller.js';
export type { PendingConnection, ConnectionValidation, ConnectionEndpoint, ExtensionAccessor, GroupPinExpander, ConnectionDropCallback } from './controller.js';
export { PendingConnectionLayer, usePendingConnection } from './pending-connection-layer.js';

export class ConnectionPlugin implements Plugin {
  id = 'connection';
  dependencies = ['render-react'];

  private controller?: ConnectionController;
  private container: HTMLElement | null = null;

  install(context: PluginContext): void {
    const renderPlugin = context.getPlugin<RenderReactPlugin>('render-react');
    const store = renderPlugin?.getStore();
    if (!store) {
      throw new Error('ConnectionPlugin requires RenderReactPlugin to be installed first');
    }
    this.controller = new ConnectionController(
      store,
      context.commandQueue,
      () => this.container,
    );
  }

  /**
   * 设置容器元素(使用方需在挂载后调用)
   * 用于 screenToWorld 坐标转换,修正工具栏等布局偏移导致的临时连线位置错误
   */
  setContainer(el: HTMLElement | null): void {
    this.container = el;
  }

  /** 获取连线控制器(install 后可用) */
  getController(): ConnectionController {
    if (!this.controller) {
      throw new Error('ConnectionPlugin not installed');
    }
    return this.controller;
  }

  deactivate(): void {
    this.container = null;
    this.controller = undefined;
  }

  uninstall(): void {
    this.container = null;
    this.controller = undefined;
  }
}
