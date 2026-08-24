/**
 * sync-projects - 项目同步模块
 *
 * 从 sync-service 中提取的项目同步相关功能。
 * Phase3(Yjs 单主干)后仅保留:云端列表拉取、本地合并、删除重试、轻量元数据推送。
 * 旧 HTTP 写路径(syncProjectToCloud/冲突自动解决/409 重试/强制覆盖)已随
 * mergeIncrementalScene 与乐观锁一并退役,画布数据写主权收敛至 Y.Doc。
 */

import type { GraphModel } from '@zeroexo/core';
import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import {
  getProject,
  upsertProject,
  deleteProject,
  saveProjectGraph,
  deleteProjectGraph,
} from '@zeroexo/plugin-persistence';
import { apiGet, apiPatch, apiDelete, ApiError } from '../api-client.js';
import { isOnline } from './sync-store.js';
import {
  debugLog,
  debugError,
  clearPendingDelete,
  pendingDeleteCloudIds,
} from './sync-utils.js';

export interface CloudProject {
  id: string;
  ownerId: string;
  title: string;
  scene: unknown;
  connections: unknown;
  viewport: unknown | null;
  backgroundMode: string;
  showImageInfo: boolean;
  thumbnailUrl: string | null;
  tags: string[];
  isPublic: boolean;
  version: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 画布元数据(随场景数据一起存储,含 coverUrl 等) */
  metadata?: Record<string, unknown>;
}

interface CloudProjectList {
  items: CloudProject[];
  nextCursor: string | null;
}

/**
 * 轻量元数据推送(Phase3 保留通道):title/thumbnailUrl/tags 走 PATCH,不含
 * scene/connections/viewport/version(画布数据写路径已移交 Yjs storeCanvasDocument
 * upsert)。服务重命名/封面设置等元数据场景,无 cloudId 时后端 upsert 兜底创建。
 */
export async function pushProjectMeta(projectId: string): Promise<void> {
  if (!isOnline()) return;
  const local = await getProject(projectId);
  if (!local) return;
  try {
    await apiPatch<CloudProject>(`/projects/${local.cloudId ?? projectId}`, {
      id: local.id,
      title: local.title,
      thumbnailUrl: local.thumbnailUrl,
      tags: local.tags,
    });
    debugLog(`[sync-service] pushProjectMeta ${projectId} ok`);
  } catch (err) {
    debugLog(`[sync-service] pushProjectMeta ${projectId} failed:`, err);
  }
}

export async function mergeCloudProjectToLocal(cloud: CloudProject, _force = false): Promise<void> {
  const local = await getProject(cloud.id);

  const cloudNodes = (cloud.scene as GraphModel['nodes']) ?? [];

  // 资源批量下载已移除(2026-08 下载策略重构):fullSync 只同步 scene JSON 快照。
  // 节点资源由渲染层 useProgressiveImage 按可见性/缩放级别按需拉取 LOD 档位,
  // 否则全项目全节点串行下载会在 fullSync 阶段直接打爆限流(429)。

  if (!local) {
    const graph: GraphModel = {
      nodes: cloudNodes,
      edges: (cloud.connections as GraphModel['edges']) ?? [],
      viewport: (cloud.viewport as GraphModel['viewport']) ?? { x: 0, y: 0, k: 1 },
      metadata: cloud.metadata ?? {},
    };
    const nodeCount = graph.nodes.length;
    const meta: CanvasProjectMeta = {
      id: cloud.id,
      title: cloud.title,
      createdAt: cloud.createdAt,
      updatedAt: cloud.updatedAt,
      thumbnailUrl: cloud.thumbnailUrl,
      tags: cloud.tags,
      nodeCount,
      version: cloud.version,
      cloudId: cloud.id,
      lastSyncedAt: cloud.lastSyncedAt,
    };
    await upsertProject(meta);
    await saveProjectGraph(cloud.id, graph);
    return;
  }

  if (cloud.version > (local.version ?? 0)) {
    // 云端权威策略:始终用云端版本覆盖本地,不检查脏标记
    // 本地未推送的修改会在下次 push 时推送到云端

    const graph: GraphModel = {
      nodes: cloudNodes,
      edges: (cloud.connections as GraphModel['edges']) ?? [],
      viewport: (cloud.viewport as GraphModel['viewport']) ?? { x: 0, y: 0, k: 1 },
      metadata: cloud.metadata ?? {},
    };

    const updated: CanvasProjectMeta = {
      ...local,
      title: cloud.title,
      updatedAt: cloud.updatedAt,
      thumbnailUrl: cloud.thumbnailUrl,
      tags: cloud.tags,
      nodeCount: graph.nodes.length,
      version: cloud.version,
      cloudId: cloud.id,
      lastSyncedAt: cloud.lastSyncedAt,
    };
    await upsertProject(updated);
    await saveProjectGraph(cloud.id, graph);
  }
}

export async function pullCloudProjects(): Promise<void> {
  const cloudIds = new Set<string>();
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res: CloudProjectList = await apiGet<CloudProjectList>(`/projects${query}`);
    for (const cloud of res.items) {
      cloudIds.add(cloud.id);
      // 跳过待删除项目:本地已删除但云端删除失败的项目,不重新拉取避免"删除后项目又出现"
      // 同时尝试重新删除云端(网络恢复后可能成功,成功后清除标记)
      if (pendingDeleteCloudIds.has(cloud.id)) {
        debugLog(`[sync-service] skip pulling pending-delete project ${cloud.id}, retry cloud delete`);
        // 异步重试删除,不阻塞本次同步流程
        void retryPendingDelete(cloud.id);
        continue;
      }
      await mergeCloudProjectToLocal(cloud);
    }
    cursor = res.nextCursor;
  } while (cursor);

  const localProjects = await listLocalProjects();
  for (const local of localProjects) {
    if (local.cloudId && !cloudIds.has(local.cloudId)) {
      // 本地有 cloudId 但云端列表中没有 → 云端已删除,清除本地
      // 注意:待删除项目不会出现在 cloudIds 中(被 continue 跳过),但其本地记录已被 onProjectDeleted
      // 删除,所以不会误删。此处只清理"云端确实已删除但本地残留"的项目。
      if (pendingDeleteCloudIds.has(local.cloudId)) {
        // 待删除项目:本地记录可能已被删(getProject 返回 null 不会进入此循环),跳过
        continue;
      }
      try {
        await deleteProjectGraph(local.id);
        await deleteProject(local.id);
        debugLog(`[sync-service] removed stale project ${local.id} (not in cloud)`);
      } catch (err) {
        debugError(`[sync-service] remove stale project ${local.id} failed:`, err);
      }
    }
  }
}

/**
 * 重试删除待删除项目(网络恢复后由 pullCloudProjects 触发)。
 * 成功后清除待删除标记,使后续 fullSync 不再跳过该项目。
 * 失败则保留标记,等下次 fullSync 再次重试。
 */
export async function retryPendingDelete(cloudId: string): Promise<void> {
  try {
    await apiDelete(`/projects/${cloudId}`);
    clearPendingDelete(cloudId);
    debugLog(`[sync-service] retryPendingDelete succeeded for ${cloudId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // 云端已不存在,视为删除成功
      clearPendingDelete(cloudId);
      debugLog(`[sync-service] retryPendingDelete ${cloudId} already deleted (404)`);
    } else {
      debugLog(`[sync-service] retryPendingDelete ${cloudId} still failing: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * 全量推送项目(仅兜底「从未编辑过、无云端记录」的新项目):
 * Phase3 后画布数据写主权收敛至 Y.Doc,服务端 storeCanvasDocument upsert 自动创建
 * 云端记录并落库;此处只需为从未打开过编辑器的项目(无 cloudId)发起轻量元数据
 * 创建兜底(pushProjectMeta 的 PATCH 后端 upsert)。脏标记机制已随 HTTP 写路径退役。
 */
export async function pushLocalProjects(): Promise<void> {
  const localProjects = await listLocalProjects();
  for (const local of localProjects) {
    if (!local.cloudId) {
      try {
        await pushProjectMeta(local.id);
      } catch (err) {
        debugError(`[sync-service] push project ${local.id} failed:`, err);
      }
    }
  }
}

async function listLocalProjects(): Promise<CanvasProjectMeta[]> {
  const { listProjects } = await import('@zeroexo/plugin-persistence');
  return listProjects();
}