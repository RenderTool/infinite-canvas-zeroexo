/**
 * PluginHost - 插件管理器
 * 支持: 依赖解析(拓扑排序)、循环依赖检测、生命周期、install 错误回滚、uninstall 依赖保护
 */

import type { GraphModel } from '../model/types.js';
import type { EventBus } from '../bus/event-bus.js';
import type { CommandQueue } from '../command/command-queue.js';

export interface PluginContext {
  /** 获取当前 graph 状态(委托给 CommandQueue.getState,保证与命令历史一致) */
  getGraph(): GraphModel;
  eventBus: EventBus;
  commandQueue: CommandQueue;
  getPlugin<T extends Plugin>(id: string): T | undefined;
}

export interface PluginOptions {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface Plugin {
  id: string;
  dependencies?: string[];
  provides?: string[];

  install?(context: PluginContext, options?: PluginOptions): void;
  activate?(context: PluginContext): void;
  deactivate?(): void;
  uninstall?(context: PluginContext): void;
}

interface PluginEntry {
  plugin: Plugin;
  options?: PluginOptions;
  active: boolean;
}

export class PluginHost {
  private plugins = new Map<string, PluginEntry>();
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  /**
   * 安装单个插件
   * - 检查重复 id
   * - 检查 dependencies 是否已安装
   * - install/activate 抛错时回滚注册
   */
  install(plugin: Plugin, options?: PluginOptions): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" already installed`);
    }
    this.assertDependenciesSatisfied(plugin);

    this.plugins.set(plugin.id, { plugin, options, active: false });
    try {
      plugin.install?.(this.context, options);
      plugin.activate?.(this.context);
      const entry = this.plugins.get(plugin.id);
      if (entry) entry.active = true;
    } catch (err) {
      // 回滚: 尽力调用清理,再移除注册,最后重新抛出原始错误
      this.plugins.delete(plugin.id);
      try {
        plugin.deactivate?.();
      } catch {
        /* 静默:回滚期间的二次错误不应掩盖原始错误 */
      }
      try {
        plugin.uninstall?.(this.context);
      } catch {
        /* 同上 */
      }
      throw err;
    }
  }

  /**
   * 批量安装(拓扑排序后逐个安装)
   * - 自动检测循环依赖
   * - 依赖不在本次列表但在已安装列表中也可通过
   */
  installAll(plugins: Plugin[], optionsMap?: Record<string, PluginOptions>): void {
    const sorted = this.topoSort(plugins);
    for (const p of sorted) {
      this.install(p, optionsMap?.[p.id]);
    }
  }

  /**
   * 卸载插件
   * - 若有其他插件依赖它则抛错(需先卸载依赖方)
   * - 按生命周期: deactivate → uninstall → 移除注册
   */
  uninstall(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;

    const dependents = this.findDependents(pluginId);
    if (dependents.length > 0) {
      throw new Error(
        `Cannot uninstall "${pluginId}": depended on by [${dependents.join(', ')}]`,
      );
    }

    entry.plugin.deactivate?.();
    entry.plugin.uninstall?.(this.context);
    this.plugins.delete(pluginId);
  }

  /** 获取插件实例(类型收窄由调用方负责) */
  get<T extends Plugin>(pluginId: string): T | undefined {
    const entry = this.plugins.get(pluginId);
    return entry?.plugin as T | undefined;
  }

  /** 列出所有已安装插件 */
  list(): Plugin[] {
    return [...this.plugins.values()].map((e) => e.plugin);
  }

  /** 是否已安装 */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /** 插件是否处于激活态 */
  isActive(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.active ?? false;
  }

  /** 激活已安装但未激活的插件 */
  activate(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" not installed`);
    if (entry.active) return;
    this.assertDependenciesSatisfied(entry.plugin);
    entry.plugin.activate?.(this.context);
    entry.active = true;
  }

  /** 停用插件(不卸载) */
  deactivate(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;
    if (!entry.active) return;
    const dependents = this.findDependents(pluginId);
    if (dependents.length > 0) {
      throw new Error(
        `Cannot deactivate "${pluginId}": depended on by [${dependents.join(', ')}]`,
      );
    }
    entry.plugin.deactivate?.();
    entry.active = false;
  }

  // ===== 内部方法 =====

  /** 检查 plugin.dependencies 是否全部已安装 */
  private assertDependenciesSatisfied(plugin: Plugin): void {
    if (!plugin.dependencies || plugin.dependencies.length === 0) return;
    for (const dep of plugin.dependencies) {
      if (!this.plugins.has(dep)) {
        throw new Error(`Plugin "${plugin.id}" requires missing dependency "${dep}"`);
      }
    }
  }

  /** 查找所有依赖 pluginId 的已安装插件 */
  private findDependents(pluginId: string): string[] {
    const result: string[] = [];
    for (const [id, entry] of this.plugins) {
      if (id !== pluginId && entry.plugin.dependencies?.includes(pluginId)) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 拓扑排序: 保证依赖在前,被依赖在后
   * - 支持依赖指向已安装插件(不在本次列表)的情况
   * - 检测本次列表内部的循环依赖
   */
  private topoSort(plugins: Plugin[]): Plugin[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: Plugin[] = [];
    const map = new Map(plugins.map((p) => [p.id, p]));

    const visit = (p: Plugin): void => {
      if (visited.has(p.id)) return;
      if (visiting.has(p.id)) {
        throw new Error(`Circular dependency detected involving plugin "${p.id}"`);
      }
      visiting.add(p.id);
      if (p.dependencies) {
        for (const depId of p.dependencies) {
          const dep = map.get(depId);
          if (dep) visit(dep);
          // 依赖不在本次列表: 若已安装则 OK,否则留待 install 时报错
        }
      }
      visiting.delete(p.id);
      visited.add(p.id);
      result.push(p);
    };

    for (const p of plugins) visit(p);
    return result;
  }
}
