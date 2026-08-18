/**
 * Graph 数据存储(Phase D1.3)
 *
 * 提供按 projectId 加载/保存/删除 graph 数据的独立函数,
 * 不需要创建 PersistencePlugin 实例(供导出/导入/编辑器初始化使用)。
 *
 * 存储分层:
 * - localforage name: 'zeroexo'
 * - storeName: 'graph_data'
 * - key: `zeroexo:graph:{projectId}`
 *
 * 与 PersistencePlugin 的关系:
 * - PersistencePlugin 内部用同一 storeName + key 格式
 * - 本模块是 PersistencePlugin 的无实例替代,用于不需要监听 graph 变化的场景
 * - 注意:key 前缀必须与编辑器 PersistencePlugin 的 storageKey('zeroexo:graph',见
 *   use-editor-state createDefaultEditor 的 storageKey 参数)保持一致,否则
 *   syncProjectToCloud 通过 loadProjectGraph 会读到空 graph,导致云同步推送 0 个节点。
 */

import localforage from 'localforage';
import type { GraphModel } from '@zeroexo/core';
import { CURRENT_VERSION } from './index.js';

/** 持久化数据格式(与 index.ts 的 PersistedState 保持一致) */
interface PersistedGraphState {
  version: number;
  savedAt: number;
  graph: GraphModel;
}

// ===== 存储配置 =====

const OLD_CONFIG = {
  name: 'zeroexo',
  storeName: 'canvas',
  graphKeyPrefix: 'zeroexo:graph',
};

const NEW_CONFIG = {
  name: 'zeroexo',
  storeName: 'graph_data',
  // 必须与编辑器 PersistencePlugin 的 storageKey('zeroexo:graph')一致,
  // 否则 loadProjectGraph 读不到编辑器写入的 graph,云同步会推送空节点。
  graphKeyPrefix: 'zeroexo:graph',
};

// ===== localforage 实例(与 PersistencePlugin 同配置) =====

const store = localforage.createInstance({
  name: NEW_CONFIG.name,
  storeName: NEW_CONFIG.storeName,
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

/** graph 存储 key 前缀 */
const GRAPH_KEY_PREFIX = NEW_CONFIG.graphKeyPrefix;

/** 拼接项目的 graph 存储 key */
function graphKey(projectId: string): string {
  return `${GRAPH_KEY_PREFIX}:${projectId}`;
}

/** 从旧存储读取数据 */
async function loadFromOldStorage(projectId: string): Promise<PersistedGraphState | null> {
  try {
    const oldStore = localforage.createInstance({
      name: OLD_CONFIG.name,
      storeName: OLD_CONFIG.storeName,
      driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
    });
    const oldKey = `${OLD_CONFIG.graphKeyPrefix}:${projectId}`;
    return oldStore.getItem<PersistedGraphState>(oldKey);
  } catch {
    return null;
  }
}

// ===== 公开 API =====

/**
 * 加载项目的 graph 数据(自动从旧存储迁移, 合并大 data 分片)
 * @param projectId 项目 id
 * @returns graph 数据,若不存在返回 null
 */
export async function loadProjectGraph(projectId: string): Promise<GraphModel | null> {
  // 先尝试从新存储读取
  const raw = await store.getItem<PersistedGraphState>(graphKey(projectId));
  if (raw) {
    const graph = raw.graph ?? null;
    if (!graph) return null;
    // P1-6: 合并大 data 分片(由 PersistencePlugin 拆分存储)
    return await mergeProjectLargeData(projectId, graph);
  }

  // 新存储没有数据,尝试从旧存储迁移
  const oldData = await loadFromOldStorage(projectId);
  if (oldData) {
    // 迁移后保存到新存储
    await store.setItem(graphKey(projectId), oldData);
    console.info(`[graph-store] migrated data from old storage: ${projectId}`);
    return oldData.graph ?? null;
  }

  return null;
}

/**
 * P1-6: 合并大 data 分片。
 * 遍历 graph.nodes, 对包含 _dataRef 的节点, 从 localforage 读取对应 data 并恢复。
 * 兼容旧数据(无 _dataRef 引用), 直接返回原 graph。
 */
async function mergeProjectLargeData(projectId: string, graph: GraphModel): Promise<GraphModel> {
  const dataPrefix = `${GRAPH_KEY_PREFIX}:${projectId}:data`;
  const hasRefs = graph.nodes.some(
    (n) => n.data && typeof n.data === 'object' && '_dataRef' in n.data,
  );
  if (!hasRefs) return graph;

  const newNodes = await Promise.all(
    graph.nodes.map(async (n) => {
      if (!n.data || typeof n.data !== 'object' || !('_dataRef' in n.data)) return n;
      const ref = (n.data as Record<string, unknown>)._dataRef as string;
      const largeData = await store.getItem<unknown>(`${dataPrefix}:${ref}`);
      if (largeData === null) {
        console.warn(`[graph-store] large data not found for node ${n.id}, using ref`);
        return n;
      }
      return { ...n, data: largeData };
    }),
  );
  return { ...graph, nodes: newNodes };
}

/**
 * 保存项目的 graph 数据
 * @param projectId 项目 id
 * @param graph 图数据
 */
export async function saveProjectGraph(projectId: string, graph: GraphModel): Promise<void> {
  const data: PersistedGraphState = {
    version: CURRENT_VERSION,
    savedAt: Date.now(),
    graph,
  };
  await store.setItem(graphKey(projectId), data);
}

/**
 * 删除项目的 graph 数据
 * @param projectId 项目 id
 */
export async function deleteProjectGraph(projectId: string): Promise<void> {
  await store.removeItem(graphKey(projectId));
}

/**
 * 批量删除项目的 graph 数据
 * @param projectIds 项目 id 数组
 */
export async function deleteProjectGraphs(projectIds: string[]): Promise<void> {
  await Promise.all(projectIds.map((id) => store.removeItem(graphKey(id))));
}
