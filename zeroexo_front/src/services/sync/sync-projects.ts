/**
 * sync-projects - 项目同步模块
 *
 * 从 sync-service 中提取的项目同步相关功能。
 * 包含项目推送、拉取、冲突检测、合并等操作。
 */

import type { GraphModel } from '@zeroexo/core';
import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import {
  getProject,
  upsertProject,
  deleteProject,
  loadProjectGraph,
  saveProjectGraph,
  deleteProjectGraph,
} from '@zeroexo/plugin-persistence';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../api-client.js';
import { setSyncStatus, isOnline, isTabActive } from './sync-store.js';
import {
  debugLog,
  debugError,
  markProjectClean,
  isProjectDirty,
  markProjectSynced,
  clearPendingDelete,
  pendingDeleteCloudIds,
  checkProjectConflict,
  notifyProjectConflict,
  takeChangedNodeIds,
  scheduleAutoRetry,
} from './sync-utils.js';
import { syncProjectResourcesToCloud, syncProjectResourcesFromCloud } from './sync-resources.js';

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

export async function syncProjectToCloud(
  projectId: string,
  options?: { reason?: 'manual' | 'debounced' | 'rate-limit-retry' | 'transient-error-retry' },
): Promise<void> {
  void options; // 保留用于调试/日志,当前无需分支逻辑
  if (!isOnline()) return;
  if (!isTabActive()) {
    debugLog(`[sync-service] tab inactive, skip syncProjectToCloud for ${projectId}`);
    return;
  }

  const local = await getProject(projectId);
  if (!local) return;

  try {
    // 推送前检测云端版本:若云端有更新(cloudVersion > localVersion)或云端项目已删除,
    // 不推送(避免覆盖云端 / 推送到已删除的项目),
    // 立即弹窗让用户主动决策(推送本地/拉取云端)。
    if (local.cloudId) {
      const conflict = await checkProjectConflict(projectId);
      if (conflict && (conflict.cloudDeleted || conflict.cloudVersion > conflict.localVersion)) {
        debugLog(
          `[sync-service] ${conflict.cloudDeleted ? 'cloud deleted' : `cloud newer (cloud=${conflict.cloudVersion} > local=${conflict.localVersion})`}, skip push`,
        );
        notifyProjectConflict(conflict);
        return;
      }
    }

    // 预检通过,开始实际推送
    setSyncStatus('syncing');
    const graph = await loadProjectGraph(projectId);
    const nodes = graph?.nodes ?? [];

    // 获取节点级变更 ID 列表(FastArray DirtyMask)
    const changedIds = takeChangedNodeIds(projectId);

    debugLog(`[sync-service] syncProjectToCloud ${projectId}: total=${nodes.length}, delta=${changedIds.length} nodes`);

    await syncProjectResourcesToCloud(nodes);

    // 持久化 storageKey 更新: syncProjectResourcesToCloud 可能为 blob URL 节点
    // 设置了 data.storageKey(cloud key), 保存回 localforage 避免下次推送重复上传
    // 注意: 保存失败时阻止推送, 避免向云端推送带 local storageKey 的 graph(其他浏览器无法解析)
    if (graph) {
      try {
        await saveProjectGraph(projectId, graph);
      } catch (err) {
        debugLog(`[sync-service] save graph after resource upload failed for ${projectId}:`, err);
        debugLog('[sync-service] abort push to avoid pushing local storageKeys to cloud');
        return;
      }
    }

    /**
     * 增量同步策略(类似 UE5 FastArray):
     *
     * - 有 changedIds → 只发送变更节点 + deleted 标记,后端 mergeIncrementalScene 合并
     * - 无 changedIds(首次同步/全量回退) → 发送完整 scene
     *
     * 性能对比(500 节点画布):
     *   拖拽 1 个节点:   ~200B delta vs ~500KB full scene  ← 2500x 压缩
     *   删除 10 个节点: ~300B delta vs ~500KB full scene  ← 1600x 压缩
     *   批量粘贴 50 个: ~50KB  delta vs ~600KB full scene  ← 12x 压缩
     */
    let scenePayload: unknown;
    let changedNodeIdsPayload: string[] | undefined;

    if (changedIds.length > 0 && local.cloudId) {
      // 增量模式:只提取变更的节点。
      // 用 Map 索引避免对每个 changedId 做 O(n) find(500+ 节点下避免 O(n²))
      const nodeById = new Map(
        (nodes as unknown as Record<string, unknown>[]).map((n) => [n.id as string, n] as const),
      );
      const deltaNodes: unknown[] = [];
      let deletedCount = 0;

      for (const nodeId of changedIds) {
        const node = nodeById.get(nodeId);
        if (node) {
          deltaNodes.push(node);
        } else {
          // 节点在 changedIds 中但不在当前 nodes 中 → 已被删除
          deltaNodes.push({ type: '__deleted__', id: nodeId });
          deletedCount++;
        }
      }

      scenePayload = deltaNodes;
      changedNodeIdsPayload = changedIds;
      debugLog(`[sync-service] delta sync: ${deltaNodes.length} changed nodes (${deletedCount} deleted)`);
    } else {
      // 全量模式:首次同步或无变更追踪时发送完整 scene
      scenePayload = nodes;
      changedNodeIdsPayload = undefined;
    }

    const payload: Record<string, unknown> = {
      id: local.id,
      title: local.title,
      thumbnailUrl: local.thumbnailUrl,
      tags: local.tags,
      scene: scenePayload,
      connections: graph?.edges ?? [],
      viewport: graph?.viewport ?? { x: 0, y: 0, k: 1 },
      metadata: graph?.metadata ?? {},
      // 乐观锁:后端检查 expectedVersion < existing.version 时返回 409
      expectedVersion: local.version,
      // 增量同步关键字段:存在时后端走 mergeIncrementalScene 而非全量替换
      ...(changedNodeIdsPayload !== undefined ? { changedNodeIds: changedNodeIdsPayload } : {}),
    };

    let cloud: CloudProject;
    if (!local.cloudId) {
      cloud = await apiPost<CloudProject>('/projects', payload);
    } else {
      try {
        cloud = await apiPatch<CloudProject>(`/projects/${local.cloudId}`, payload);
      } catch (err) {
        // 后端 409:并发推送导致版本冲突(乐观锁).
        // 不再直接弹窗,而是自动重试:重新读取最新的本地 version 并重新推送.
        // 最多重试 MAX_409_RETRIES 次,全部耗尽仍冲突才通知用户.
        // 注意:后端错误消息可能为英文"Version conflict:"或中文"版本冲突"等,
        // 使用 err.status === 409 判断更可靠,避免大小写/翻译差异导致的漏匹配.
        if (err instanceof ApiError && err.status === 409) {
          debugLog('[sync-service] push conflict (409), auto-retrying with latest version');
          const retried = await retryPushOnConflict(projectId, 1);
          if (!retried) {
            // 自动重试耗尽,弹窗让用户手动决策
            const latest = await checkProjectConflict(projectId);
            if (latest) {
              notifyProjectConflict(latest);
            }
          }
          // 409 处理完成,无论是否重试成功都返回(不把状态标为失败,冲突已交给用户决策)
          return;
        }

        // ★ 429 限流:保留节点变更记录,标记同步失败,并调度指数退避自动重试。
        //   这样即使客户端被限流,数据最终也会自动同步到云端,用户不会在
        //   "误以为已同步"的状态下丢失数据。
        if (err instanceof ApiError && err.status === 429) {
          debugLog(`[sync-service] push rate-limited (429) for ${projectId}, marking sync error + scheduling auto-retry.`);
          setSyncStatus('error');
          // 自动退避重试;优先采用服务端 Retry-After,无提示时按指数退避(2s→4s→8s→...→60s,最多 5 次)
          scheduleAutoRetry(projectId, async () => {
            await syncProjectToCloud(projectId, { reason: 'rate-limit-retry' });
          }, err.retryAfter);
          return;
        }

        // 其他错误(500/网络):同样保留变更 + dirty,标记失败,并调度自动重试
        debugLog(`[sync-service] push failed for ${projectId}: ${err instanceof Error ? err.message : String(err)}`);
        setSyncStatus('error');
        scheduleAutoRetry(projectId, async () => {
          await syncProjectToCloud(projectId, { reason: 'transient-error-retry' });
        });
        return;
      }
    }
    if (cloud) {
      await markProjectSynced(projectId, cloud.id, cloud.version, cloud.lastSyncedAt ?? undefined);
      // 推送成功,清除脏标志 + 节点级变更记录
      markProjectClean(projectId);
      // 只有真正成功才显示空闲状态
      setSyncStatus('idle');
    }
  } catch (err) {
    // 外层兜底:资源上传/快照等环节异常,保留 dirty + 节点变更,标记失败
    debugError(`[sync-service] syncProjectToCloud ${projectId} failed:`, err);
    setSyncStatus('error');
  }
}

/** 409 自动重试的最大次数 */
const MAX_409_RETRIES = 3;

/**
 * 自动重试推送:409 发生后,重新读取最新本地 version,并重新推送。
 * 如果重试期间本地 version 已更新(前一个推送成功写入),重新推送大概率成功。
 * 如果云端版本持续高于本地(真正的多设备冲突),降级到外部处理(弹窗)。
 * @param projectId 项目 ID
 * @param attemptCount 已尝试次数
 * @returns true=自动重试成功, false=冲突依然存在,需要弹窗
 */
async function retryPushOnConflict(projectId: string, attemptCount: number): Promise<boolean> {
  if (attemptCount > MAX_409_RETRIES) {
    debugLog(`[sync-service] retryPushOnConflict exhausted (${MAX_409_RETRIES} retries) for ${projectId}`);
    return false;
  }

  // 读取最新的本地项目和云端项目
  const local = await getProject(projectId);
  if (!local) return false;

  try {
    const conflict = await checkProjectConflict(projectId);
    // 无冲突(版本一致) → 说明前一个推送已经成功更新了本地版本,无需重试
    if (!conflict) return true;

    // 云端仍高于本地 → 自动重试(读取最新 scene 重新推送)
    if (conflict.cloudVersion > conflict.localVersion) {
      debugLog(`[sync-service] retryPushOnConflict attempt ${attemptCount}: cloud=${conflict.cloudVersion} > local=${conflict.localVersion}, re-pushing`);

      const graph = await loadProjectGraph(projectId);
      const nodes = graph?.nodes ?? [];
      // 注意:不再调用 syncProjectResourcesToCloud — 父函数 syncProjectToCloud
      // 已经上传了资产,retry 只需重新推送 scene 数据(版本差异,资产已就绪)

      const payload: Record<string, unknown> = {
        id: local.id,
        title: local.title,
        thumbnailUrl: local.thumbnailUrl,
        tags: local.tags,
        scene: nodes,
        connections: graph?.edges ?? [],
        viewport: graph?.viewport ?? { x: 0, y: 0, k: 1 },
        metadata: graph?.metadata ?? {},
        expectedVersion: local.version,
      };

      const cloud = await apiPatch<CloudProject>(`/projects/${local.cloudId!}`, payload);
      await markProjectSynced(projectId, cloud.id, cloud.version, cloud.lastSyncedAt ?? undefined);
      markProjectClean(projectId);
      debugLog(`[sync-service] retryPushOnConflict attempt ${attemptCount} succeeded`);
      return true;
    }
  } catch (err) {
    // 重试时又是 409 → 继续递归重试
    if (err instanceof ApiError && err.status === 409) {
      debugLog(`[sync-service] retryPushOnConflict attempt ${attemptCount} got 409 again, retrying...`);
      return retryPushOnConflict(projectId, attemptCount + 1);
    }
    // 其他错误:降级到弹窗处理
    debugError(`[sync-service] retryPushOnConflict attempt ${attemptCount} failed with non-409 error:`, err);
  }

  return false;
}

/**
 * 强制推送本地版本覆盖云端(用户在冲突对话框选择"推送本地"后调用)。
 * 跳过冲突检测(用户已主动决策),带 expectedVersion 触发后端 409 兜底保护。
 * 后端返回 409 时(用户决策期间云端又被更新),抛错给调用方处理。
 * @param projectId 项目 id
 * @param expectedVersion 用户决策时的云端版本号(用于后端乐观锁检查)
 */
export async function pushLocalOverrideCloud(
  projectId: string,
  expectedVersion: number,
): Promise<void> {
  if (!isOnline()) return;

  const local = await getProject(projectId);
  if (!local || !local.cloudId) return;

  try {
    const graph = await loadProjectGraph(projectId);
    const nodes = graph?.nodes ?? [];

    await syncProjectResourcesToCloud(nodes);

    const payload = {
      id: local.id,
      title: local.title,
      thumbnailUrl: local.thumbnailUrl,
      tags: local.tags,
      scene: nodes,
      connections: graph?.edges ?? [],
      viewport: graph?.viewport ?? { x: 0, y: 0, k: 1 },
      metadata: graph?.metadata ?? {},
      expectedVersion,
    };

    const cloud = await apiPatch<CloudProject>(`/projects/${local.cloudId}`, payload);
    await markProjectSynced(projectId, cloud.id, cloud.version, cloud.lastSyncedAt ?? undefined);
    markProjectClean(projectId);
  } catch {}
}

/**
 * 强制推送本地版本作为新的云端项目(用户在冲突对话框选择"推送本地重新创建"后调用)。
 * 用于云端项目已被删除(404)的场景:走 apiPost 创建而非 apiPatch 更新,
 * 以相同 id 重新创建云端项目(本地 id = 云端 id 策略保证 id 一致)。
 * @param projectId 项目 id
 */
export async function repushLocalAsNewCloud(projectId: string): Promise<void> {
  if (!isOnline()) return;

  const local = await getProject(projectId);
  if (!local) return;

  try {
    const graph = await loadProjectGraph(projectId);
    const nodes = graph?.nodes ?? [];

    await syncProjectResourcesToCloud(nodes);

    const payload = {
      id: local.id,
      title: local.title,
      thumbnailUrl: local.thumbnailUrl,
      tags: local.tags,
      scene: nodes,
      connections: graph?.edges ?? [],
      viewport: graph?.viewport ?? { x: 0, y: 0, k: 1 },
      metadata: graph?.metadata ?? {},
    };

    // 强制走 create(apiPost)而非 update(apiPatch),重新创建已删除的云端项目
    const cloud = await apiPost<CloudProject>('/projects', payload);
    await markProjectSynced(projectId, cloud.id, cloud.version, cloud.lastSyncedAt ?? undefined);
    markProjectClean(projectId);
  } catch {}
}

/**
 * 强制推送本地数据到云端(覆盖云端版本)。
 * 专用于会话被抢占时的数据兜底:跳过冲突检测,直接推送本地最新数据,
 * 确保标签页失效前用户的最新编辑不丢失。
 * 支持传入 graph 参数(从编辑器内存读取),避免读取 localforage 过期数据。
 * 在 handleSessionTakenOver 中调用。
 */
export async function forcePushLocalToCloud(projectId: string, graph?: GraphModel): Promise<void> {
  if (!isOnline()) return;

  const local = await getProject(projectId);
  if (!local) return;

  // 优先使用传入的 graph(编辑器内存中最新数据),否则从 localforage 加载
  const resolvedGraph = graph ?? (await loadProjectGraph(projectId)) ?? undefined;
  const nodes = resolvedGraph?.nodes ?? [];

  // 上传节点中引用的资源(图片/视频/音频)
  await syncProjectResourcesToCloud(nodes);

  const payload: Record<string, unknown> = {
    id: local.id,
    title: local.title,
    thumbnailUrl: local.thumbnailUrl,
    tags: local.tags,
    scene: nodes,
    connections: graph?.edges ?? [],
    viewport: graph?.viewport ?? { x: 0, y: 0, k: 1 },
    metadata: graph?.metadata ?? {},
    expectedVersion: local.version,
  };

  try {
    let cloud: CloudProject;
    if (!local.cloudId) {
      // 新项目:创建
      cloud = await apiPost<CloudProject>('/projects', payload);
    } else {
      // 更新:带 expectedVersion 乐观锁,后端 409 时重试
      cloud = await apiPatch<CloudProject>(`/projects/${local.cloudId}`, payload);
    }
    await markProjectSynced(projectId, cloud.id, cloud.version, cloud.lastSyncedAt ?? undefined);
    markProjectClean(projectId);
  } catch (err) {
    // 409 版本冲突:另一标签页并发推送了更新,重新读取本地后重试一次
    if (err instanceof ApiError && err.status === 409) {
      const latest = await getProject(projectId);
      if (!latest) return;
      const latestGraph = await loadProjectGraph(projectId);
      const latestNodes = latestGraph?.nodes ?? [];
      await syncProjectResourcesToCloud(latestNodes);
      try {
        const cloud = await apiPatch<CloudProject>(`/projects/${latest.cloudId!}`, {
          ...payload,
          id: latest.id,
          title: latest.title,
          thumbnailUrl: latest.thumbnailUrl,
          tags: latest.tags,
          scene: latestNodes,
          connections: latestGraph?.edges ?? [],
          viewport: latestGraph?.viewport ?? { x: 0, y: 0, k: 1 },
          metadata: latestGraph?.metadata ?? {},
          expectedVersion: latest.version,
        });
        await markProjectSynced(projectId, cloud.id, cloud.version, cloud.lastSyncedAt ?? undefined);
        markProjectClean(projectId);
      } catch {
        // 第二次 409:静默失败(不影响后续流程)
      }
    }
    // 网络等其他错误:静默忽略
  }
}

export async function mergeCloudProjectToLocal(cloud: CloudProject, _force = false): Promise<void> {
  const local = await getProject(cloud.id);

  const cloudNodes = (cloud.scene as GraphModel['nodes']) ?? [];

  await syncProjectResourcesFromCloud(cloudNodes);

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

    if (isOnline()) {
      await syncProjectToCloud(cloud.id).catch((err) =>
        debugLog(`[sync-service] push cleanup for new project ${cloud.id} failed:`, err),
      );
    }
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

    // 覆盖后标记为"干净"(已同步到云端最新版本)
    markProjectClean(cloud.id);

    if (isOnline()) {
      await syncProjectToCloud(cloud.id).catch((err) =>
        debugLog(`[sync-service] push cleanup for project ${cloud.id} failed:`, err),
      );
    }
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

export async function pushLocalProjects(): Promise<void> {
  const localProjects = await listLocalProjects();
  for (const local of localProjects) {
    // 无 cloudId（全新项目）或 有脏标记（未推送修改）→ 尝试推送
    // 推送前 syncProjectToCloud 会做云端版本预检，有冲突时弹窗让用户决策
    if (!local.cloudId || isProjectDirty(local.id)) {
      try {
        await syncProjectToCloud(local.id);
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

export {
  retryPushOnConflict,
};