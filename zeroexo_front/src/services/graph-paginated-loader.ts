/**
 * graph-paginated-loader.ts - 分页 Graph 加载器 (Phase 5, Task 35)
 *
 * 提供 loadProjectGraphPaginated 函数，从后端 GET /api/projects/:id/graph 分页拉取节点。
 * 支持：
 *  - offset/limit 分页
 *  - 节点缓存（避免重复加载已缓存的节点）
 *  - hasMore 判断
 *  - 逐页追加
 */

import { getApiBaseUrl, getToken } from './api-client.js';

/** 分页 graph 响应 */
export interface PaginatedGraphResponse {
  nodes: Record<string, unknown>[];
  connections: unknown;
  viewport: unknown;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** 节点缓存（Map<projectId, Map<nodeId, node>>） */
const nodeCache = new Map<string, Map<string, Record<string, unknown>>>();

/**
 * 分页加载画布 graph 节点。
 * 已缓存的节点不会重复请求。
 *
 * @param projectId - 项目 ID
 * @param offset - 起始偏移
 * @param limit - 每页条数(默认 50,最大 200)
 * @param options - 可选配置
 * @returns 分页结果
 */
export async function loadProjectGraphPaginated(
  projectId: string,
  offset = 0,
  limit = 50,
  options?: { signal?: AbortSignal },
): Promise<PaginatedGraphResponse> {
  const token = getToken();
  if (!token) {
    throw new Error('未登录，无法加载画布数据');
  }

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}/graph?offset=${offset}&limit=${Math.min(limit, 200)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: options?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`加载画布 graph 失败: HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  const data: PaginatedGraphResponse = await res.json();

  // 缓存新加载的节点
  let projectCache = nodeCache.get(projectId);
  if (!projectCache) {
    projectCache = new Map();
    nodeCache.set(projectId, projectCache);
  }
  for (const node of data.nodes) {
    const id = (node as Record<string, unknown>).id as string;
    if (id) {
      projectCache.set(id, node);
    }
  }

  return data;
}

/**
 * 从缓存中读取节点。
 * 仅返回已加载过的节点，不触发网络请求。
 */
export function getCachedNode(
  projectId: string,
  nodeId: string,
): Record<string, unknown> | undefined {
  return nodeCache.get(projectId)?.get(nodeId);
}

/**
 * 获取指定项目已缓存的节点数量。
 */
export function getCachedNodeCount(projectId: string): number {
  return nodeCache.get(projectId)?.size ?? 0;
}

/**
 * 清除指定项目的节点缓存。
 */
export function clearNodeCache(projectId?: string): void {
  if (projectId) {
    nodeCache.delete(projectId);
  } else {
    nodeCache.clear();
  }
}

/**
 * 追加加载下一页节点。
 * 自动计算 offset = 当前已缓存节点数量。
 *
 * @param projectId - 项目 ID
 * @param limit - 每页条数
 * @param signal - 可选的取消信号
 * @returns 新加载的节点列表 + 是否还有更多
 */
export async function loadNextPage(
  projectId: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<{ nodes: Record<string, unknown>[]; hasMore: boolean; total: number }> {
  const offset = getCachedNodeCount(projectId);
  const data = await loadProjectGraphPaginated(projectId, offset, limit, { signal });
  return {
    nodes: data.nodes,
    hasMore: data.hasMore,
    total: data.total,
  };
}

/**
 * 加载所有节点（逐页拉取直到 hasMore=false）。
 * 适用于需要全量节点但分页逐步加载的场景。
 */
export async function loadAllNodesPaginated(
  projectId: string,
  pageSize = 100,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Record<string, unknown>[]> {
  let offset = 0;
  let allNodes: Record<string, unknown>[] = [];
  let hasMore = true;

  while (hasMore) {
    if (signal?.aborted) break;
    const data = await loadProjectGraphPaginated(projectId, offset, pageSize, { signal });
    allNodes = allNodes.concat(data.nodes);
    hasMore = data.hasMore;
    offset = data.offset + data.limit;
    onProgress?.(allNodes.length, data.total);
  }

  return allNodes;
}