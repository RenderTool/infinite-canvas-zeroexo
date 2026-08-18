/**
 * NodeRegistryPlugin - 节点类型注册中心
 *
 * 职责:
 * 1. 注册/注销 NodeTypeExtension 定义
 * 2. 按类型/分类查询
 * 3. 模糊搜索(用于右键菜单节点选择器)
 * 4. 分类树管理
 *
 * 不依赖 React,纯逻辑插件。render-react / context-menu 等插件通过
 * getPlugin('node-registry') 获取实例后查询。
 */

import type { Plugin, PluginContext } from '@zeroexo/core';
import type { NodeTypeExtension } from '@zeroexo/core';

/** 注册中心条目 */
interface RegistryEntry {
  definition: NodeTypeExtension;
  registeredBy: string; // 插件 id 或 'app'
  // 预处理的小写字段(避免每次搜索 3n 次 toLowerCase,提升右键菜单搜索性能)
  lowerName: string;
  lowerType: string;
  lowerCategory: string;
}

/** 分类树节点(对外返回的序列化形式, children 为数组) */
export interface CategoryNode {
  name: string;
  count: number;
  types: NodeTypeExtension[];
  children: CategoryNode[];
}

/** 分类树内部构建节点(Map 结构, 便于按名称查找子节点) */
interface CategoryTreeNode {
  name: string;
  types: NodeTypeExtension[];
  children: Map<string, CategoryTreeNode>;
}

/** 搜索结果 */
export interface SearchResult {
  definition: NodeTypeExtension;
  score: number;
}

export class NodeRegistryPlugin implements Plugin {
  id = 'node-registry';
  dependencies?: string[];

  private readonly entries = new Map<string, RegistryEntry>();
  /** 注册版本号(register/unregister 时递增,用于缓存失效) */
  private version = 0;
  /** search 结果缓存("query#limit" → results),注册变更时清空 */
  private searchCache = new Map<string, SearchResult[]>();
  /** 空 query 全量排序缓存(version 变化时失效) */
  private sortedAllCache: NodeTypeExtension[] | undefined = undefined;
  /** 缓存上限(避免无界增长) */
  private static readonly CACHE_LIMIT = 128;

  install(_context: PluginContext): void {
    // 注册中心是纯逻辑, 不依赖 PluginContext (graph/eventBus/commandQueue)
    // context 参数仅为满足 Plugin 接口契约保留
  }

  activate(): void {
    // 注册中心无需额外激活逻辑
  }

  deactivate(): void {
    // 不清空注册表(允许停用后查询历史定义)
  }

  uninstall(): void {
    this.entries.clear();
    this.invalidateCache();
  }

  /** 使缓存失效(register/unregister 时调用) */
  private invalidateCache(): void {
    this.version++;
    this.searchCache.clear();
    this.sortedAllCache = undefined;
  }

  // ===== 注册/注销 =====

  /** 注册节点类型定义 */
  register(definition: NodeTypeExtension, registeredBy = 'app'): void {
    if (this.entries.has(definition.type)) {
      throw new Error(
        `Node type "${definition.type}" already registered by "${this.entries.get(definition.type)?.registeredBy}"`,
      );
    }
    this.entries.set(definition.type, {
      definition,
      registeredBy,
      lowerName: definition.displayName.toLowerCase(),
      lowerType: definition.type.toLowerCase(),
      lowerCategory: definition.category.toLowerCase(),
    });
    this.invalidateCache();
  }

  /** 注销节点类型 */
  unregister(type: string): void {
    if (this.entries.delete(type)) {
      this.invalidateCache();
    }
  }

  /** 批量注册 */
  registerAll(definitions: NodeTypeExtension[], registeredBy = 'app'): void {
    for (const def of definitions) {
      this.register(def, registeredBy);
    }
  }

  // ===== 查询 =====

  /** 按 type 获取定义 */
  get(type: string): NodeTypeExtension | undefined {
    return this.entries.get(type)?.definition;
  }

  /** 获取所有已注册定义 */
  all(): NodeTypeExtension[] {
    return [...this.entries.values()].map((e) => e.definition);
  }

  /** 获取所有 type 字符串 */
  types(): string[] {
    return [...this.entries.keys()];
  }

  /** 按分类获取 */
  byCategory(category: string): NodeTypeExtension[] {
    return this.all().filter((d) => d.category === category);
  }

  /** 获取所有分类名 */
  categories(): string[] {
    const set = new Set<string>();
    for (const entry of this.entries.values()) {
      set.add(entry.definition.category);
    }
    return [...set].sort();
  }

  /**
   * 构建分类树(支持 "AI/Image" 这样的层级分类)
   * 返回顶层分类数组,每个分类下有子分类和类型
   */
  categoryTree(): CategoryNode[] {
    // 内部构建用 Map,返回时转为数组
    const root: CategoryTreeNode = {
      name: '',
      types: [],
      children: new Map(),
    };

    for (const entry of this.entries.values()) {
      const def = entry.definition;
      const parts = def.category.split('/').map((p) => p.trim());
      let node = root;
      for (const part of parts) {
        let child = node.children.get(part);
        if (!child) {
          child = { name: part, types: [], children: new Map() };
          node.children.set(part, child);
        }
        node = child;
      }
      node.types.push(def);
    }

    return [...root.children.values()].map((n) => this.serializeCategoryNode(n));
  }

  /** 递归序列化(Map → Array,计算 count) */
  private serializeCategoryNode(node: CategoryTreeNode): CategoryNode {
    const children = [...node.children.values()].map((c) => this.serializeCategoryNode(c));
    const childCount = children.reduce((sum, c) => sum + c.count, 0);
    return {
      name: node.name,
      count: node.types.length + childCount,
      types: node.types,
      children,
    };
  }

  // ===== 模糊搜索 =====

  /**
   * 模糊搜索节点类型(用于右键菜单节点选择器)
   *
   * 评分规则(越高越靠前):
   * - displayName 完全匹配: 100
   * - displayName 前缀匹配: 80
   * - displayName 包含匹配: 60
   * - type 完全匹配: 90
   * - type 前缀匹配: 70
   * - type 包含匹配: 50
   * - category 包含匹配: 30
   * - 模糊字符匹配(所有字符按序出现): 20
   *
   * @param query 搜索关键词
   * @param limit 返回数量上限(默认 20)
   */
  search(query: string, limit = 20): SearchResult[] {
    const q = query.trim().toLowerCase();
    const cacheKey = `${q}#${limit}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    let result: SearchResult[];
    if (!q) {
      // 空查询:用排序缓存(注册表不变时排序结果固定,避免每次 O(n log n))
      if (!this.sortedAllCache) {
        this.sortedAllCache = this.all().sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
      }
      result = this.sortedAllCache
        .slice(0, limit)
        .map((definition) => ({ definition, score: 0 }));
    } else {
      const results: SearchResult[] = [];
      for (const entry of this.entries.values()) {
        const score = this.scoreMatch(entry, q);
        if (score > 0) {
          results.push({ definition: entry.definition, score });
        }
      }
      // 按分数降序,同分按 displayName 字母序
      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.definition.displayName.localeCompare(b.definition.displayName);
      });
      result = results.slice(0, limit);
    }

    // 写入缓存(LRU:超限时删最早的)
    if (this.searchCache.size >= NodeRegistryPlugin.CACHE_LIMIT) {
      const firstKey = this.searchCache.keys().next().value;
      if (firstKey !== undefined) this.searchCache.delete(firstKey);
    }
    this.searchCache.set(cacheKey, result);
    return result;
  }

  /** 计算单个定义的匹配分数(用预处理的 lower 字段,避免每次 toLowerCase) */
  private scoreMatch(entry: RegistryEntry, q: string): number {
    const name = entry.lowerName;
    const type = entry.lowerType;
    const category = entry.lowerCategory;

    let score = 0;

    // displayName 匹配
    if (name === q) score = Math.max(score, 100);
    else if (name.startsWith(q)) score = Math.max(score, 80);
    else if (name.includes(q)) score = Math.max(score, 60);

    // type 匹配
    if (type === q) score = Math.max(score, 90);
    else if (type.startsWith(q)) score = Math.max(score, 70);
    else if (type.includes(q)) score = Math.max(score, 50);

    // category 匹配
    if (category.includes(q)) score = Math.max(score, 30);

    // 模糊字符匹配(所有字符按序出现在 displayName 中)
    if (score === 0 && this.fuzzyMatch(name, q)) {
      score = 20;
    }

    return score;
  }

  /** 模糊字符匹配: q 的所有字符按序出现在 target 中 */
  private fuzzyMatch(target: string, q: string): boolean {
    let qi = 0;
    for (let ti = 0; ti < target.length && qi < q.length; ti++) {
      if (target[ti] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  // ===== 工具方法 =====

  /** 获取已注册数量 */
  size(): number {
    return this.entries.size;
  }

  /** 判断类型是否已注册 */
  has(type: string): boolean {
    return this.entries.has(type);
  }

  /** 获取注册者(调试用) */
  registeredBy(type: string): string | undefined {
    return this.entries.get(type)?.registeredBy;
  }
}
