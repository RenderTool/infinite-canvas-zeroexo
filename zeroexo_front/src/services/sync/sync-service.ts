/**
 * sync-service - 简化版云同步服务（核心编排模块）
 *
 * 已拆分为以下模块:
 * - sync-utils.ts: 工具函数(脏标志、队列、待删除追踪、冲突检测)
 * - sync-resources.ts: 资源上传(CAS 去重、blob 上传)
 * - sync-projects.ts: 项目同步(推送、合并、冲突处理)
 * - sync-prompts.ts: 提示词同步
 * - sync-assets.ts: 资产同步
 *
 * 本文件仅保留核心编排逻辑:fullSync、事件处理、防抖推送。
 */

import { getProject, loadProjectGraph, deleteProject, deleteProjectGraph } from '@zeroexo/plugin-persistence';
import type { GraphModel } from '@zeroexo/core';
import { apiGet, apiDelete, ApiError } from '../api-client.js';
import type { CloudProject } from './sync-projects.js';
import { syncProjectToCloud, mergeCloudProjectToLocal, pullCloudProjects, pushLocalProjects, pushLocalOverrideCloud, repushLocalAsNewCloud, forcePushLocalToCloud } from './sync-projects.js';
import { syncProjectResourcesFromCloud, computeBlobHash, uploadBlobContentToCloud, syncProjectResourcesToCloud, saveCanvasResourceToAssets } from './sync-resources.js';
import { pullCloudPrompts, mergeCloudPromptToLocal, pushLocalPrompts, onPromptCreated, onPromptUpdated, onPromptDeleted } from './sync-prompts.js';
import { pullCloudAssets, mergeCloudAssetToLocal, pushLocalAssets, pushAssetToCloud, onAssetCreated, onAssetUpdated, onAssetDeleted } from './sync-assets.js';
import {
  debugLog, debugError,
  PROJECT_UPDATE_DEBOUNCE_MS, FULL_SYNC_DEBOUNCE_MS,
  markProjectDirty, markProjectClean, isProjectDirty,
  markPendingDelete, clearPendingDelete,
  enqueuePush, checkProjectConflict, notifyProjectConflict,
  hasLocalChanges,
} from './sync-utils.js';
import type { ProjectConflict } from './sync-utils.js';
import { isOnline, isTabActive, setSyncStatus, setLastSyncedAt } from './sync-store.js';

// 重新导出子模块的公共 API，保持向后兼容
export { syncProjectToCloud, forcePushLocalToCloud, pushLocalOverrideCloud, repushLocalAsNewCloud };
export { syncProjectResourcesFromCloud, computeBlobHash, uploadBlobContentToCloud, syncProjectResourcesToCloud, saveCanvasResourceToAssets };
export { pullCloudPrompts, mergeCloudPromptToLocal, pushLocalPrompts, onPromptCreated, onPromptUpdated, onPromptDeleted };
export { pullCloudAssets, mergeCloudAssetToLocal, pushLocalAssets, pushAssetToCloud, onAssetCreated, onAssetUpdated, onAssetDeleted };
export { checkProjectConflict, markProjectDirty, markProjectClean, isProjectDirty };
export type { ProjectConflict };

// ===== 全量同步状态（本地变量，避免 ES 模块导入赋值错误）=====
let isFullSyncing = false;
let fullSyncTimer: ReturnType<typeof setTimeout> | null = null;

// ===== 单项目云端拉取 ====

export async function syncProjectFromCloud(projectId: string, force = false): Promise<void> {
  if (!isOnline()) return;
  try {
    const cloud: CloudProject = await apiGet<CloudProject>(`/projects/${projectId}`);
    await mergeCloudProjectToLocal(cloud, force);
    markProjectClean(projectId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // 仅当本地项目曾有 cloudId(之前同步过)时才删除本地数据
      // 新项目(cloudId 为空)不应删除,否则会导致"项目不存在或已被删除"误报
      const local = await getProject(projectId);
      if (local?.cloudId) {
        await deleteProjectGraph(projectId);
        await deleteProject(projectId);
      }
    }
    throw err;
  }
}

// ===== 全量同步 =====

export async function fullSync(): Promise<void> {
  if (isFullSyncing) {
    debugLog('[sync] fullSync already in progress, skip');
    return;
  }
  if (!isOnline()) {
    debugLog('[sync] offline, skip fullSync');
    return;
  }
  if (!isTabActive()) {
    debugLog('[sync] tab inactive, skip fullSync');
    return;
  }

  // 清除全量同步防抖定时器
  if (fullSyncTimer) {
    clearTimeout(fullSyncTimer);
    fullSyncTimer = null;
  }

  isFullSyncing = true;
  setSyncStatus('syncing');
  try {
    await pullAllFromCloud();

    // 推送到云端前先检查是否有脏数据,无脏数据时跳过全量推送扫描
    if (await hasLocalChanges()) {
      debugLog('[sync] has local changes, pushing to cloud');
      await pushAllToCloud();
    } else {
      debugLog('[sync] no local changes, skip push');
    }

    await setLastSyncedAt(new Date().toISOString());
    setSyncStatus('idle');
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      debugError('[sync] fullSync failed: network error (backend unreachable), will retry on next sync');
    } else {
      debugError('[sync] fullSync failed:', err);
    }
    setSyncStatus('error');
  } finally {
    isFullSyncing = false;
  }
}

/** 防抖版 fullSync:短时间内多次调用只触发最后一次 */
export function debouncedFullSync(): void {
  if (fullSyncTimer) clearTimeout(fullSyncTimer);
  fullSyncTimer = setTimeout(() => {
    fullSyncTimer = null;
    void fullSync();
  }, FULL_SYNC_DEBOUNCE_MS);
}

async function pullAllFromCloud(): Promise<void> {
  await pullCloudAssets();
  await pullCloudPrompts();
  await pullCloudProjects();
}

async function pushAllToCloud(): Promise<void> {
  await pushLocalAssets();
  await pushLocalPrompts();
  await pushLocalProjects();
}

// ===== 项目事件处理 =====

export async function onProjectCreated(localId: string): Promise<void> {
  if (isOnline()) {
    enqueuePush(localId, async () => {
      try {
        await syncProjectToCloud(localId);
      } catch (err) {
        debugError(`[sync] onProjectCreated ${localId} failed:`, err);
      }
    });
  }
}

export async function onProjectUpdated(localId: string): Promise<void> {
  markProjectDirty(localId);

  if (!isTabActive()) {
    debugLog(`[sync] tab inactive, skip onProjectUpdated for ${localId}`);
    return;
  }
  if (!isOnline()) return;

  const local = await getProject(localId);
  if (!local || !local.cloudId) {
    debouncedPush(localId);
    return;
  }

  try {
    const cloud = await apiGet<CloudProject>(`/projects/${local.cloudId}`);
    if (cloud.version > (local.version ?? 0) && !isProjectDirty(localId)) {
      await syncProjectResourcesFromCloud((cloud.scene as GraphModel['nodes']) ?? []);
      await mergeCloudProjectToLocal(cloud);
      return;
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      const localGraph = await loadProjectGraph(localId);
      notifyProjectConflict({
        projectId: localId,
        title: local.title,
        localVersion: local.version ?? 0,
        cloudVersion: 0,
        localUpdatedAt: local.updatedAt,
        cloudUpdatedAt: '',
        localNodeCount: localGraph?.nodes.length ?? 0,
        cloudNodeCount: 0,
        hasLocalChanges: isProjectDirty(localId),
        cloudDeleted: true,
      });
      return;
    }
    debugLog(`[sync] onProjectUpdated cloud fetch failed for ${localId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  debouncedPush(localId);
}

/** 防抖推送(内部辅助,避免重复代码) */
const updateTimers = new Map<string, ReturnType<typeof setTimeout>>();
function debouncedPush(localId: string): void {
  const existing = updateTimers.get(localId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    updateTimers.delete(localId);
    enqueuePush(localId, async () => {
      await syncProjectToCloud(localId);
    });
  }, PROJECT_UPDATE_DEBOUNCE_MS);
  updateTimers.set(localId, timer);
}

export async function onProjectDeleted(localId: string, options?: { skipLocalDelete?: boolean }): Promise<void> {
  const local = await getProject(localId);
  const cloudId = local?.cloudId;

  if (isOnline()) {
    const deleteId = cloudId || localId;
    try {
      await apiDelete(`/projects/${deleteId}`);
      debugLog(`[sync] deleted project from cloud: ${deleteId}`);
      if (cloudId) clearPendingDelete(cloudId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        debugLog(`[sync] cloud project ${deleteId} already deleted (404), treat as success`);
        if (cloudId) clearPendingDelete(cloudId);
      } else {
        debugError(`[sync] onProjectDeleted ${localId} failed to delete from cloud:`, err);
        if (cloudId) markPendingDelete(cloudId);
      }
    }
  } else {
    if (cloudId) markPendingDelete(cloudId);
  }

  if (!options?.skipLocalDelete) {
    try {
      await deleteProjectGraph(localId);
      await deleteProject(localId);
      debugLog(`[sync] deleted local project ${localId}`);
    } catch (err) {
      debugError(`[sync] onProjectDeleted ${localId} failed to delete locally:`, err);
    }
  }
}

// ===== 强制拉取 =====

export async function forcePullProjectFromCloud(projectId: string): Promise<void> {
  if (!isOnline()) return;
  try {
    const cloud: CloudProject = await apiGet<CloudProject>(`/projects/${projectId}`);
    await mergeCloudProjectToLocal(cloud, true);
    markProjectClean(projectId);
    debugLog(`[sync] force pull project ${projectId} from cloud succeeded`);
  } catch (err) {
    // 云端 404 说明项目已被删除,本地也删除
    if (err instanceof ApiError && err.status === 404) {
      await deleteProjectGraph(projectId);
      await deleteProject(projectId);
      debugLog(`[sync] force pull project ${projectId}: cloud deleted, remove locally`);
    } else {
      debugError(`[sync] force pull project ${projectId} failed:`, err);
      throw err;
    }
  }
}