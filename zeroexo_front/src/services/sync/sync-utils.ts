/**
 * sync-utils - 同步工具函数模块(从 sync-service.ts 提取)
 *
 * 包含防抖常量、脏项目追踪、待删除追踪、推送队列、冲突检测、
 * 标签页失活检测等工具函数，供 sync-service 及其他模块使用。
 */

import { apiGet, ApiError } from '../api-client.js';
import { getProject, loadProjectGraph } from '@zeroexo/plugin-persistence';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { listPrompts } from '@/features/prompt-library/prompt-store.js';
import { isOnline, setTabInactive, notifyDirtyChanged } from './sync-store.js';

// ===== 调试函数 =====

const isDev = import.meta.env.DEV;

function debugLog(...args: unknown[]): void {
  if (isDev) console.log('[sync]', ...args);
}

function debugError(...args: unknown[]): void {
  if (isDev) console.error('[sync]', ...args);
}

// ===== 防抖常量 =====

/** 项目更新推送防抖间隔(ms) — 必须 > PersistencePlugin 的持久化防抖(400ms) + 100ms 安全余量 */
const PROJECT_UPDATE_DEBOUNCE_MS = 600;
/** 全量同步防抖间隔(ms) */
const FULL_SYNC_DEBOUNCE_MS = 1000;

// ===== 全量同步状态 =====

// isFullSyncing 和 fullSyncTimer 已移至 sync-service.ts

// ===== 脏项目追踪 =====

const DIRTY_PERSIST_KEY = 'zeroexo:dirty-projects';
const dirtyProjects = new Set<string>();

function persistDirtyProjects(): void {
  try {
    localStorage.setItem(DIRTY_PERSIST_KEY, JSON.stringify(Array.from(dirtyProjects)));
  } catch { /* noop */ }
}

function loadDirtyProjects(): void {
  try {
    const raw = localStorage.getItem(DIRTY_PERSIST_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach((id: string) => dirtyProjects.add(id));
    }
  } catch { /* noop */ }
}
loadDirtyProjects();

function markProjectDirty(projectId: string): void {
  dirtyProjects.add(projectId);
  persistDirtyProjects();
  notifyDirtyChanged();
}

function markProjectClean(projectId: string): void {
  dirtyProjects.delete(projectId);
  persistDirtyProjects();
  notifyDirtyChanged();
}

function isProjectDirty(projectId: string): boolean {
  return dirtyProjects.has(projectId);
}

// ===== 待删除项目追踪 =====

const PENDING_DELETE_KEY = 'zeroexo:pending-delete-cloud-ids';
const pendingDeleteCloudIds = new Set<string>();

function persistPendingDelete(): void {
  try {
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(Array.from(pendingDeleteCloudIds)));
  } catch { /* noop */ }
}

function loadPendingDelete(): void {
  try {
    const raw = localStorage.getItem(PENDING_DELETE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) arr.forEach((id: string) => pendingDeleteCloudIds.add(id));
    }
  } catch { /* noop */ }
}
loadPendingDelete();

function markPendingDelete(cloudId: string): void {
  pendingDeleteCloudIds.add(cloudId);
  persistPendingDelete();
}

function clearPendingDelete(cloudId: string): void {
  pendingDeleteCloudIds.delete(cloudId);
  persistPendingDelete();
}

// ===== 推送队列 =====

const pushQueues = new Map<string, Promise<void>>();

function enqueuePush(projectId: string, fn: () => Promise<void>): void {
  const prev = pushQueues.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn).catch((err) => {
    debugError(`[sync] push queue task failed for ${projectId}:`, err);
  });
  pushQueues.set(projectId, next);
  next.finally(() => {
    if (pushQueues.get(projectId) === next) {
      pushQueues.delete(projectId);
    }
  });
}

// ===== CloudProject 接口(内部使用) =====

interface CloudProject {
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
}

// ===== 冲突检测与通知 =====

/** 单项目冲突信息 */
export interface ProjectConflict {
  projectId: string;
  title: string;
  localVersion: number;
  cloudVersion: number;
  localUpdatedAt: string;
  cloudUpdatedAt: string;
  localNodeCount: number;
  cloudNodeCount: number;
  /** 本地是否有未推送修改(内存脏标志) */
  hasLocalChanges: boolean;
  /** 云端项目已被删除(404),需推送本地重新创建 */
  cloudDeleted?: boolean;
}

const PROJECT_CONFLICT_EVENT_NAME = 'zeroexo:project-conflict';

export function notifyProjectConflict(conflict: ProjectConflict): void {
  debugLog(`[sync] notifyProjectConflict: projectId=${conflict.projectId}, cloudDeleted=${conflict.cloudDeleted}, cloudV=${conflict.cloudVersion} > localV=${conflict.localVersion}`);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PROJECT_CONFLICT_EVENT_NAME, { detail: conflict }),
  );
}

/**
 * 检测单项目冲突:云端版本是否高于本地 + 本地是否有未推送修改
 * @returns 冲突信息(版本不一致时),版本一致或未同步返回 null
 */
export async function checkProjectConflict(projectId: string): Promise<ProjectConflict | null> {
  if (!isOnline()) return null;
  const local = await getProject(projectId);
  if (!local || !local.cloudId) return null;
  try {
    const cloud = await apiGet<CloudProject>(`/projects/${local.cloudId}`);
    if (cloud.version === local.version) return null; // 版本一致,无冲突
    const localGraph = await loadProjectGraph(projectId);
    const cloudNodeCount = Array.isArray(cloud.scene) ? (cloud.scene as unknown[]).length : 0;
    return {
      projectId,
      title: local.title,
      localVersion: local.version ?? 0,
      cloudVersion: cloud.version,
      localUpdatedAt: local.updatedAt,
      cloudUpdatedAt: cloud.updatedAt,
      localNodeCount: localGraph?.nodes.length ?? 0,
      cloudNodeCount,
      hasLocalChanges: isProjectDirty(projectId),
    };
  } catch (err) {
    // 404 表示云端项目已删除(SSE 删除事件丢失等场景导致本地 cloudId 失效),
    // 返回 cloudDeleted 冲突让前端弹窗,由用户选择"推送本地重新创建"或"取消"。
    if (err instanceof ApiError && err.status === 404) {
      debugLog(`[sync] cloud project ${local.cloudId} not found (deleted), return cloudDeleted conflict`);
      const localGraph = await loadProjectGraph(projectId);
      return {
        projectId,
        title: local.title,
        localVersion: local.version ?? 0,
        cloudVersion: 0,
        localUpdatedAt: local.updatedAt,
        cloudUpdatedAt: '',
        localNodeCount: localGraph?.nodes.length ?? 0,
        cloudNodeCount: 0,
        hasLocalChanges: isProjectDirty(projectId),
        cloudDeleted: true,
      };
    }
    debugError('[sync] checkProjectConflict failed:', err);
    return null;
  }
}

// ===== 检查本地是否有未推送修改 =====

async function hasLocalChanges(): Promise<boolean> {
  // 1. 内存中有脏项目标记 → 有变化
  if (dirtyProjects.size > 0) return true;

  // 2. 检查是否有未同步的本地资产(无 cloudId)
  const localAssets = await listAssets();
  for (const a of localAssets) {
    if (!a.cloudId) return true;
  }

  // 3. 检查是否有未同步的本地提示词(无 cloudId)
  const localPrompts = await listPrompts();
  for (const p of localPrompts) {
    if (!p.cloudId) return true;
  }

  return false;
}

// ===== 标签页失活检测(离屏时暂停同步) =====

if (typeof document !== 'undefined') {
  let prevVisibility = document.visibilityState;
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    if (hidden === (prevVisibility === 'hidden')) return; // 无变化
    prevVisibility = document.visibilityState;

    setTabInactive(hidden);
  });
}

// ===== markProjectSynced =====

async function markProjectSynced(projectId: string, cloudId: string, version: number, lastSyncedAt?: string): Promise<void> {
  const { updateProject } = await import('@zeroexo/plugin-persistence');
  const local = await getProject(projectId);
  if (local) {
    await updateProject(projectId, {
      cloudId,
      version,
      lastSyncedAt: lastSyncedAt ?? new Date().toISOString(),
    });
  }
}

// ===== 导出 =====

export {
  PROJECT_UPDATE_DEBOUNCE_MS,
  FULL_SYNC_DEBOUNCE_MS,
  markProjectDirty,
  markProjectClean,
  isProjectDirty,
  hasLocalChanges,
  markPendingDelete,
  clearPendingDelete,
  pendingDeleteCloudIds,
  enqueuePush,
  PROJECT_CONFLICT_EVENT_NAME,
  debugLog,
  debugError,
  markProjectSynced,
};