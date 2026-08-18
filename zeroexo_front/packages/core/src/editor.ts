/**
 * createEditor - 编辑器工厂
 * Phase 2 将完整实现
 */

import type { GraphModel } from './model/types.js';
import { EventBus } from './bus/event-bus.js';
import { CommandQueue } from './command/command-queue.js';
import { PluginHost } from './plugin/plugin-host.js';
import type { Plugin, PluginContext } from './plugin/plugin-host.js';

export interface EditorOptions {
  initialGraph?: GraphModel;
  historyCapacity?: number;
}

export interface Editor {
  /** 获取当前 graph 状态(委托给 CommandQueue.getState,保证与命令历史一致) */
  getGraph(): GraphModel;
  eventBus: EventBus;
  commandQueue: CommandQueue;
  plugins: PluginHost;

  install(plugin: Plugin, options?: Record<string, unknown>): void;
  dispose(): void;
}

export function createEditor(options: EditorOptions = {}): Editor {
  const initialGraph: GraphModel = options.initialGraph ?? {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, k: 1 },
    metadata: {},
  };

  const eventBus = new EventBus();
  const commandQueue = new CommandQueue(initialGraph, eventBus, options.historyCapacity ?? 50);

  // 闭包占位:解决 PluginContext.getPlugin 与 PluginHost 实例的循环引用
  let pluginsRef: PluginHost | undefined;

  const context: PluginContext = {
    getGraph: () => commandQueue.getState(),
    eventBus,
    commandQueue,
    getPlugin: <T extends Plugin>(id: string) => pluginsRef?.get<T>(id),
  };

  const plugins = new PluginHost(context);
  pluginsRef = plugins;

  return {
    getGraph: () => commandQueue.getState(),
    eventBus,
    commandQueue,
    plugins,
    install: (plugin, opts) => plugins.install(plugin, opts),
    dispose: () => {
      // 先按生命周期 deactivate 所有已激活插件,再清理事件总线
      for (const plugin of plugins.list()) {
        try {
          plugin.deactivate?.();
        } catch {
          // Phase 2: 接入 logger 后记录错误,当前阶段静默以保证 dispose 不中断
        }
      }
      eventBus.clear();
    },
  };
}
