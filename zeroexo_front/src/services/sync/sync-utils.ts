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

/**
 * 项目更新推送防抖间隔(ms)。Yjs 负责实时协作，HTTP 只负责快照落库。
 * 2 秒可减少连续编辑期间的快照请求，同时不影响协作者看到实时状态。
 */
const PROJECT_UPDATE_DEBOUNCE_MS = 2_000;
/** 全量同步防抖间隔(ms) */
const FULL_SYNC_DEBOUNCE_MS = 1000;

// ===== 全量同步状态 =====

// isFullSyncing 和 fullSyncTimer 已移至 sync-service.ts

// ===== 脏项目追踪 =====

const DIRTY_PERSIST_KEY = 'zeroexo:dirty-projects';
const dirtyProjects = new Set<string>();

/**
 * 节点级变更追踪(类似 UE5 FastArray 的 DirtyMask)。
 *
 * key = projectId, value = 变更的节点 ID 集合。
 * 每次 push 成功后清空对应项目的变更集。
 * 用于增量同步:只推送变更节点而非完整 scene。
 */
const projectChangedNodes = new Map<string, Set<string>>();

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
  // 同时清除节点级变更追踪(push 成功后才调用,确保失败时变更记录不丢失)
  projectChangedNodes.delete(projectId);
  notifyDirtyChanged();
}

function isProjectDirty(projectId: string): boolean {
  return dirtyProjects.has(projectId);
}

// ===== 节点级变更追踪(FastArray DirtyMask) =====

/**
 * 标记指定项目的某个节点已变更。
 * 编辑器在节点增/删/改时调用,用于增量同步。
 */
export function markNodeDirty(projectId: string, nodeId: string): void {
  let set = projectChangedNodes.get(projectId);
  if (!set) {
    set = new Set();
    projectChangedNodes.set(projectId, set);
  }
  set.add(nodeId);
  markProjectDirty(projectId); // 项目级脏标记也必须设置
}

/**
 * 批量标记多个节点为已变更。
 * 批量粘贴/导入场景使用,避免逐个调用 markNodeDirty。
 */
export function markNodesDirty(projectId: string, nodeIds: string[]): void {
  let set = projectChangedNodes.get(projectId);
  if (!set) {
    set = new Set();
    projectChangedNodes.set(projectId, set);
  }
  for (const id of nodeIds) set.add(id);
  markProjectDirty(projectId);
}

/**
 * 获取指定项目自上次同步以来的变更节点 ID 列表。
 *
 * 重要:此函数【只读不消费】。变更记录在 push 成功后由 markProjectClean 统一清除,
 * 而非在此处删除。这样当 push 失败(429 限流 / 500 / 网络错误)时,
 * 变更记录仍保留,下次重试可继续增量推送,不会静默丢失数据。
 *
 * 副作用:调用后项目级 dirty 标记仍保留,直到 markProjectClean 成功。
 */
export function takeChangedNodeIds(projectId: string): string[] {
  const set = projectChangedNodes.get(projectId);
  if (!set) return [];
  return Array.from(set);
}

/**
 * 确认并清除变更记录(仅在 push 成功后调用)。
 * 等价于 markProjectClean 内部行为,供需要"清节点变更但保留项目 dirty"的场景使用。
 */
export function clearChangedNodes(projectId: string): void {
  projectChangedNodes.delete(projectId);
}

/** 获取变更节点数量(不清除,仅用于 UI 显示) */
export function getChangedNodeCount(projectId: string): number {
  return projectChangedNodes.get(projectId)?.size ?? 0;
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

// ===== 指数退避自动重试(429 限流 / 临时失败) =====

/**
 * 每个项目独立的退避重试调度器。
 * 当 push 因 429 限流或临时网络错误失败时,自动按指数退避重新推送,
 * 避免用户在"错误以为已同步"状态下丢失数据。
 *
 * 设计要点:
 * - 每个项目维护独立的 timer 与 attempt 计数,互不干扰
 * - 指数退避:2s → 4s → 8s → ... 上限 60s,最多 MAX_RETRIES 次
 * - 重试成功或达到上限后,清空该项目的调度状态
 * - 用户手动操作(onProjectUpdated)会 reset 退避计数,从 2s 重新开始
 */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttempts = new Map<string, number>();

const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_AUTO_RETRIES = 5;

/**
 * 调度一次自动重试。
 * @param projectId 项目 id
 * @param fn 重试时要执行的回调(通常为再次调用 syncProjectToCloud)
 */
export function scheduleAutoRetry(projectId: string, fn: () => Promise<void>): void {
  // 已有未完成的调度 → 直接跳过(避免重复调度)
  if (retryTimers.has(projectId)) return;

  const attempt = (retryAttempts.get(projectId) ?? 0) + 1;
  if (attempt > MAX_AUTO_RETRIES) {
    debugLog(`[sync] auto-retry exhausted for ${projectId} after ${MAX_AUTO_RETRIES} attempts. Manual sync required.`);
    retryAttempts.delete(projectId);
    return;
  }
  retryAttempts.set(projectId, attempt);

  // 指数退避:2s → 4s → 8s → 16s → 32s(封顶 60s)
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
  debugLog(`[sync] scheduling auto-retry #${attempt} for ${projectId} in ${delay}ms (rate-limit / transient failure)`);

  const timer = setTimeout(async () => {
    retryTimers.delete(projectId);
    try {
      await enqueuePush(projectId, fn);
      // 重试成功 → 清空调度状态
      retryAttempts.delete(projectId);
    } catch {
      // fn 内部处理失败,此处仅保留 attempts,等待下次调度
    }
  }, delay);
  retryTimers.set(projectId, timer);
}

/** 重置某项目的退避计数(用户在编辑器内再次操作时调用) */
export function resetAutoRetry(projectId: string): void {
  retryAttempts.delete(projectId);
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
