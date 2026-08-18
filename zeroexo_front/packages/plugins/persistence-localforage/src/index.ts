/**
 * @zeroexo/plugin-persistence
 * 本地持久化插件(localforage)
 *
 * 功能:
 * 1. 监听 graph 变化, 400ms 防抖后保存到 localforage
 * 2. 启动时从 localforage 恢复(通过 load() 方法)
 * 3. 数据版本迁移(旧版本数据自动升级)
 * 4. 多项目支持(通过 setProjectId 切换)
 *
 * 不依赖 React, 纯逻辑插件。
 *
 * 用法:
 * ```ts
 * const persistence = new PersistencePlugin({ storageKey: 'zeroexo:project' });
 * editor.plugins.install(persistence);
 * // 启动时恢复(调用方负责将 graph 传入 createEditor 的 initialGraph)
 * const saved = await persistence.load();
 * if (saved) console.log('restored', saved);
 * ```
 */

import type { Plugin, PluginContext, GraphModel } from '@zeroexo/core';
import { CommandEvents } from '@zeroexo/core';
import localforage from 'localforage';

// ===== 类型定义 =====

/** 持久化的数据格式(带版本号) */
export interface PersistedState {
  version: number;
  savedAt: number;
  graph: GraphModel;
}

/** 迁移函数: 将旧版本数据升级到新版本 */
export type MigrationFn = (old: PersistedState) => PersistedState;

/** 插件选项 */
export interface PersistenceOptions {
  /** localforage 存储 key(默认 'zeroexo:graph') */
  storageKey?: string;
  /** 防抖延迟(ms, 默认 400) */
  debounceMs?: number;
  /** 数据版本号(默认 1) */
  version?: number;
  /** 存储驱动: 'localStorage' | 'IndexedDB'(默认, 降级到 localStorage) */
  driver?: string;
  /** 项目 id(用于多项目隔离, 不传则用默认 key) */
  projectId?: string;
  /** P1-6: 大 data 字段拆分阈值(字节). node.data 的 JSON 序列化超过此值则单独存储.
   *  默认 2048(2KB), 设为 0 禁用拆分. */
  largeDataThreshold?: number;
}

/** 当前数据版本(随版本升级递增) */
export const CURRENT_VERSION = 1;

// ===== 迁移注册表 =====
/** 版本 → 迁移函数(从该版本升级到下一版本) */
const migrations = new Map<number, MigrationFn>();

// ===== 存储配置常量 =====

/** 旧版存储配置 */
const OLD_CONFIG = {
  name: 'zeroexo',
  storeName: 'canvas',
  graphKeyPrefix: 'zeroexo:graph',
};

/** 新版存储配置 */
const NEW_CONFIG = {
  name: 'zeroexo',
  storeName: 'graph_data',
  graphKeyPrefix: 'graph',
};

/**
 * 注册迁移函数
 * @param fromVersion 源版本
 * @param fn 迁移函数(返回升级后的数据)
 */
export function registerMigration(fromVersion: number, fn: MigrationFn): void {
  migrations.set(fromVersion, fn);
}

// ===== 插件类 =====

export class PersistencePlugin implements Plugin {
  id = 'persistence';
  dependencies?: string[];

  private context?: PluginContext;
  private readonly storageKey: string;
  private readonly debounceMs: number;
  private readonly version: number;
  private readonly largeDataThreshold: number;
  private projectId?: string;
  private store: LocalForage;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** P1-6: requestIdleCallback id, 用于取消待执行的保存 */
  private idleCallbackId: number | null = null;
  private unsubscribers: (() => void)[] = [];
  private active = false;
  /** 标记下次 graph 变化不触发保存(用于 load 后避免无意义保存) */
  private _suppressNextSave = false;
  /** 最近一次保存的错误(用于外部检查) */
  private _lastSaveError: Error | null = null;
  /** 最近一次保存的 Promise(用于 deactivate 等待完成) */
  private _savePromise: Promise<void> | null = null;

  constructor(options: PersistenceOptions = {}) {
    this.storageKey = options.storageKey ?? NEW_CONFIG.graphKeyPrefix;
    this.debounceMs = options.debounceMs ?? 400;
    this.version = options.version ?? CURRENT_VERSION;
    this.largeDataThreshold = options.largeDataThreshold ?? 2048;
    this.projectId = options.projectId;

    // 配置 localforage 实例(独立实例, 避免污染全局)
    this.store = localforage.createInstance({
      name: NEW_CONFIG.name,
      storeName: NEW_CONFIG.storeName,
      driver: this.resolveDriver(options.driver),
    });
  }

  install(context: PluginContext): void {
    this.context = context;
  }

  activate(): void {
    if (this.active || !this.context) return;
    this.active = true;

    // 监听命令执行/撤销/重做 → 防抖保存
    const onChange = (): void => {
      this.scheduleSave();
    };
    this.context.eventBus.on(CommandEvents.EXECUTED, onChange);
    this.context.eventBus.on(CommandEvents.UNDONE, onChange);
    this.context.eventBus.on(CommandEvents.REDONE, onChange);

    this.unsubscribers.push(() => {
      this.context?.eventBus.off(CommandEvents.EXECUTED, onChange);
      this.context?.eventBus.off(CommandEvents.UNDONE, onChange);
      this.context?.eventBus.off(CommandEvents.REDONE, onChange);
    });
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    // 取消未完成的防抖保存和 idle callback, 立即保存一次
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.idleCallbackId !== null) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
    // 保存当前数据并确保写入完成(不使用 fire-and-forget)
    this._savePromise = this._doSave(this.context!.commandQueue.getState());
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
  }

  uninstall(): void {
    this.deactivate();
    this.context = undefined;
  }

  // ===== 公开 API =====

  /** 获取当前存储 key(含 projectId) */
  getStorageKey(): string {
    return this.projectId ? `${this.storageKey}:${this.projectId}` : this.storageKey;
  }

  /** 切换项目(更新 projectId, 下次 save/load 使用新 key) */
  setProjectId(id: string | undefined): void {
    this.projectId = id;
  }

  /** 标记下次 graph 变化不触发保存(用于 load/replaceState 后避免无意义保存) */
  suppressNextSave(): void {
    this._suppressNextSave = true;
  }

  /** 立即保存(跳过防抖) */
  async save(): Promise<void> {
    if (!this.context) return;
    const graph = this.context.commandQueue.getState();
    this._savePromise = this._doSave(graph);
    await this._savePromise;
  }

  /** 实际执行保存(分离出来以便追踪 Promise) */
  private async _doSave(graph: GraphModel): Promise<void> {
    const data: PersistedState = {
      version: this.version,
      savedAt: Date.now(),
      graph,
    };
    // P1-6: 拆分大 data 字段(阈值 > 0 时)
    if (this.largeDataThreshold > 0) {
      const { mainGraph, largeDataMap } = this.splitLargeData(graph);
      try {
        // 批量写入大 data 分片
        const dataPrefix = `${this.getStorageKey()}:data`;
        const writes = Array.from(largeDataMap.entries()).map(([nodeId, nodeData]) =>
          this.store.setItem(`${dataPrefix}:${nodeId}`, nodeData),
        );
        await Promise.all([this.store.setItem(this.getStorageKey(), { ...data, graph: mainGraph }), ...writes]);
      } catch (err) {
        this._lastSaveError = err instanceof Error ? err : new Error(String(err));
        console.error('[Persistence] save failed:', this._lastSaveError);
      }
    } else {
      try {
        await this.store.setItem(this.getStorageKey(), data);
      } catch (err) {
        this._lastSaveError = err instanceof Error ? err : new Error(String(err));
        console.error('[Persistence] save failed:', this._lastSaveError);
      }
    }
  }

  /** 获取最近一次保存的错误(消费后清除) */
  getLastSaveError(): Error | null {
    const err = this._lastSaveError;
    this._lastSaveError = null;
    return err;
  }

  /** 等待最近一次保存完成(用于 deactivate 确保写入完成) */
  async waitForSave(): Promise<void> {
    await this._savePromise;
  }

  /** 加载已保存的数据(自动迁移 + 从旧存储读取 + 合并大 data 分片) */
  async load(): Promise<GraphModel | null> {
    try {
      // 先尝试从新存储读取
      const raw = await this.store.getItem<PersistedState>(this.getStorageKey());
      if (raw) {
        const migrated = this.migrate(raw);
        // 防御: 迁移后的数据可能没有 graph 字段(数据损坏)
        if (!migrated.graph) {
          console.warn('[Persistence] loaded data has no graph, trying alternate storage');
          return this.loadFromAlternateStorage();
        }
        // P1-6: 合并大 data 分片(兼容旧数据无分片)
        // 防御: mergeLargeData 可能因 HMR 未就绪, 兜底返回原 graph
        let graph = migrated.graph;
        try {
          graph = await this.mergeLargeData(migrated.graph);
        } catch {
          // ignore, 使用未合并的 graph
        }
        return graph;
      }

      // 新存储没有数据,尝试从旧存储迁移
      const migratedData = await this.migrateFromOldStorage();
      if (migratedData) {
        const migrated = this.migrate(migratedData);
        if (!migrated.graph) {
          console.warn('[Persistence] migrated data has no graph');
          return null;
        }
        // 迁移后保存到新存储
        await this.store.setItem(this.getStorageKey(), migrated);
        return migrated.graph;
      }

      // 兜底: 尝试读取旧版单项目 key(zeroexo:graph)
      // 注意: 仅"无 projectId 的单项目模式"才允许该兜底。
      // 多项目模式下严禁走此路径——否则新建项目(本地/新存储均无数据)会读到
      // 历史残留的全局 zeroexo:graph 数据, 造成「新项目显示其他项目数据」。
      if (!this.projectId) {
        const fallbackData = await this.loadFromAlternateStorage();
        if (fallbackData) {
          console.info('[Persistence] recovered data from alternate storage');
          return fallbackData;
        }
      }

      return null;
    } catch (err) {
      console.error('[Persistence] load failed:', err);
      return null;
    }
  }

  /**
   * 兜底加载: 尝试从其他可能的存储 key 读取数据
   * 注意: 仅允许读取"无 projectId 的旧版单项目 key"(zeroexo:graph),用于旧数据迁移。
   * 严禁遍历 graph_data store 中其他项目的 key,否则新建项目(无自身数据)会加载到
   * 其他项目的 graph,造成跨项目数据污染。
   */
  private async loadFromAlternateStorage(): Promise<GraphModel | null> {
    try {
      // 仅读取不带 projectId 的旧版 key(zeroexo:graph),这是旧版本单项目遗留数据
      const raw = await this.store.getItem<PersistedState>(this.storageKey);
      if (raw?.graph?.nodes?.length) {
        console.info(`[Persistence] recovered legacy data at key: ${this.storageKey}`);
        // 迁移到当前项目 key,确保后续读写一致
        await this.store.setItem(this.getStorageKey(), raw);
        return raw.graph;
      }
      return null;
    } catch (err) {
      console.warn('[Persistence] alternate storage load failed:', err);
      return null;
    }
  }

  /** 从旧存储迁移数据 */
  private async migrateFromOldStorage(): Promise<PersistedState | null> {
    try {
      // 创建旧存储实例
      const oldStore = localforage.createInstance({
        name: OLD_CONFIG.name,
        storeName: OLD_CONFIG.storeName,
        driver: this.resolveDriver(),
      });

      // 构造旧存储的 key
      const oldKey = this.projectId
        ? `${OLD_CONFIG.graphKeyPrefix}:${this.projectId}`
        : OLD_CONFIG.graphKeyPrefix;

      const raw = await oldStore.getItem<PersistedState>(oldKey);
      if (!raw) return null;

      console.info(`[Persistence] migrated data from old storage: ${oldKey}`);
      return raw;
    } catch (err) {
      console.warn('[Persistence] failed to migrate from old storage:', err);
      return null;
    }
  }

  /** 清除当前项目的存储 */
  async clear(): Promise<void> {
    try {
      await this.store.removeItem(this.getStorageKey());
    } catch (err) {
      console.error('[Persistence] clear failed:', err);
    }
  }

  /** 获取保存时间(用于显示"上次保存于") */
  async getSavedAt(): Promise<number | null> {
    const raw = await this.store.getItem<PersistedState>(this.getStorageKey());
    return raw?.savedAt ?? null;
  }

  // ===== 内部方法 =====

  /** 防抖保存(P1-6: 使用 requestIdleCallback 将序列化推迟到空闲时段) */
  private scheduleSave(): void {
    if (this._suppressNextSave) {
      this._suppressNextSave = false;
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    // 取消上一次 idle callback(避免旧保存覆盖新数据)
    if (this.idleCallbackId !== null) {
      cancelIdleCallback(this.idleCallbackId);
      this.idleCallbackId = null;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (!this.context) return;
      const graph = this.context.commandQueue.getState();
      // 防抖到期后, 在浏览器空闲时执行保存, 避免阻塞交互
      if (typeof requestIdleCallback === 'function') {
        this.idleCallbackId = requestIdleCallback(() => {
          this.idleCallbackId = null;
          this._savePromise = this._doSave(graph);
        }, { timeout: 2000 });
      } else {
        // 不支持 requestIdleCallback 的浏览器 (Safari) 直接保存
        this._savePromise = this._doSave(graph);
      }
    }, this.debounceMs);
  }

  /** 数据迁移: 从旧版本逐步升级到当前版本 */
  private migrate(data: PersistedState): PersistedState {
    let current = data;
    while (current.version < this.version) {
      const migrator = migrations.get(current.version);
      if (!migrator) {
        console.warn(`[Persistence] no migration from v${current.version}, skipping`);
        break;
      }
      current = migrator(current);
    }
    return current;
  }

  /**
   * P1-6: 拆分大 data 分片。
   * 遍历 graph.nodes, 对 node.data 的 JSON 序列化超过阈值的节点,
   * 将其 data 提取到 largeDataMap 中, 并在 graph 中替换为 _dataRef 引用。
   * 无大 data 的节点不变, 保持向后兼容。
   */
  private splitLargeData(graph: GraphModel): {
    mainGraph: GraphModel;
    largeDataMap: Map<string, unknown>;
  } {
    const largeDataMap = new Map<string, unknown>();
    const newNodes = graph.nodes.map((n) => {
      if (!n.data) return n;
      // 尝试 JSON 序列化 data 字段, 若失败(如循环引用)则跳过
      let dataSize = 0;
      try {
        dataSize = JSON.stringify(n.data).length;
      } catch {
        return n;
      }
      if (dataSize <= this.largeDataThreshold) return n;
      // 超过阈值, 提取 data 并占位
      largeDataMap.set(n.id, n.data);
      return { ...n, data: { _dataRef: n.id } as Record<string, unknown> };
    });
    return { mainGraph: { ...graph, nodes: newNodes }, largeDataMap };
  }

  /**
   * P1-6: 合并大 data 分片。
   * 遍历 graph.nodes, 对包含 _dataRef 的节点, 从 localforage 读取对应 data 并恢复。
   * 兼容旧数据(无 _dataRef 引用), 直接返回原 graph。
   */
  private async mergeLargeData(graph: GraphModel): Promise<GraphModel> {
    const dataPrefix = `${this.getStorageKey()}:data`;
    const hasRefs = graph.nodes.some(
      (n) => n.data && typeof n.data === 'object' && '_dataRef' in n.data,
    );
    if (!hasRefs) return graph;

    const newNodes = await Promise.all(
      graph.nodes.map(async (n) => {
        if (!n.data || typeof n.data !== 'object' || !('_dataRef' in n.data)) return n;
        const ref = (n.data as Record<string, unknown>)._dataRef as string;
        const largeData = await this.store.getItem<unknown>(`${dataPrefix}:${ref}`);
        if (largeData === null) {
          // 分片数据丢失(如手动清理), 保留原 data 引用结构
          console.warn(`[Persistence] large data not found for node ${n.id}, using ref`);
          return n;
        }
        return { ...n, data: largeData };
      }),
    );
    return { ...graph, nodes: newNodes };
  }

  /** 解析存储驱动 */
  private resolveDriver(driver?: string): string[] {
    if (driver === 'localStorage') return [localforage.LOCALSTORAGE];
    // 默认: IndexedDB 优先, 降级到 localStorage
    return [localforage.INDEXEDDB, localforage.LOCALSTORAGE];
  }
}

// ===== 存储分桶(Phase VI.1) =====
// 图片存储: 'image:' 前缀,独立 localforage store(image_files)

export type { UploadedImage } from './image-storage.js';
export {
  uploadImage,
  resolveImageUrl,
  resolveThumbnailUrl,
  resolvePreviewUrl,
  getImageBlob,
  setImageBlob,
  imageToDataUrl,
  deleteStoredImages,
  cleanupUnusedImages,
  collectImageStorageKeys,
  storeVideoThumbnail,
  resolveVideoThumbnail,
  deleteVideoThumbnails,
} from './image-storage.js';

// ===== 存储分桶(Phase VI.2) =====
// 媒体存储: 'video:' / 'audio:' 前缀,独立 localforage store(media_files)

export type { UploadedFile } from './file-storage.js';
export {
  uploadMediaFile,
  resolveMediaUrl,
  getMediaBlob,
  setMediaBlob,
  deleteStoredMedia,
  cleanupUnusedMedia,
  collectMediaStorageKeys,
} from './file-storage.js';

// ===== 项目元数据存储(Phase D1.2) =====
// 管理画布项目列表的元数据(id/title/createdAt 等),独立于 graph 数据
// 存储桶: app_state, key: zeroexo:projects

export type { CanvasProjectMeta, CreateProjectInput, UpdateProjectInput } from './project-store.js';
export {
  listProjects,
  getProject,
  createProject,
  copyProject,
  updateProject,
  renameProject,
  deleteProject,
  deleteProjects,
  importProjects,
  clearAllProjects,
  markProjectSynced,
  upsertProject,
} from './project-store.js';

// ===== Graph 数据存储(Phase D1.3) =====
// 按 projectId 加载/保存/删除 graph 数据(无实例版,供导出/导入/编辑器使用)
// 存储桶: canvas, key: zeroexo:graph:{projectId}

export {
  loadProjectGraph,
  saveProjectGraph,
  deleteProjectGraph,
  deleteProjectGraphs,
} from './graph-store.js';



// ===== 数据清理服务(Phase VI.3) =====
// 定期清理未被引用的离散资源,防止后台数据文件夹无限增长

export {
  cleanupProjectResources,
  cleanupProjectResourcesBatch,
  cleanupOrphanedResources,
  cleanupAllResources,
  startPeriodicCleanup,
  stopPeriodicCleanup,
  scheduleDeferredCleanup,
} from './cleanup-service.js';
