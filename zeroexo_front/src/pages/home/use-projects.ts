/**
 * useProjects - 画布项目列表状态管理(Phase D1.1)
 *
 * 封装 persistence 插件的 project-store API 为 React Hook,
 * 提供加载/创建/删除/重命名等操作,自动同步本地状态。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listProjects,
  createProject as storeCreate,
  copyProject as storeCopy,
  deleteProjects as storeDelete,
  renameProject as storeRename,
  cleanupProjectResourcesBatch,
} from '@zeroexo/plugin-persistence';
import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import {
  onProjectCreated,
  onProjectUpdated,
  onProjectDeleted,
  fullSync,
} from '@/services/sync/sync-service.js';
import { useSyncStatus } from '@/services/sync/sync-store.js';

export interface UseProjectsResult {
  projects: CanvasProjectMeta[];
  loading: boolean;
  error: string | null;
  createProject: (title?: string) => Promise<CanvasProjectMeta | null>;
  copyProject: (sourceId: string) => Promise<CanvasProjectMeta | null>;
  deleteProjects: (ids: string[]) => Promise<void>;
  renameProject: (id: string, title: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<CanvasProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 问题2: 订阅同步状态,同步完成后(lastSyncedAt 变化)自动刷新项目列表
  const { lastSyncedAt } = useSyncStatus();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const list = await listProjects();
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(
    async (title?: string): Promise<CanvasProjectMeta | null> => {
      try {
        const project = await storeCreate({ title });
        setProjects((prev) => {
          const next = [...prev, project];
          next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          return next;
        });
        // 触发云同步(防抖推送)
        onProjectCreated(project.id);
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project');
        return null;
      }
    },
    [],
  );

  const deleteProjects = useCallback(async (ids: string[]): Promise<void> => {
    try {
      // 先触发云端删除同步(失败不阻塞本地删除)
      // 网络/后端异常时仍需完成本地清理,避免项目残留无法操作
      for (const id of ids) {
        try {
          await onProjectDeleted(id, { skipLocalDelete: true });
        } catch (err) {
          console.warn(`[useProjects] cloud delete failed for ${id}:`, err);
        }
      }
      // 删除项目时同步清理关联的资源文件(图片/视频/音频)
      await cleanupProjectResourcesBatch(ids);
      await storeDelete(ids);
      setProjects((prev) => prev.filter((p) => !ids.includes(p.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete projects');
    }
  }, []);

  const renameProject = useCallback(async (id: string, title: string): Promise<void> => {
    try {
      const updated = await storeRename(id, title);
      if (updated) {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? updated : p)),
        );
        // 触发云同步(防抖推送)
        onProjectUpdated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename project');
    }
  }, []);

  const copyProject = useCallback(
    async (sourceId: string): Promise<CanvasProjectMeta | null> => {
      try {
        const project = await storeCopy(sourceId);
        if (project) {
          setProjects((prev) => {
            const next = [...prev, project];
            next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            return next;
          });
          // 触发云同步(防抖推送)
          onProjectCreated(project.id);
        }
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to copy project');
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 每次挂载时强制从云端全量同步
  useEffect(() => {
    void fullSync();
  }, []);

  // 同步完成后(lastSyncedAt 变化)自动刷新项目列表,
  // 解决登录后 fullSync 已写入 localforage 但主页未感知到新数据的问题。
  useEffect(() => {
    if (lastSyncedAt) {
      void refresh();
    }
  }, [lastSyncedAt, refresh]);

  return { projects, loading, error, createProject, copyProject, deleteProjects, renameProject, refresh };
}
