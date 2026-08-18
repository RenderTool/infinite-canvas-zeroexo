/**
 * @zeroexo/plugin-interaction
 * 交互层插件: 节点拖拽、视口缩放、视口平移、框选、交互模式状态机
 *
 * 依赖: @zeroexo/plugin-render-react (需要 ReactGraphStore)
 * 接收原生 DOM 事件,不依赖 React,可在任意框架使用
 */

import type { Plugin, PluginContext, MergeStrategy } from '@zeroexo/core';
import { ResizeNodeCommand } from '@zeroexo/core';
import type { RenderReactPlugin } from '@zeroexo/plugin-render-react';
import { InteractionController } from './controller.js';

export { InteractionController } from './controller.js';
export type {
  InteractionMode,
  MarqueeController,
  DragEndHook,
  ExpandDragIdsHook,
  ResizeHandleType,
  ResizeConfig,
  ResizeConfigAccessor,
  HelperLine,
  HelperLinesCallback,
} from './controller.js';

export class InteractionPlugin implements Plugin {
  id = 'interaction';
  dependencies = ['render-react'];

  private controller?: InteractionController;
  private container: HTMLElement | null = null;

  install(context: PluginContext): void {
    const renderPlugin = context.getPlugin<RenderReactPlugin>('render-react');
    const store = renderPlugin?.getStore();
    if (!store) {
      throw new Error('InteractionPlugin requires RenderReactPlugin to be installed first');
    }
    this.controller = new InteractionController(
      store,
      context.commandQueue,
      () => this.container,
    );

    // 注册 ResizeNodeCommand 合并策略(连续 mousemove 合并为一条历史)
    const resizeNodeMerge: MergeStrategy = (prev, next) => {
      if (
        prev instanceof ResizeNodeCommand &&
        next instanceof ResizeNodeCommand &&
        prev.nodeId === next.nodeId
      ) {
        // 保留第一条 oldRect + 最后一条 newRect
        return new ResizeNodeCommand(prev.nodeId, prev.oldRect, next.newRect);
      }
      return null;
    };
    context.commandQueue.addMergeStrategy(resizeNodeMerge);
  }

  /** 设置容器元素(使用方需在挂载后调用) */
  setContainer(el: HTMLElement | null): void {
    this.container = el;
  }

  /** 获取交互控制器(install 后可用) */
  getController(): InteractionController {
    if (!this.controller) {
      throw new Error('InteractionPlugin not installed');
    }
    return this.controller;
  }

  /** Space 键状态(用于临时平移) */
  setSpacePressed(pressed: boolean): void {
    this.controller?.setSpacePressed(pressed);
  }

  /** 设置交互模式(select: 选择/拖拽节点, pan: 手型平移) */
  setMode(mode: 'select' | 'pan'): void {
    this.controller?.setMode(mode);
  }

  /** 获取当前交互模式 */
  getMode(): 'select' | 'pan' {
    return this.controller?.getMode() ?? 'select';
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
