import {
  listProjects,
} from './project-store.js';
import {
  loadProjectGraph,
  deleteProjectGraph,
} from './graph-store.js';
import {
  cleanupUnusedImages,
  collectImageStorageKeys,
  deleteStoredImages,
} from './image-storage.js';
import {
  cleanupUnusedMedia,
  collectMediaStorageKeys,
  deleteStoredMedia,
} from './file-storage.js';

export async function cleanupProjectResources(projectId: string): Promise<void> {
  const graph = await loadProjectGraph(projectId);
  if (!graph) return;

  const imageKeys = collectImageStorageKeys(graph);
  const mediaKeys = collectMediaStorageKeys(graph);

  await deleteStoredImages(imageKeys);
  await deleteStoredMedia(mediaKeys);
  await deleteProjectGraph(projectId);
}

export async function cleanupProjectResourcesBatch(projectIds: string[]): Promise<void> {
  await Promise.all(projectIds.map((id) => cleanupProjectResources(id)));
}

export async function cleanupOrphanedResources(): Promise<{
  cleanedImages: number;
  cleanedMedia: number;
}> {
  const projects = await listProjects();
  const allUsedKeys = new Set<string>();

  for (const project of projects) {
    const graph = await loadProjectGraph(project.id);
    if (!graph) continue;

    collectImageStorageKeys(graph, allUsedKeys);
    collectMediaStorageKeys(graph, allUsedKeys);
  }

  await cleanupUnusedImages(allUsedKeys);
  await cleanupUnusedMedia(allUsedKeys);

  return { cleanedImages: 0, cleanedMedia: 0 };
}

export async function cleanupAllResources(): Promise<void> {
  const projects = await listProjects();
  const projectIds = projects.map((p) => p.id);
  await cleanupProjectResourcesBatch(projectIds);
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startPeriodicCleanup(intervalMinutes: number = 60): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }

  cleanupTimer = setInterval(async () => {
    try {
      await cleanupOrphanedResources();
    } catch (err) {
      console.error('[cleanup-service] periodic cleanup failed:', err);
    }
  }, intervalMinutes * 60 * 1000);
}

export function stopPeriodicCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/** 延迟回收防抖定时器 */
let deferredCleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 延迟回收:删除资源节点后调用,不立即物理删除底层媒体数据。
 * 等待 delayMs 后执行 cleanupOrphanedResources(基于"仍被 graph 引用"判断的 GC):
 * - 期间发生撤销 → 节点恢复,资源重新被 graph 引用 → GC 跳过 → 数据保留,节点正常显示
 * - 未撤销 → 资源不再被任何项目 graph 引用 → GC 物理回收,避免存储积压
 * 多次删除共享一个防抖窗口(最后一次删除后 delayMs 才执行),避免频繁全量扫描。
 * 仅作用于本地 image_files/media_files 分桶,不影响云端 resources/ 与版本快照。
 * @param delayMs 回收延迟(默认 30s,覆盖绝大多数删除-撤销场景)
 */
export function scheduleDeferredCleanup(delayMs: number = 30_000): void {
  if (deferredCleanupTimer) {
    clearTimeout(deferredCleanupTimer);
  }
  deferredCleanupTimer = setTimeout(async () => {
    deferredCleanupTimer = null;
    try {
      await cleanupOrphanedResources();
    } catch (err) {
      console.error('[cleanup-service] deferred cleanup failed:', err);
    }
  }, delayMs);
}