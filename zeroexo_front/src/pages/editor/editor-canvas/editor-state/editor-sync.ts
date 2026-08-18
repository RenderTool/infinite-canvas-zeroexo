/**
 * editor-sync - 云同步 + 冲突处理 + 会话管理
 *
 * 处理 initGraph(加载/初始化 graph)、SSE 事件监听、Yjs 远端同步、reloadGraph。
 * 闭包变量(isInitialized / suppressNextSync)通过 syncState 对象桥接。
 */

import type { GraphModel } from '@zeroexo/core';
import { updateProject, deleteProject, deleteProjectGraph, getProject } from '@zeroexo/plugin-persistence';
import { ApiError } from '@/services/api-client.js';
import i18n from '@/i18n/config';
import {
  onProjectUpdated,
  syncProjectFromCloud,
  checkProjectConflict,
  markProjectClean,
  syncProjectResourcesFromCloud,
} from '@/services/sync/sync-service.js';
import type { ProjectConflict } from '@/services/sync/sync-service.js';
import type { CanvasGraphPayload } from '@/shared/hooks/use-doc-sync.js';
import {
  PROJECT_RELOAD_EVENT,
  PROJECT_CONFLICT_EVENT,
  PROJECT_DIFF_EVENT,
  PROJECT_DELETED_EVENT,
} from '@/services/sync/broadcast-channel-service.js';
import type React from 'react';

export interface SyncState {
  isInitialized: boolean;
  suppressNextSync: boolean;
}

export interface SyncDeps {
  editor: {
    store: { getGraph: () => any; getViewport: () => any };
    plugins: {
      persistence: {
        load: () => Promise<any>;
        suppressNextSave: () => void;
      };
      history: { canUndo: () => boolean; canRedo: () => boolean };
    };
    core: { commandQueue: { replaceState: (state: any) => void } };
  };
  canvasId: string;
  message: { error: (msg: string) => void };
  pushGraph: (payload: CanvasGraphPayload) => void;
  subscribeRemote: (cb: (remote: CanvasGraphPayload) => void) => () => void;
  syncState: SyncState;
  setConflict: React.Dispatch<React.SetStateAction<ProjectConflict | null>>;
  setCloudUpdateAvailable: React.Dispatch<React.SetStateAction<boolean>>;
  reloadGraphRef: React.MutableRefObject<((graph: GraphModel) => void) | null>;
}

export function setupSync(deps: SyncDeps): () => void {
  const {
    editor,
    canvasId,
    message,
    subscribeRemote,
    syncState,
    setConflict,
    setCloudUpdateAvailable,
    reloadGraphRef,
  } = deps;

  const store = editor.store;
  const commandQueue = editor.core.commandQueue;

  // ===== initGraph: 异步加载已保存的 graph =====
  const initGraph = async (): Promise<void> => {
    // 会话抢占后刷新强制云端同步
    const forceCloudSync =
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem('zeroexo:force-cloud-sync') === 'true';
    if (forceCloudSync) {
      sessionStorage.removeItem('zeroexo:force-cloud-sync');
      console.log('[use-editor-state] force cloud sync on refresh, clearing local data');
      await deleteProjectGraph(canvasId).catch(() => {});
      await deleteProject(canvasId).catch(() => {});
      markProjectClean(canvasId);
    }

    try {
      await syncProjectFromCloud(canvasId, forceCloudSync);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        const local = await getProject(canvasId);
        if (local?.cloudId) {
          console.warn('[use-editor-state] project deleted on cloud, redirecting to home');
          await deleteProjectGraph(canvasId);
          await deleteProject(canvasId);
          window.location.href = '/';
          return;
        }
        if (!local) {
          console.warn('[use-editor-state] project not found locally or on cloud, redirecting to home');
          message.error(i18n.t('errors.PROJECT_NOT_FOUND'));
          window.location.hash = '#/canvas';
          return;
        }
        console.log('[use-editor-state] project not yet synced to cloud, loading from local cache');
      }
      console.warn('[use-editor-state] sync from cloud failed, fallback to local:', err);
    }

    // 刷新页面兜底:检测版本差异
    try {
      const detected = await checkProjectConflict(canvasId);
      if (detected) setConflict(detected);
    } catch (err) {
      console.warn('[use-editor-state] checkProjectConflict failed:', err);
    }

    const saved = await editor.plugins.persistence?.load();
    if (saved && saved.nodes.length > 0) {
      try {
        await syncProjectResourcesFromCloud(saved.nodes);
        onProjectUpdated(canvasId);
      } catch (err) {
        console.warn('[use-editor-state] resolve node resources failed:', err);
      }
      editor.plugins.persistence?.suppressNextSave();
      commandQueue.replaceState(saved);
    }

    syncState.isInitialized = true;

    // 自动聚焦:计算所有节点的 bounding box,居中适配到可视区域
    requestAnimationFrame(() => {
      const graph = store.getGraph();
      if (graph.nodes.length === 0) return;
      const rect = (document.querySelector('[data-canvas-viewport]') as HTMLElement | null)?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const node of graph.nodes) {
        const nx = node.position?.x ?? 0;
        const ny = node.position?.y ?? 0;
        const nw = node.size?.width ?? 200;
        const nh = node.size?.height ?? 80;
        if (nx < minX) minX = nx;
        if (ny < minY) minY = ny;
        if (nx + nw > maxX) maxX = nx + nw;
        if (ny + nh > maxY) maxY = ny + nh;
      }
      const contentW = maxX - minX;
      const contentH = maxY - minY;
      if (contentW <= 0 || contentH <= 0) return;
      const padding = 100;
      const scaleX = (rect.width - padding * 2) / contentW;
      const scaleY = (rect.height - padding * 2) / contentH;
      const k = Math.min(Math.max(Math.min(scaleX, scaleY), 0.05), 2);
      const x = (rect.width - contentW * k) / 2 - minX * k;
      const y = (rect.height - contentH * k) / 2 - minY * k;
      (store as any).setViewport({ x, y, k });
    });
  };
  void initGraph();

  // ===== 事件监听 =====

  // 监听云端 reload 事件
  const handleProjectReload = (e: Event): void => {
    const detail = (e as CustomEvent<{ projectId: string }>).detail;
    if (!detail || detail.projectId !== canvasId) return;
    if (!syncState.isInitialized) return;
    setCloudUpdateAvailable(false);
    void (async () => {
      const saved = await editor.plugins.persistence?.load();
      if (!saved) return;
      editor.plugins.persistence?.suppressNextSave();
      syncState.suppressNextSync = true;
      commandQueue.replaceState(saved);
    })();
  };
  window.addEventListener(PROJECT_RELOAD_EVENT, handleProjectReload);

  // 监听云端冲突事件 → 按"会话过期,请刷新"处理
  const handleProjectConflict = (e: Event): void => {
    const detail = (e as CustomEvent<ProjectConflict>).detail;
    console.log(`[sync] handleProjectConflict received: projectId=${detail?.projectId}, canvasId=${canvasId}, match=${detail?.projectId === canvasId}`);
    if (!detail || detail.projectId !== canvasId) return;
    console.log(`[sync] >> treating PROJECT_CONFLICT_EVENT as conflict for ${detail.projectId}`);
    setConflict({
      projectId: canvasId,
      title: detail.title ?? '',
      localVersion: detail.localVersion ?? 0,
      cloudVersion: detail.cloudVersion ?? 0,
      localUpdatedAt: detail.localUpdatedAt ?? '',
      cloudUpdatedAt: detail.cloudUpdatedAt ?? '',
      localNodeCount: detail.localNodeCount ?? 0,
      cloudNodeCount: detail.cloudNodeCount ?? 0,
      hasLocalChanges: detail.hasLocalChanges ?? false,
      cloudDeleted: detail.cloudDeleted ?? false,
    });
  };
  window.addEventListener(PROJECT_CONFLICT_EVENT, handleProjectConflict);

  // 监听云端版本差异事件 → 显示同步按钮红点徽标
  const handleProjectDiff = (e: Event): void => {
    const detail = (e as CustomEvent<{ projectId: string }>).detail;
    if (!detail || detail.projectId !== canvasId) return;
    setCloudUpdateAvailable(true);
  };
  window.addEventListener(PROJECT_DIFF_EVENT, handleProjectDiff);

  // 监听项目删除事件 → 返回首页
  const handleProjectDeleted = (e: Event): void => {
    const detail = (e as CustomEvent<{ projectId: string }>).detail;
    if (!detail || detail.projectId !== canvasId) return;
    window.location.href = '/';
  };
  window.addEventListener(PROJECT_DELETED_EVENT, handleProjectDeleted);

  // ===== Yjs 远端同步 =====
  let unsubRemote: (() => void) | undefined;
  unsubRemote = subscribeRemote((remote: CanvasGraphPayload) => {
    if (!syncState.isInitialized) return;
    syncState.suppressNextSync = true;
    editor.plugins.persistence?.suppressNextSave();
    commandQueue.replaceState({
      nodes: (remote.nodes ?? []) as GraphModel['nodes'],
      edges: (remote.edges ?? []) as GraphModel['edges'],
      viewport: store.getViewport(),
      metadata: (remote.metadata as GraphModel['metadata']) ?? {},
    });
  });

  // ===== reloadGraph =====
  reloadGraphRef.current = (graph: GraphModel): void => {
    console.log(`[reloadGraph] replacing state with ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    editor.plugins.persistence?.suppressNextSave();
    syncState.suppressNextSync = true;
    commandQueue.replaceState(graph);
    setCloudUpdateAvailable(false);
    console.log('[reloadGraph] replaceState called, state updated');
  };

  // ===== 返回清理函数 =====
  return () => {
    reloadGraphRef.current = null;
    const graph = store.getGraph();
    void updateProject(canvasId, { nodeCount: graph.nodes.length });
    onProjectUpdated(canvasId);
    window.removeEventListener(PROJECT_RELOAD_EVENT, handleProjectReload);
    window.removeEventListener(PROJECT_CONFLICT_EVENT, handleProjectConflict);
    window.removeEventListener(PROJECT_DIFF_EVENT, handleProjectDiff);
    window.removeEventListener(PROJECT_DELETED_EVENT, handleProjectDeleted);
    unsubRemote?.();
  };
}