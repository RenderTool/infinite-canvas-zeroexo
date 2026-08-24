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
import { useCollaborationStore } from '@/features/collaboration/use-collaboration-store.js';

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

// ===== 合批自动重试(429 限流 / 临时失败 / 断网重连) =====

/**
 * 全局合批退避重试调度器。
 *
 * 旧实现:每个失败项目独立维护 timer + attempt,断网重连时 N 个项目各自退避重试,
 * 造成「大量堆积任务一个一个重连」,网络恢复瞬间产生请求风暴。
 *
 * 新实现:所有待重试项目收拢进一个全局批次,共享单个退避定时器:
 * - 网络连通后合批执行:一次性重试全部待推送项目(复用 enqueuePush 串行队列,不并发打爆)
 * - 网络离线时:不消耗重试次数,按固定探测间隔等待连通,连通后再合批提交
 * - 指数退避:2s → 4s → 8s → ... 上限 60s,最多 MAX_AUTO_RETRIES 次(仅对"在线但失败"累计)
 * - 用户手动操作(onProjectUpdated)重新标记 dirty,失败项目会重新进入批次
 */
const pendingRetryFns = new Map<string, () => Promise<void>>();
const pendingRetryDelays = new Map<string, number>();
let batchRetryTimer: ReturnType<typeof setTimeout> | null = null;
let batchRetryAttempt = 0;

const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_AUTO_RETRIES = 5;
/** 离线探测间隔:离线时按此间隔轮询,等待网络恢复(不累计重试次数) */
const OFFLINE_PROBE_INTERVAL_MS = 10_000;

/**
 * 调度一次自动重试(加入全局合批)。
 * @param projectId 项目 id
 * @param fn 重试时要执行的回调(通常为再次调用 syncProjectToCloud)
 * @param preferredDelaySec 服务端建议的等待秒数(429 的 Retry-After),无则按指数退避
 */
export function scheduleAutoRetry(
  projectId: string,
  fn: () => Promise<void>,
  preferredDelaySec?: number,
): void {
  pendingRetryFns.set(projectId, fn);
  if (typeof preferredDelaySec === 'number' && Number.isFinite(preferredDelaySec) && preferredDelaySec >= 0) {
    pendingRetryDelays.set(projectId, preferredDelaySec);
  }
  // 已有全局批次在排队 → 仅并入,不另开定时器
  if (batchRetryTimer) return;
  scheduleBatchRetry();
}

function scheduleBatchRetry(): void {
  // 网络离线:按固定间隔探测,等待连通后再合批(不消耗重试次数,避免高频重连)
  if (!isOnline()) {
    debugLog(`[sync] offline, probing network in ${OFFLINE_PROBE_INTERVAL_MS}ms (pending=${pendingRetryFns.size})`);
    batchRetryTimer = setTimeout(() => {
      batchRetryTimer = null;
      scheduleBatchRetry();
    }, OFFLINE_PROBE_INTERVAL_MS);
    return;
  }

  const attempt = batchRetryAttempt + 1;
  if (attempt > MAX_AUTO_RETRIES) {
    debugLog(`[sync] batch auto-retry exhausted after ${MAX_AUTO_RETRIES} attempts. Manual sync required.`);
    batchRetryAttempt = 0;
    pendingRetryFns.clear();
    pendingRetryDelays.clear();
    return;
  }
  batchRetryAttempt = attempt;

  // 延迟计算:
  // - 批次内所有项目的 Retry-After 取最大,并限制在 [BASE, MAX] 内
  // - 无提示时按指数退避:2s → 4s → 8s → 16s → 32s(封顶 60s)
  let maxPreferredDelay = 0;
  for (const sec of pendingRetryDelays.values()) {
    if (sec > maxPreferredDelay) maxPreferredDelay = sec;
  }
  const exponential = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
  let delay = exponential;
  if (maxPreferredDelay > 0) {
    delay = Math.min(
      Math.max(maxPreferredDelay * 1000, RETRY_BASE_DELAY_MS),
      RETRY_MAX_DELAY_MS,
    );
  }
  debugLog(`[sync] scheduling batch auto-retry #${attempt} for ${pendingRetryFns.size} project(s) in ${delay}ms (rate-limit / transient failure)`);

  batchRetryTimer = setTimeout(() => {
    batchRetryTimer = null;
    void runBatchRetry();
  }, delay);
}

/** 合批执行全部待重试任务(网络已连通) */
async function runBatchRetry(): Promise<void> {
  const tasks = Array.from(pendingRetryFns.entries());
  pendingRetryFns.clear();
  pendingRetryDelays.clear();

  for (const [projectId, fn] of tasks) {
    try {
      // enqueuePush 保证同一项目串行;合批提交,避免并发打爆
      await enqueuePush(projectId, fn);
      // 重试成功 → 无额外清理(脏标记由 markProjectClean 处理)
    } catch {
      // fn 内部处理失败(如 409/500),失败项目由 syncProjectToCloud 内部重新 scheduleAutoRetry
    }
  }

  // 批次执行完:若仍有项目失败并重新入队,已由新定时器接管;全部成功则清零重试计数
  if (pendingRetryFns.size === 0) {
    batchRetryAttempt = 0;
  }
}

/** 重置全局合批计数(网络恢复/手动操作时调用) */
export function resetAutoRetry(_projectId: string): void {
  // 合批模式下按项目重置意义不大:网络连通后批次自动清零;
  // 保留空实现以兼容旧调用方,避免破坏 exports 契约。
  void _projectId;
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
 * 冲突自动解决快照信息(替代弹窗:已保存云端快照,提示用户可跳转历史)。
 * direction 区分解决方向,提示条据此展示不同文案:
 * - local-active: 本地为活跃版本,云端备份为快照,本地覆盖云端
 * - local-stale:  本地为历史数据,本地旧图留档为快照,拉取云端覆盖本地
 */
export interface ConflictSnapshotInfo {
  projectId: string;
  title: string;
  cloudDeleted?: boolean;
  snapshotVersion?: number;
  /** 冲突解决方向(不传 = 兼容旧逻辑,默认按云端较新处理) */
  direction?: 'local-active' | 'local-stale';
}

const PROJECT_CONFLICT_SNAPSHOT_EVENT_NAME = 'zeroexo:project-conflict-snapshot';

/**
 * 通知「冲突已自动解决并保存云端快照」。
 * 云端版本较新或云端已删除时,系统自动按本地优先策略处理:
 * - 云端较新:先保存云端版本为快照(还原点),再推送本地覆盖
 * - 云端已删除:自动重新创建
 * 前端顶部提示条监听此事件,提示用户可点击跳转历史快照查看还原点。
 */
export function notifyConflictSnapshot(info: ConflictSnapshotInfo): void {
  debugLog(`[sync] notifyConflictSnapshot: projectId=${info.projectId}, cloudDeleted=${info.cloudDeleted}, snapshotVersion=${info.snapshotVersion}`);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PROJECT_CONFLICT_SNAPSHOT_EVENT_NAME, { detail: info }),
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

// ===== 协作活跃检测(Yjs 实时同步期间的 HTTP 推送抑制) =====

/**
 * 判断指定项目当前是否处于活跃协作状态。
 * 协作 active 期间由 Yjs CRDT 实时合并广播画布编辑,HTTP 全量推送(PATCH scene)
 * 只会引入 409 冲突与「重连瞬间本地旧图顶掉远端合并结果」的覆盖风险,
 * 因此 sync-service 在 onProjectUpdated 时抑制防抖推送,协作结束后推送自动恢复
 * (dirty 标记仍保留,合并后的最终状态会补推云端落库)。
 * @param projectId 项目 id(与协作房间 canvasId 对应)
 */
function isCollaborationActive(projectId: string): boolean {
  try {
    const s = useCollaborationStore.getState();
    return s.active && s.canvasId === projectId;
  } catch {
    return false;
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
  isCollaborationActive,
  markPendingDelete,
  clearPendingDelete,
  pendingDeleteCloudIds,
  enqueuePush,
  PROJECT_CONFLICT_EVENT_NAME,
  PROJECT_CONFLICT_SNAPSHOT_EVENT_NAME,
  debugLog,
  debugError,
  markProjectSynced,
};
