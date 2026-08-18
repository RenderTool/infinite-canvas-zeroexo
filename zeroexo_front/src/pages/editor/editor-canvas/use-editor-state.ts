// TODO(拆分): 该文件超过 1000 行，计划按「状态层/交互层/渲染层」拆分，见 DESIGN.md
/**
 * useEditorState - 编辑器页面状态管理
 *
 * 集中管理 editor 实例 + UI 状态 + 与 plugin 的交互,
 * 让 EditorPage 只做装配,保持 ≤200 行。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App } from 'antd';
import type { NodeTypeExtension, NodeRecord } from '@zeroexo/core';
import { AddNodeCommand, RemoveNodeCommand, BatchCommand } from '@zeroexo/core';
import { createDefaultEditor } from '@zeroexo/preset-default';
import type { DefaultEditor } from '@zeroexo/preset-default';
import { getDescendantIds, getLeafDescendants, ReplaceSceneCommand } from '@zeroexo/plugin-group';
import type { GroupPinExpander } from '@zeroexo/plugin-connection';
import { updateProject } from '@zeroexo/plugin-persistence';
import { ProxyProvider } from '@zeroexo/plugin-ai-provider';
import type { AIProvider } from '@zeroexo/plugin-ai-provider';
import { apiFetch, ApiError } from '@/services/api-client.js';
import i18n from '@/i18n/config';
import { onProjectUpdated, syncProjectFromCloud, markProjectDirty, markProjectClean, checkProjectConflict, forcePullProjectFromCloud, forcePushLocalToCloud, repushLocalAsNewCloud, syncProjectResourcesFromCloud, syncProjectResourcesToCloud } from '@/services/sync/sync-service.js';
import { markNodesDirty, debugLog } from '@/services/sync/sync-utils.js';
import type { ProjectConflict } from '@/services/sync/sync-service.js';
import { useCanvasSync } from '@/shared/hooks/use-doc-sync.js';
import type { CanvasGraphPayload } from '@/shared/hooks/use-doc-sync.js';
import { useCollaboration } from '@/features/collaboration/use-collaboration.js';
import type { AwarenessState } from '@/features/collaboration/collaboration-types.js';
import { createCreationExtensions } from '@/features/canvas-nodes/extensions.js';
import { canConnect } from '@/shared/connection-rules.js';
import { PROJECT_RELOAD_EVENT, PROJECT_DIFF_EVENT, PROJECT_DELETED_EVENT, PROJECT_CONFLICT_EVENT } from '@/services/sync/broadcast-channel-service.js';
import { collectImageStorageKeys, getProject, loadProjectGraph, scheduleDeferredCleanup } from '@zeroexo/plugin-persistence';
import type { GraphModel } from '@zeroexo/core';

export type InteractionMode = 'select' | 'pan';

/** 画布支持的节点类型(资产节点 + 剧创节点 + 堆叠节点) */
export type EditorNodeType = 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media' | 'script' | 'storyboard' | 'workbench';

/**
 * 收集节点列表中的视频/音频 storageKey(用于删除时清理本地媒体文件与视频缩略图)。
 * 仅取节点顶层 data.storageKey(主媒体),不含图片参考帧(image: 前缀由 collectImageStorageKeys 处理)。
 * 注意: resources/ 前缀为云端资源,不属于本地 media_files 分桶,只清理其本地视频缩略图缓存。
 */
function collectVideoAudioStorageKeys(nodes: NodeRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'video' && node.type !== 'audio') continue;
    const sk = (node.data as { storageKey?: unknown } | null)?.storageKey;
    if (typeof sk === 'string' && sk) keys.add(sk);
  }
  return keys;
}

export interface EditorState {
  editor: DefaultEditor | null;
  /** 画布数据是否正在加载(首次加载或初次创建时 true,数据就绪后 false) */
  loading: boolean;
  extensions: Map<string, NodeTypeExtension>;
  canUndo: boolean;
  canRedo: boolean;
  interactionMode: InteractionMode;
  scale: number;
  selectedCount: number;
  selectedNodeId: string | null;
  selectedNodeType: EditorNodeType | null;
  /** 选中集中是否含组节点(用于"解组"按钮可用态) */
  selectedHasGroup: boolean;
  /** 单选且选中节点(含子组)有父组(用于"移出组"按钮可用态) */
  selectedInGroup: boolean;
  /** 选中集是否混合(同时含组节点和非组节点,用于屏蔽层级聚合) */
  isMixedSelection: boolean;
  /** 是否处于组预览态(选中 ≥2 节点产生预览组,Detail 面板需显示预览组工具) */
  isGroupPreviewing: boolean;
  containerSize: { width: number; height: number };
  /** graph 发生变更时,在 onChanged 中同步计算并缓存的选中节点数据(避免通过 graphVersion 驱动 useMemo 导致无限循环) */
  selectedNodeData: Record<string, unknown> | null;
}

export interface EditorActions {
  addNode: (type: EditorNodeType) => void;
  deleteSelected: () => void;
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
  toggleInteractionMode: () => void;
  setScale: (scale: number) => void;
  resetView: () => void;
  /** 成组:选中 ≥2 节点 → 创建预览 → 立即确认(等效 Ctrl+G 二段式) */
  groupSelected: () => void;
  /** 解组:选中含组节点 → 拆散(等效选中组后 Delete) */
  ungroupSelected: () => void;
}

/** 稳定引用(editor 实例的 controller/plugin,不触发重渲染) */
export interface EditorRefs {
  store: DefaultEditor['store'] | null;
  commandQueue: DefaultEditor['core']['commandQueue'] | null;
  interactionController: ReturnType<DefaultEditor['plugins']['interaction']['getController']> | null;
  connectionController: ReturnType<DefaultEditor['plugins']['connection']['getController']> | null;
  selectionController: ReturnType<DefaultEditor['plugins']['selection']['getController']> | null;
  layoutController: ReturnType<DefaultEditor['plugins']['layout']['getController']> | null;
  nodesPlugin: DefaultEditor['plugins']['nodes'] | null;
  groupPlugin: DefaultEditor['plugins']['group'] | null;
  /** AI Provider 引用(P3.4: PromptPanel onGenerate 通过此调用生成) */
  aiProvider: AIProvider | null;
  /** 右键菜单控制器(占位:实际菜单由 editor-page 的 contextMenuItems 渲染,此处保留空实现兼容引用) */
  contextMenuController: {
    openAt: (x: number, y: number, opts: { type: string; edgeId?: string; nodeId?: string; worldPosition?: { x: number; y: number } }) => void;
  } | null;
}

export function useEditorState(canvasId: string): {
  state: EditorState;
  actions: EditorActions;
  refs: EditorRefs;
  containerRef: React.RefObject<HTMLDivElement>;
  reloadGraph: (graph: GraphModel) => void;
  cloudUpdateAvailable: boolean;
  clearCloudUpdateAvailable: () => void;
  conflict: ProjectConflict | null;
  onPullCloud: () => void;
  onPushLocal: () => void;
  onConflictClose: () => void;
  collaboration: ReturnType<typeof useCollaboration> | null;
  awarenessStates: Map<number, AwarenessState>;
  collaborationActive: boolean;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const { message } = App.useApp();
  // 挂载状态引用:initGraph 在每个 await 后检查此值,若为 false 则立即退出
  // 防止组件卸载后的异步操作继续执行并修改已销毁的编辑器实例
  const isMountedRef = useRef(false);
  // Yjs 画布实时同步（多端合并广播；持久化仍由 HTTP sync-service 负责）
  const canvasSync = useCanvasSync(canvasId);
  const { pushGraph, subscribeRemote } = canvasSync;
  // 协作系统（auto-join + Awareness 光标同步 + 成员管理）
  const collaboration = useCollaboration(canvasId, canvasSync);
  // tRef: 保存最新 t 供 useEffect 内部使用(避免把 t 加入 useEffect 依赖导致 editor 重建)
  const tRef = useRef(t);
  tRef.current = t;
  const [editor, setEditor] = useState<DefaultEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('select');
  const [scale, setScaleState] = useState(1);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<EditorNodeType | null>(null);
  const [selectedHasGroup, setSelectedHasGroup] = useState(false);
  const [selectedInGroup, setSelectedInGroup] = useState(false);
  const [isMixedSelection, setIsMixedSelection] = useState(false);
  const [isGroupPreviewing, setIsGroupPreviewing] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedNodeData, setSelectedNodeData] = useState<Record<string, unknown> | null>(null);
  /**
   * 云端有更新提示(本地无修改 + 云端有新版本时由 SSE PROJECT_DIFF_EVENT 触发)
   * 编辑器在同步按钮上显示红点徽标,用户点击同步显式拉取后清除
   * 非侵入式:不自动拉取(避免突然改变画布)
   */
  const [cloudUpdateAvailable, setCloudUpdateAvailable] = useState(false);
  /**
   * 同步冲突:云端版本与本地版本不一致(或云端已删除)时由 PROJECT_CONFLICT_EVENT 触发。
   * 由 SyncConflictDialog 展示,用户选择"拉取云端"或"推送本地"。
   */
  const [conflict, setConflict] = useState<ProjectConflict | null>(null);
  /**
   * reloadGraph 函数 ref:冲突解决"拉取云端"后,用云端 graph 替换当前编辑器 graph
   * 通过 ref 暴露 useEffect 内部的闭包(需访问 suppressNextSync 标志避免拉取-推送循环)
   */
  const reloadGraphRef = useRef<((graph: GraphModel) => void) | null>(null);
  const extensions = useMemo<Map<string, NodeTypeExtension>>(() => {
    if (!editor) return new Map();
    return new Map(editor.plugins.nodes.all().map((e) => [e.type, e]));
  }, [editor]);

  useEffect(() => {
    if (!containerRef.current) return;
    // P3.4: 注入 ProxyProvider,所有 AI 生成请求经后端 /api/ai/generate 代理
    // apiFetch 自动携带 JWT Authorization + 401 自动刷新
    const aiProvider = new ProxyProvider(apiFetch, () => i18n.language);
    const ed = createDefaultEditor({
      container: containerRef.current,
      storageKey: 'zeroexo:graph',
      aiProvider,
    });
    const { commandQueue } = ed.core;
    const store = ed.store;
    const { history } = ed.plugins;

    // 设置项目 ID(per-project graph 存储:key = zeroexo:graph:{canvasId})
    ed.plugins.persistence?.setProjectId(canvasId);

    // Phase 2: 注册剧创节点(剧本/分镜/出片)到 nodes 插件
    // 阶段页位于 app 层,故在 app 层注册扩展(插件包内无法引用 src/)
    ed.plugins.nodes.registerAll(
      createCreationExtensions(
        ed.plugins.connection?.getController() ?? null,
        () => ed.store,
      ),
    );

    // Phase 2.5: 注入节点类型扩展访问器到连线控制器
    const nodeRegistry = ed.core.plugins.get<any>('node-registry');
    const connectionController = ed.plugins.connection?.getController();
    if (nodeRegistry && connectionController) {
      connectionController.setExtensionAccessor((nodeId: string) => {
        const node = ed.store.getGraph().nodes.find((n: any) => n.id === nodeId);
        if (!node) return undefined;
        return nodeRegistry.get(node.type);
      });
    }

    // 注入统一节点类型兼容性检查器(连线约束矩阵,与 ConnectionDropMenu 共用)
    if (connectionController) {
      connectionController.setCompatibilityChecker(canConnect);
    }

    // 追踪容器尺寸(for MinimapView viewportSize)
    const updateSize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setContainerSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);

    // 异步加载已保存的 graph;若无保存数据则创建欢迎节点
    // isInitialized:加载完成前 graph 变化不触发云同步(避免加载时误推)
    let isInitialized = false;
    // suppressNextSync:从云端拉取并 replaceState 后,跳过下一次 onProjectUpdated
    // 防止"拉取-推送"循环(SSE 拉取新版本 → replaceState → onChanged → 推送 → version 无限递增)
    let suppressNextSync = false;

    isMountedRef.current = true;

    const initGraph = async (): Promise<void> => {
      try {
        if (!isMountedRef.current) return;

        // 步骤1:从云端拉取项目元数据(非破坏性:仅在云端版本更高时才写入 localforage)
        try {
          await syncProjectFromCloud(canvasId, false);
        } catch (err) {
          // 404 处理:项目从未同步到云端(新项目)或已被删除
          if (err instanceof ApiError && err.status === 404) {
            const local = await getProject(canvasId);
            if (local?.cloudId) {
              // 项目曾在云端但被删除 → 弹窗让用户选择"推送本地重新创建"或"取消"
              // 不再直接删除本地数据,而是通过 SyncConflictDialog 让用户决定
              if (!isMountedRef.current) return;
              setConflict({
                projectId: canvasId,
                title: local.title,
                localVersion: local.version ?? 0,
                cloudVersion: 0,
                localUpdatedAt: local.updatedAt,
                cloudUpdatedAt: '',
                localNodeCount: 0,
                cloudNodeCount: 0,
                hasLocalChanges: true,
                cloudDeleted: true,
              });
              // 不再 return,允许继续加载本地数据
            } else if (!local) {
              // 本地与云端均无 → 项目不存在
              message.error(i18n.t('errors.PROJECT_NOT_FOUND'));
              window.location.hash = '#/canvas';
              return;
            }
          }
          // 其他错误:忽略,继续用本地数据
        }

        if (!isMountedRef.current) return;

        // 步骤2:从 localforage 加载 graph
        const saved = await ed.plugins.persistence?.load();
        if (!isMountedRef.current) return;

        if (saved && saved.nodes.length > 0) {
          // 重建 blob URL
          try {
            await syncProjectResourcesFromCloud(saved.nodes);
            if (!isMountedRef.current) return;
            onProjectUpdated(canvasId);
          } catch (err) {
            console.warn('[use-editor-state] resolve node resources failed:', err);
          }
          ed.plugins.persistence?.suppressNextSave();
          commandQueue.replaceState(saved);
        } else {
          // 本地数据为空:尝试从云端拉取(仅在云端版本更高时才写入,非破坏性)
          // 覆盖快速返回导致 localforage 数据丢失的场景
          try {
            await syncProjectFromCloud(canvasId, false);
            if (!isMountedRef.current) return;
            const retry = await ed.plugins.persistence?.load();
            if (retry && retry.nodes.length > 0) {
              await syncProjectResourcesFromCloud(retry.nodes);
              if (!isMountedRef.current) return;
              onProjectUpdated(canvasId);
              ed.plugins.persistence?.suppressNextSave();
              commandQueue.replaceState(retry);
            }
          } catch {
            // 云端也无数据,保持空画布
          }
        }

        if (!isMountedRef.current) return;

        // 刷新页面兜底:检测版本差异,若有冲突弹出 SyncConflictDialog
        try {
          const detected = await checkProjectConflict(canvasId);
          if (!isMountedRef.current) return;
          if (detected) setConflict(detected);
        } catch (err) {
          console.warn('[use-editor-state] checkProjectConflict failed:', err);
        }

        isInitialized = true;

        // 自动聚焦
        const graph = store.getGraph();
        if (graph.nodes.length > 0) {
          requestAnimationFrame(() => {
            const g = store.getGraph();
            if (g.nodes.length === 0) return;
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const node of g.nodes) {
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
            store.setViewport({ x, y, k });
          });
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };
    void initGraph();

    // 监听云端 reload 事件:其他客户端推送了新版本,SSE 拉取并写入 localforage 后,
    // 若当前编辑器正在显示该项目,则重新加载 graph(覆盖本地未修改的旧版本)
    // 注意:mergeCloudProjectToLocal 仅在 cloud.version > local.version 时写入,
    // 所以本地有未同步的修改时不会被覆盖
    // 注意:若会话已被抢占,忽略 reload 事件
    const handleProjectReload = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (!detail || detail.projectId !== canvasId) return;
      if (!isInitialized) return;
      // reload 触发时,云端更新已被消费,清除红点徽标
      setCloudUpdateAvailable(false);
      void (async () => {
        const saved = await ed.plugins.persistence?.load();
        if (!saved) return;
        // suppressNextSave 防止 replaceState 触发 persistence 写回(刚读出来的数据无需回写)
        ed.plugins.persistence?.suppressNextSave();
        // suppressNextSync 防止 replaceState 触发 onProjectUpdated(避免拉取-推送循环)
        suppressNextSync = true;
        commandQueue.replaceState(saved);
      })();
    };
    window.addEventListener(PROJECT_RELOAD_EVENT, handleProjectReload);

    // 监听云端版本差异事件:云端有新版本 + 本地无修改 → 显示同步按钮红点徽标
    // 非侵入式:不自动拉取(避免突然改变画布),由用户点击同步按钮显式拉取
    const handleProjectDiff = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (!detail || detail.projectId !== canvasId) return;
      setCloudUpdateAvailable(true);
    };
    window.addEventListener(PROJECT_DIFF_EVENT, handleProjectDiff);

    // 监听项目删除事件:另一标签页/设备删除了当前项目 → 返回首页
    const handleProjectDeleted = (e: Event): void => {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;
      if (!detail || detail.projectId !== canvasId) return;
      window.location.href = '/';
    };
    window.addEventListener(PROJECT_DELETED_EVENT, handleProjectDeleted);

    // 监听云端冲突事件:版本不一致或云端已删除时弹出 SyncConflictDialog
    const handleProjectConflict = (e: Event): void => {
      const detail = (e as CustomEvent<ProjectConflict>).detail;
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

    // 会话被抢占事件已废弃 — Yjs 实时协作允许多标签页共存

    // 注入节点尺寸访问器给 group / layout 插件
    // group: 组 bounds 计算(取 node.size > defaultSize > {200,80})
    // layout: 基准尺寸恢复(需携带 defaultSize/lockAspectRatio/resizable 元信息,
    //         否则 unifyNodeSizes 因无 defaultSize 全部跳过,基准尺寸不生效)
    const extMap = new Map(ed.plugins.nodes.all().map((e) => [e.type, e]));
    const getNodeSize = (node: NodeRecord): {
      width: number;
      height: number;
      defaultSize?: { width: number; height: number };
      lockAspectRatio?: boolean;
      resizable?: boolean;
    } => {
      const ext = extMap.get(node.type);
      const size = node.size ?? ext?.defaultSize ?? { width: 200, height: 80 };
      return {
        width: size.width,
        height: size.height,
        defaultSize: ext?.defaultSize,
        lockAspectRatio: ext?.lockAspectRatio,
        resizable: ext?.resizable,
      };
    };
    ed.plugins.group?.getController().setNodeSizeAccessor(getNodeSize);
    ed.plugins.layout?.getController().setNodeSizeAccessor(getNodeSize);
    // 特化外观节点判定器:豁免基准尺寸等全局尺寸操作(保留 LOD/位置类操作)
    ed.plugins.layout?.getController().setSpecialTypeAccessor(
      (type: string) => !!extMap.get(type)?.specialAppearance,
    );

    // 订阅 GroupController 状态变化(预览态切换时触发重渲染,Detail 面板需显示预览组工具)
    const groupCtrl = ed.plugins.group?.getController();
    let unsubGroup: (() => void) | undefined;
    if (groupCtrl) {
      const onGroupChanged = () => setIsGroupPreviewing(groupCtrl.isPreviewing());
      onGroupChanged();
      unsubGroup = groupCtrl.subscribe(onGroupChanged);
    }

    // 监听 graph + selection 变化更新 UI 状态
    let prevSelectedNodeId: string | null = null;
    /** 更新 UI 状态的公共逻辑（graph 和 selection 共享） */
    const updateUIState = (): void => {
      setCanUndo(history.canUndo());
      setCanRedo(history.canRedo());
      const graph = store.getGraph();
      const selection = store.getSelection();
      setSelectedCount(selection.selectedNodeIds.size);
      // 选中集中是否含组节点(type === 'group') / 是否混合(组+非组)
      let hasGroup = false;
      let hasNonGroup = false;
      if (selection.selectedNodeIds.size > 0) {
        for (const id of selection.selectedNodeIds) {
          const node = graph.nodes.find((n: NodeRecord) => n.id === id);
          if (node?.type === 'group') {
            hasGroup = true;
          } else {
            hasNonGroup = true;
          }
        }
      }
      setSelectedHasGroup(hasGroup);
      // 混合选中:同时含组节点和非组节点(层级排序语义冲突,屏蔽层级聚合)
      setIsMixedSelection(hasGroup && hasNonGroup);
      if (selection.selectedNodeIds.size === 1) {
        const id = selection.selectedNodeIds.values().next().value;
        if (id) {
          const node = graph.nodes.find((n: NodeRecord) => n.id === id);
          setSelectedNodeId(id);
          setSelectedNodeType(
            node?.type === 'text'
              ? 'text'
              : node?.type === 'image'
                ? 'image'
                : node?.type === 'video'
                  ? 'video'
                  : node?.type === 'audio'
                    ? 'audio'
                    : node?.type === 'generator'
                      ? 'generator'
                      : node?.type === 'stacked-media'
                        ? 'stacked-media'
                        : node?.type === 'script'
                          ? 'script'
                          : node?.type === 'storyboard'
                            ? 'storyboard'
                            : node?.type === 'workbench'
                              ? 'workbench'
                              : null,
          );
          // 直接在 updateUIState 中计算选中节点数据,避免通过 graphVersion 驱动 useMemo 导致无限循环
          const data = node?.data;
          setSelectedNodeData(data && typeof data === 'object' ? (data as Record<string, unknown>) : null);
          // 单选且有父组 → "移出组"按钮可用
          setSelectedInGroup(!!node?.parentId);
          prevSelectedNodeId = id;
        }
      } else {
        setSelectedNodeId(null);
        setSelectedNodeType(null);
        setSelectedInGroup(false);
        if (prevSelectedNodeId !== null) {
          setSelectedNodeData(null);
          prevSelectedNodeId = null;
        }
      }
    };
    // 上一帧的节点内容指纹(用于 FastArray 式增量同步)。
    // 对每个节点单独计算轻量指纹,从而捕获"新增/删除/内容或位置修改"三类变更。
    // 相比全图 JSON 序列化,这里仅序列化关键字段,且截断大字符串(如 base64 图片),
    // 避免 500+ 节点下全量序列化大二进制造成卡顿。
    let prevNodeFingerprints = new Map<string, string>();
    const fingerprintReplacer = (_k: string, v: unknown): unknown => {
      // 截断超长字符串(如 base64 图片/音频数据),避免生成巨大指纹字符串
      if (typeof v === 'string' && v.length > 256) {
        return `${v.slice(0, 256)}…${v.length}`;
      }
      return v;
    };
    const nodeFingerprint = (n: unknown): string => {
      try {
        // 只对发生变化的字段序列化;大字符串被截断,开销可控
        return JSON.stringify(n, fingerprintReplacer);
      } catch {
        return (n as { id?: string }).id ?? 'unknown';
      }
    };

    /** graph 变更时：更新 UI + 先上传资源到云端再用 cloud key 推送 Yjs + 云同步 */
    const onGraphChanged = () => {
      updateUIState();
      if (isInitialized && !suppressNextSync) {
        const graph = store.getGraph();
        const nodes = graph.nodes;

        // ==== FastArray 增量同步:diff 前后节点指纹,标记新增/删除/修改的节点 ====
        const changedIds: string[] = [];
        const curFingerprints = new Map<string, string>();
        for (const n of nodes) {
          const id = (n as { id: string }).id;
          curFingerprints.set(id, nodeFingerprint(n));
        }

        if (prevNodeFingerprints.size > 0) {
          for (const id of curFingerprints.keys()) {
            // 新增节点
            if (!prevNodeFingerprints.has(id)) changedIds.push(id);
            // 已存在但内容/位置变化
            else if (prevNodeFingerprints.get(id) !== curFingerprints.get(id)) changedIds.push(id);
          }
          // 已删除节点(记录为 "__deleted__" 由 sync-projects 处理)
          for (const id of prevNodeFingerprints.keys()) {
            if (!curFingerprints.has(id)) changedIds.push(id);
          }
        }
        // 首次(prevNodeFingerprints 为空)不标记,避免首次加载触发全量误标
        prevNodeFingerprints = curFingerprints;
        if (changedIds.length > 0) {
          markNodesDirty(canvasId, changedIds);
          if (changedIds.length <= 20) {
            debugLog(`[canvas] incremental dirty: +${changedIds.length} nodes`, changedIds);
          }
        }

        // 先上传本地资源(图片/视频/音频)到云端,将 storageKey 替换为 cloud key,
        // 再通过 Yjs 广播,避免其他浏览器收到 local storageKey 后找不到 blob。
        // 使用 fire-and-forget 避免阻塞 UI,资源上传完成后才推送 Yjs。
        (async () => {
          try {
            await syncProjectResourcesToCloud(nodes);
          } catch {
            // 资源上传失败不影响后续推送(带 local storageKey 总比不推送好)
          }
          pushGraph({ nodes: store.getGraph().nodes, edges: store.getGraph().edges });
        })();

        // 拖拽节点/resize 期间不推送云同步(避免每帧 rawFetch 消耗性能)
        // 拖拽结束后的 pointerup 会触发一次完整推送
        const trans = ic.getTransient();
        if (!trans.draggingNode && !trans.resizing) {
          onProjectUpdated(canvasId);
          // 标记项目有未推送修改
          markProjectDirty(canvasId);
        }
      }
      suppressNextSync = false;
    };
    /** selection 变更时：仅更新 UI，不推送 Yjs（避免 pushGraph → Yjs update → replaceState 递归） */
    const onSelectionChanged = () => {
      updateUIState();
    };
    const unsubGraph = store.subscribeGraph(onGraphChanged);
    const unsubSelection = store.subscribeSelection(onSelectionChanged);
    onGraphChanged();

    // 订阅 Yjs 远端 graph 变化 → replaceState 到 store(实时多端同步,不触发 HTTP 推送回环)
    // 本地 push 产生的 update 由 useCanvasSync 内部的 localPushRef 过滤,不会走到这里
    let unsubRemote: (() => void) | undefined;
    unsubRemote = subscribeRemote((remote: CanvasGraphPayload) => {
      if (!isInitialized) return;
      // suppressNextSync 防止 replaceState 触发 onChanged → pushGraph 回环
      suppressNextSync = true;
      ed.plugins.persistence?.suppressNextSave();
      commandQueue.replaceState({
        nodes: (remote.nodes ?? []) as GraphModel['nodes'],
        edges: (remote.edges ?? []) as GraphModel['edges'],
        viewport: store.getViewport(),
        metadata: (remote.metadata as GraphModel['metadata']) ?? {},
      });
    });

    // 监听 viewport 变化
    const onViewportChanged = () => {
      setScaleState(store.getViewport().k);
    };
    const unsubViewport = store.subscribeViewport(onViewportChanged);

    // ===== 全局事件监听 =====
    // pointermove/up 挂 window:拖拽中指针离开容器仍能追踪
    const ic = ed.plugins.interaction.getController();
    const cc = ed.plugins.connection.getController();

    // 注入组 pin 展开器(组 pin 批量连线:拖组 pin 等效于组内所有叶子节点 pin 批量连线)
    // getLeafDescendants 跳过嵌套组,只返回非 group 叶子节点
    const groupPinExpander: GroupPinExpander = (groupId, direction) => {
      const scene = store.getGraph().nodes;
      const leaves = getLeafDescendants(scene, groupId);
      const endpoints: Array<{ nodeId: string; pinId: string; direction: 'input' | 'output' }> = [];
      for (const leaf of leaves) {
        const leafExt = extMap.get(leaf.type);
        const pins = leafExt?.getPins?.(leaf) ?? [];
        for (const pin of pins) {
          if (pin.direction === direction) {
            endpoints.push({ nodeId: leaf.id, pinId: pin.id, direction });
          }
        }
      }
      return endpoints;
    };
    cc.setGroupPinExpander(groupPinExpander);
    const onPointerMove = (e: PointerEvent) => {
      ic.handlePointerMove(e);
      cc.handlePointerMove(e);
      // 协作:广播光标位置/视口/选中态到远端 Awareness
      // 统一通过 collaboration.setLocalCursor 写入 'cursor-data' key(与订阅端一致)
      if (collaboration.active) {
        const rect = containerRef.current?.getBoundingClientRect();
        const vp = store.getViewport();
        if (rect) {
          const worldX = (e.clientX - rect.left - vp.x) / vp.k;
          const worldY = (e.clientY - rect.top - vp.y) / vp.k;
          const selection = store.getSelection();
          collaboration.setLocalCursor(
            { x: worldX, y: worldY },
            { x: vp.x, y: vp.y, width: rect.width, height: rect.height, scale: vp.k },
            Array.from(selection.selectedNodeIds),
          );
        }
      }
    };
    const onPointerUp = () => {
      // 读取拖拽状态(必须在 handlePointerUp 之前,因为 handlePointerUp 会清除拖拽状态)
      const trans = ic.getTransient();
      const wasDraggingNode = trans.draggingNode;
      const wasResizing = trans.resizing;
      ic.handlePointerUp();
      cc.handlePointerUp();
      ed.plugins.history.breakMergeChain();
      // 拖拽/resize 结束后触发一次云同步推送(避免拖拽期间每帧 rawFetch)
      if (isInitialized && !suppressNextSync && (wasDraggingNode || wasResizing)) {
        onProjectUpdated(canvasId);
        markProjectDirty(canvasId);
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // wheel 挂容器(非 passive,允许 preventDefault 阻止页面缩放)
    const onWheel = (e: WheelEvent) => {
      ic.handleWheel(e);
    };
    containerRef.current?.addEventListener('wheel', onWheel, { passive: false });

    // 移动端二指缩放(pinch zoom)+ 二指平移
    // 复用 wheel 缩放逻辑:以两指中心点为缩放中心,距离变化为缩放因子
    let pinchState: {
      distance: number;
      centerX: number;
      centerY: number;
      startK: number;
      startX: number;
      startY: number;
    } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t1 = e.touches[0]!;
        const t2 = e.touches[1]!;
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const vp = store.getViewport();
        pinchState = {
          distance: Math.hypot(dx, dy),
          centerX: ((t1.clientX + t2.clientX) / 2) - rect.left,
          centerY: ((t1.clientY + t2.clientY) / 2) - rect.top,
          startK: vp.k,
          startX: vp.x,
          startY: vp.y,
        };
        e.preventDefault();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchState) return;
      e.preventDefault();
      const t1 = e.touches[0]!;
      const t2 = e.touches[1]!;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const newDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const newCenterX = ((t1.clientX + t2.clientX) / 2) - rect.left;
      const newCenterY = ((t1.clientY + t2.clientY) / 2) - rect.top;

      // 缩放:以起始两指中心点为锚点
      const factor = newDistance / pinchState.distance;
      const newK = Math.min(Math.max(pinchState.startK * factor, 0.05), 5);
      const worldX = (pinchState.centerX - pinchState.startX) / pinchState.startK;
      const worldY = (pinchState.centerY - pinchState.startY) / pinchState.startK;

      // 平移:两指中心点移动量直接叠加到 viewport
      const panDx = newCenterX - pinchState.centerX;
      const panDy = newCenterY - pinchState.centerY;

      store.setViewport({
        x: newCenterX - worldX * newK + panDx,
        y: newCenterY - worldY * newK + panDy,
        k: newK,
      });
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchState = null;
      }
    };

    containerRef.current?.addEventListener('touchstart', onTouchStart, { passive: false });
    containerRef.current?.addEventListener('touchmove', onTouchMove, { passive: false });
    containerRef.current?.addEventListener('touchend', onTouchEnd);
    containerRef.current?.addEventListener('touchcancel', onTouchEnd);

    // 键盘:Space(临时平移)+ V(切换模式),仅非输入框焦点时生效
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        ic.setSpacePressed(true);
        e.preventDefault();
        return;
      }
      // Ctrl/Cmd + +/-/0: 缩放(以屏幕中心为源,与UI按钮一致)
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault();
          const store = ed?.store;
          if (!store) return;
          const vp = store.getViewport();
          const newK = Math.min(vp.k * 1.2, 5);
          const { width: cw, height: ch } = containerSize;
          const wx = (cw / 2 - vp.x) / vp.k;
          const wy = (ch / 2 - vp.y) / vp.k;
          store.setViewport({ x: cw / 2 - wx * newK, y: ch / 2 - wy * newK, k: newK });
          return;
        }
        if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          const store = ed?.store;
          if (!store) return;
          const vp = store.getViewport();
          const newK = Math.max(vp.k / 1.2, 0.05);
          const { width: cw, height: ch } = containerSize;
          const wx = (cw / 2 - vp.x) / vp.k;
          const wy = (ch / 2 - vp.y) / vp.k;
          store.setViewport({ x: cw / 2 - wx * newK, y: ch / 2 - wy * newK, k: newK });
          return;
        }
        if (e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault();
          ed?.store.setViewport({ x: 0, y: 0, k: 1 });
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
        const next: InteractionMode = ic.getMode() === 'select' ? 'pan' : 'select';
        ic.setMode(next);
        setInteractionMode(next);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        ic.setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    setEditor(ed);

    // 暴露 reloadGraph 函数给外部(冲突解决"拉取云端"后调用)
    // 通过 ref 桥接 useEffect 内部闭包与外部调用,访问 suppressNextSync 避免拉取-推送循环
    reloadGraphRef.current = (graph: GraphModel): void => {
      console.log(`[reloadGraph] replacing state with ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      ed.plugins.persistence?.suppressNextSave();
      suppressNextSync = true;
      commandQueue.replaceState(graph);
      // 拉取并重载后,云端更新已被消费,清除红点徽标
      setCloudUpdateAvailable(false);
      console.log('[reloadGraph] replaceState called, state updated');
    };

    return () => {
      // 标记组件已卸载,所有仍在执行的异步操作在 await 后检查此值并立即退出
      isMountedRef.current = false;
      // 清理 reloadGraph ref,防止卸载后调用
      reloadGraphRef.current = null;
      // 更新项目元数据(nodeCount + updatedAt),fire-and-forget 不阻塞 UI
      const graph = store.getGraph();
      void updateProject(canvasId, { nodeCount: graph.nodes.length });
      // 卸载时触发一次云同步推送(nodeCount 变动)
      onProjectUpdated(canvasId);
      // 移除云端 reload 事件监听
      window.removeEventListener(PROJECT_RELOAD_EVENT, handleProjectReload);
      // 移除云端 diff(版本差异)事件监听
      window.removeEventListener(PROJECT_DIFF_EVENT, handleProjectDiff);
      window.removeEventListener(PROJECT_DELETED_EVENT, handleProjectDeleted);
      window.removeEventListener(PROJECT_CONFLICT_EVENT, handleProjectConflict);
      unsubGraph();
      unsubSelection();
      unsubViewport();
      unsubGroup?.();
      unsubRemote?.();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      containerRef.current?.removeEventListener('wheel', onWheel);
      containerRef.current?.removeEventListener('touchstart', onTouchStart);
      containerRef.current?.removeEventListener('touchmove', onTouchMove);
      containerRef.current?.removeEventListener('touchend', onTouchEnd);
      containerRef.current?.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      resizeObserver.disconnect();
      ed.cleanup();
      setEditor(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

  // editor 就绪后,CanvasView 已 mount,containerRef.current 现在是 Viewport_ div(带 data-canvas-viewport)。
  // createDefaultEditor({ container }) 拿到的是外层包裹 div,CanvasView mount 后 containerRef.current
  // 被覆盖为 Viewport_ div,但 InteractionPlugin/ConnectionPlugin 的 container 未同步更新。
  // 此处同步 container,确保光标 CSS 选择器 [data-canvas-viewport][data-canvas-dragging="..."] 匹配,
  // 拖拽 grabbing 光标生效(详见 zeroexo-dev-principles 4.5 画布光标适配规则)。
  useEffect(() => {
    if (editor && containerRef.current) {
      editor.plugins.interaction.setContainer(containerRef.current);
      editor.plugins.connection?.setContainer(containerRef.current);
    }
  }, [editor]);

  const actions: EditorActions = {
    addNode: (type) => {
      if (!editor) return;
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // 新节点位置:当前视口中心(世界坐标)+ 小幅随机偏移避免完全重叠
      const vp = editor.store.getViewport();
      const cx = (containerSize.width / 2 - vp.x) / vp.k;
      const cy = (containerSize.height / 2 - vp.y) / vp.k;
      const offsetX = (Math.random() - 0.5) * 80;
      const offsetY = (Math.random() - 0.5) * 80;
      // 节点名称按类型自增编号(图片1/文本1)
      const sameTypeCount = editor.store.getGraph().nodes.filter((n) => n.type === type).length;
      const baseNameKey =
        type === 'text' ? 'nodeTypes.text'
          : type === 'image' ? 'nodeTypes.ai.image'
            : type === 'video' ? 'nodeTypes.ai.video'
              : type === 'audio' ? 'nodeTypes.ai.audio'
                : type === 'generator' ? 'nodes.generatorTitle'
                  : type === 'script' ? 'canvasNodes.stage.script'
                  : type === 'storyboard' ? 'canvasNodes.stage.storyboard'
                    : type === 'workbench' ? 'canvasNodes.stage.workbench'
                      : 'nodeTypes.config';
      const nodeTitle = `${t(baseNameKey)}${sameTypeCount + 1}`;
      const isCreation = type === 'script' || type === 'storyboard' || type === 'workbench';
      editor.core.commandQueue.execute(
        new AddNodeCommand({
          id,
          type,
          position: { x: cx + offsetX, y: cy + offsetY },
          title: nodeTitle,
          data:
            type === 'text'
              ? { content: t('editor.newTextNode'), prompt: '', status: 'idle', title: nodeTitle }
              : type === 'generator'
                ? { prompt: '', status: 'idle', generationMode: 'image', referenceImages: [], channelId: '', model: '', title: nodeTitle }
                : isCreation
                  ? type === 'script'
                    ? { title: nodeTitle, status: 'idle', content: '' }
                    : { title: nodeTitle, status: 'idle' }
                  : { prompt: '', content: '', status: 'idle', title: nodeTitle },
        }),
      );
    },
    deleteSelected: () => {
      if (!editor) return;
      const ids = editor.store.getSelection().selectedNodeIds;
      if (ids.size === 0) return;
      const groupCtrl = editor.plugins.group?.getController();
      const scene = groupCtrl?.getScene() ?? editor.store.getGraph().nodes;
      const toRemove = new Set<string>();
      for (const id of ids) {
        toRemove.add(id);
        const descendantIds = getDescendantIds(scene, id);
        for (const did of descendantIds) {
          toRemove.add(did);
        }
      }
      const removedNodes = scene.filter((n) => toRemove.has(n.id));
      const removedKeys = collectImageStorageKeys(removedNodes);
      const removedMediaKeys = collectVideoAudioStorageKeys(removedNodes);
      if (groupCtrl) {
        const newScene = scene.filter((n) => !toRemove.has(n.id));
        if (newScene.length !== scene.length) {
          editor.core.commandQueue.execute(new ReplaceSceneCommand(newScene));
        }
      } else {
        const cmds = [...ids].map((id) => new RemoveNodeCommand(id));
        editor.core.commandQueue.execute(new BatchCommand(cmds, 'delete-selected'));
      }
      if (removedKeys.size > 0 || removedMediaKeys.size > 0) {
        // 延迟回收:删除时不立即物理删除媒体数据,30s 后由 cleanupOrphanedResources
        // 基于"是否仍被 graph 引用"判定再清理。撤销发生在窗口内 → 节点恢复 → 资源被引用 → GC 跳过 → 数据无损。
        // 仅作用于本地 image_files/media_files 分桶,不影响云端 resources/ 与版本快照。
        scheduleDeferredCleanup();
      }
    },
    clearCanvas: () => {
      if (!editor) return;
      const groupCtrl = editor.plugins.group?.getController();
      const scene = groupCtrl?.getScene() ?? editor.store.getGraph().nodes;
      if (scene.length === 0) return;
      const removedKeys = collectImageStorageKeys(scene);
      const removedMediaKeys = collectVideoAudioStorageKeys(scene);
      if (groupCtrl) {
        editor.core.commandQueue.execute(new ReplaceSceneCommand([]));
      } else {
        const graph = editor.store.getGraph();
        const cmds = graph.nodes.map((n) => new RemoveNodeCommand(n.id));
        editor.core.commandQueue.execute(new BatchCommand(cmds, 'clear-canvas'));
      }
      if (removedKeys.size > 0 || removedMediaKeys.size > 0) {
        // 延迟回收:同 deleteSelected,30s 后由 GC 基于引用判定再清理,撤销窗口内数据保留。
        scheduleDeferredCleanup();
      }
    },
    undo: () => editor?.plugins.history.undo(),
    redo: () => editor?.plugins.history.redo(),
    toggleInteractionMode: () => {
      const next: InteractionMode = interactionMode === 'select' ? 'pan' : 'select';
      setInteractionMode(next);
      editor?.plugins.interaction.setMode(next);
    },
    setScale: (s) => {
      if (!editor) return;
      const vp = editor.store.getViewport();
      const { width: cw, height: ch } = containerSize;
      // 以屏幕中心为缩放源:保持同一世界点位于视口中心
      const wx = (cw / 2 - vp.x) / vp.k;
      const wy = (ch / 2 - vp.y) / vp.k;
      const nx = cw / 2 - wx * s;
      const ny = ch / 2 - wy * s;
      editor.store.setViewport({ x: nx, y: ny, k: s });
    },
    resetView: () => {
      editor?.store.setViewport({ x: 0, y: 0, k: 1 });
    },
    groupSelected: () => {
      if (!editor) return;
      const groupCtrl = editor.plugins.group?.getController();
      if (!groupCtrl) return;
      const selectedIds = editor.store.getSelection().selectedNodeIds;
      if (selectedIds.size < 2) return;
      // 等效 demo:创建预览 → 立即确认(二段式合并为一步)
      groupCtrl.createPreview(selectedIds);
      groupCtrl.confirmPreview(t('groupTools.defaultGroupName'));
    },
    ungroupSelected: () => {
      if (!editor) return;
      const groupCtrl = editor.plugins.group?.getController();
      if (!groupCtrl) return;
      const selectedIds = editor.store.getSelection().selectedNodeIds;
      if (selectedIds.size === 0) return;
      // 从选中集中筛出组节点 id(ungroup 仅接受组 id)
      const graph = editor.store.getGraph();
      const groupIds = [...selectedIds].filter((id) => {
        const node = graph.nodes.find((n: NodeRecord) => n.id === id);
        return node?.type === 'group';
      });
      if (groupIds.length === 0) return;
      groupCtrl.ungroup(groupIds);
    },
  };

  const state: EditorState = {
    editor,
    loading,
    extensions,
    canUndo,
    canRedo,
    interactionMode,
    scale,
    selectedCount,
    selectedNodeId,
    selectedNodeType,
    selectedHasGroup,
    selectedInGroup,
    isMixedSelection,
    isGroupPreviewing,
    containerSize,
    selectedNodeData,
  };

  const refs: EditorRefs = {
    store: editor?.store ?? null,
    commandQueue: editor?.core.commandQueue ?? null,
    interactionController: editor?.plugins.interaction.getController() ?? null,
    connectionController: editor?.plugins.connection.getController() ?? null,
    selectionController: editor?.plugins.selection.getController() ?? null,
    layoutController: editor?.plugins.layout.getController() ?? null,
    nodesPlugin: editor?.plugins.nodes ?? null,
    groupPlugin: editor?.plugins.group ?? null,
    aiProvider: editor?.plugins.aiProvider ?? null,
    // 右键菜单控制器占位(实际菜单由 editor-page 的 contextMenuItems 渲染,此处保留 null 兼容引用)
    contextMenuController: null,
  };

  /** 冲突解决"拉取云端"后,用云端 graph 替换当前编辑器 graph */
  const reloadGraph = useCallback((graph: GraphModel): void => {
    reloadGraphRef.current?.(graph);
  }, []);

  /** 清除"云端有更新"红点徽标(用户点击同步按钮显式拉取后调用) */
  const clearCloudUpdateAvailable = useCallback((): void => {
    setCloudUpdateAvailable(false);
  }, []);

  /**
   * 冲突解决:"拉取云端" — 强制从云端拉取合并到本地,再用云端 graph 替换当前编辑器 graph。
   * 云端 404(已删除)时 forcePullProjectFromCloud 会删除本地数据。
   */
  const onPullCloud = useCallback((): void => {
    void (async () => {
      try {
        await forcePullProjectFromCloud(canvasId);
        if (conflict?.cloudDeleted) {
          // 云端已删除 → 本地也随之删除,返回首页
          window.location.href = '/';
          return;
        }
        const graph = await loadProjectGraph(canvasId);
        if (graph) reloadGraph(graph);
        setConflict(null);
        markProjectClean(canvasId);
      } catch (err) {
        console.error('[use-editor-state] pull cloud failed:', err);
        message.error(i18n.t('sync.error'));
      }
    })();
  }, [canvasId, conflict, reloadGraph, message]);

  /** 冲突解决:"推送本地" — 本地覆盖云端;云端已删除时重新创建为全新云端项目 */
  const onPushLocal = useCallback((): void => {
    const currentGraph = editor?.store.getGraph();
    void (async () => {
      try {
        if (conflict?.cloudDeleted) {
          await repushLocalAsNewCloud(canvasId);
        } else {
          await forcePushLocalToCloud(canvasId, currentGraph as GraphModel | undefined);
        }
        markProjectClean(canvasId);
        setConflict(null);
      } catch (err) {
        console.error('[use-editor-state] push local failed:', err);
        message.error(i18n.t('sync.error'));
      }
    })();
  }, [canvasId, conflict, editor, message]);

  /** 关闭冲突弹窗(用户放弃处理,保留当前本地状态) */
  const onConflictClose = useCallback((): void => {
    setConflict(null);
  }, []);

  return {
    state,
    actions,
    refs,
    containerRef,
    reloadGraph,
    cloudUpdateAvailable,
    clearCloudUpdateAvailable,
    conflict,
    onPullCloud,
    onPushLocal,
    onConflictClose,
    collaboration,
    awarenessStates: collaboration.awarenessStates,
    collaborationActive: collaboration.active,
  };
}
