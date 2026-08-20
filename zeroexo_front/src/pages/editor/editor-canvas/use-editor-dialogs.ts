/**
 * useEditorDialogs - 画布编辑页弹窗/模态框状态管理与回调
 *
 * 从 EditorPage 提取的弹窗相关状态和回调,统一管理。
 */

import { useCallback, createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeRecord } from '@zeroexo/core';
import { AddNodeCommand } from '@zeroexo/core';
import { createAssetNode } from '@zeroexo/plugin-nodes';
import { getProject, loadProjectGraph, saveProjectGraph, createProject, updateProject, deleteProject, deleteProjectGraph } from '@zeroexo/plugin-persistence';
import { loadCanvasConfig, saveCanvasConfig } from '@/features/top-bar/index.js';
import type { CanvasConfig } from '@/features/top-bar/index.js';
import type { ImageDialogState } from '@/features/image-editor/image-dialog-renderer.js';
import { toInsertPayload } from '@/features/asset-picker/components/picker-card.js';
import type { NavProjectAction } from '@/shared/components/index.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { HomeIcon, PlusIcon, CopyIcon, Trash2 } from 'lucide-react';
import i18n from '@/i18n/config';
import type { EditorRefs } from './use-editor-state.js';

export function useEditorDialogs({
  canvasId,
  onBack,
  onOpenProject,
  onProjectCreated,
  onProjectDeleted,
  onProjectUpdated,
  setRenamingGroupId,
  refs,
  state,
  actions,
  message,
  t,
  isMobile,
}: {
  canvasId: string;
  onBack: () => void;
  onOpenProject: (id: string) => void;
  onProjectCreated: (id: string) => void;
  onProjectDeleted: (id: string, opts?: { skipLocalDelete?: boolean }) => Promise<void>;
  onProjectUpdated: (id: string) => void;
  setRenamingGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  refs: EditorRefs;
  state: { containerSize: { width: number; height: number } };
  actions: { clearCanvas: () => void };
  message: any;
  t: (key: string, opts?: any) => string;
  isMobile: boolean;
}) {
  // ===== 画布标题 =====
  const [title, setTitle] = useState(() => t('editor.untitled'));
  const [titleDraft, setTitleDraft] = useState(() => t('editor.untitled'));
  const [isTitleEditing, setIsTitleEditing] = useState(false);

  // ===== 面板开关 =====
  const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
  const [isHierarchyOpen, setIsHierarchyOpen] = useState(false);
  const [isHierarchyClosing, setIsHierarchyClosing] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  // ===== 背景/网格样式（有 localStorage 持久化逻辑） =====
  const [background, setBackground] = useState<'dots' | 'lines' | 'none'>(() => {
    try {
      const v = localStorage.getItem('zeroexo:grid-style-v1');
      if (v === 'dots' || v === 'lines' || v === 'none') return v;
    } catch { /* noop */ }
    return 'dots';
  });
  // 网格样式变更时持久化到 localStorage
  useEffect(() => {
    try { localStorage.setItem('zeroexo:grid-style-v1', background); } catch { /* noop */ }
  }, [background]);

  // ===== 画布配置 =====
  const [canvasConfig, setCanvasConfig] = useState<CanvasConfig>(() => loadCanvasConfig());

  // ===== 设置弹窗 =====
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ===== 协作管理弹窗 =====
  const [collaborationOpen, setCollaborationOpen] = useState(false);

  // 打开协作弹窗
  const onOpenCollaboration = useCallback(() => {
    setCollaborationOpen(true);
  }, []);

  // ===== 版本快照弹窗 =====
  const [versionSaveOpen, setVersionSaveOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const onSaveVersion = useCallback(() => setVersionSaveOpen(true), []);
  const onOpenVersionHistory = useCallback(() => setVersionHistoryOpen(true), []);

  // Ctrl+S 保存版本(Ctrl 或 Meta,并阻止浏览器默认保存)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setVersionSaveOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ===== 协作聊天/成员面板(Dock) =====
  const [collaborationDockOpen, setCollaborationDockOpen] = useState(false);

  // 切换协作面板开关
  const onOpenCollaborationDock = useCallback(() => {
    setCollaborationDockOpen((v) => !v);
  }, []);

  // ===== 组样式编辑 =====
  const [groupStyleDialog, setGroupStyleDialog] = useState<{
    groupId: string;
    currentBgColor: string | undefined;
    currentOpacity: number | undefined;
    currentRadius: number | undefined;
  } | null>(null);

  // ===== 确认弹窗 =====
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [confirmClearCanvas, setConfirmClearCanvas] = useState(false);
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);

  // ===== 移动端 =====
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileAppearanceOpen, setMobileAppearanceOpen] = useState(false);
  const [mobileShortcutsOpen, setMobileShortcutsOpen] = useState(false);

  // ===== 图片编辑对话框 =====
  const [imageDialog, setImageDialog] = useState<ImageDialogState | null>(null);

  // ===== 连线释放菜单 =====
  const [connectionDrop, setConnectionDrop] = useState<{
    source: { nodeId: string; nodeType: string; pinId: string; direction: 'input' | 'output' };
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
  } | null>(null);

  // ===== 详情节点 =====
  const [detailNode, setDetailNode] = useState<NodeRecord | null>(null);

  // ===== 替换文件 =====
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceNodeId, setReplaceNodeId] = useState<string | null>(null);
  const [replaceAccept, setReplaceAccept] = useState('image/*,video/*,audio/*');

  // ===== 回调函数 =====

  // 层级面板展开/收起（桌面端：收起时先动画 350ms 再卸载；移动端：直接关闭弹窗）
  const toggleHierarchy = useCallback(() => {
    if (isHierarchyOpen) {
      if (isMobile) {
        setIsHierarchyOpen(false);
      } else {
        setIsHierarchyClosing(true);
        setTimeout(() => {
          setIsHierarchyOpen(false);
          setIsHierarchyClosing(false);
        }, 350);
      }
    } else {
      setIsHierarchyOpen(true);
    }
  }, [isHierarchyOpen, isMobile]);

  // 打开设置弹窗
  const onOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  // 触发组重命名
  const onRenameGroup = useCallback((groupId: string) => {
    setRenamingGroupId(groupId);
  }, []);

  // 配置确认回调(确认制:预览只发生在弹窗内,确认才应用到画布并持久化)
  const onCanvasConfigConfirm = useCallback((next: CanvasConfig) => {
    setCanvasConfig(next);
    saveCanvasConfig(next);
  }, []);

  // 删除项目（弹窗确认）
  const handleMenuDeleteProject = useCallback(() => {
    setConfirmDeleteProject(true);
  }, []);

  // 清空画布（弹窗确认）
  const handleClearCanvasClick = useCallback(() => {
    setConfirmClearCanvas(true);
  }, []);

  // 实际执行删除
  const doDeleteProject = useCallback(async () => {
    setConfirmDeleteProject(false);
    try {
      await onProjectDeleted(canvasId, { skipLocalDelete: true });
    } catch (err) {
      console.warn('[EditorPage] cloud delete failed, continuing with local delete:', err);
    }
    await deleteProjectGraph(canvasId);
    await deleteProject(canvasId);
    onBack();
  }, [canvasId, onBack, onProjectDeleted]);

  // 实际执行清空画布
  const doClearCanvas = useCallback(() => {
    setConfirmClearCanvas(false);
    actions.clearCanvas();
  }, [actions]);

  // 标题编辑完成
  const handleFinishTitleEditing = useCallback(() => {
    const trimmed = titleDraft.trim() || t('editor.untitled');
    setTitle(trimmed);
    setIsTitleEditing(false);
    void (async () => {
      try {
        await updateProject(canvasId, { title: trimmed });
        onProjectUpdated(canvasId);
        message.success(i18n.t('editorDialogs.titleUpdated'));
      } catch {
        message.error(i18n.t('errors.BAD_REQUEST'));
      }
    })();
  }, [titleDraft, t, canvasId, onProjectUpdated, message]);

  // 素材插入画布
  const handleAssetInsert = useCallback(
    (item: { type: 'asset' | 'prompt' | 'subject'; id: string; data: any }): void => {
      if (!refs.commandQueue || !refs.store) return;
      if (item.type !== 'asset') return;
      const asset = item.data as Asset;
      const payload = toInsertPayload(asset);
      const vp = refs.store.getViewport();
      const cx = (state.containerSize.width / 2 - vp.x) / vp.k;
      const cy = (state.containerSize.height / 2 - vp.y) / vp.k;
      const offsetX = (Math.random() - 0.5) * 80;
      const offsetY = (Math.random() - 0.5) * 80;
      void (async () => {
        const node = await createAssetNode(payload as any, { x: cx + offsetX, y: cy + offsetY });
        if (node) {
          refs.commandQueue!.execute(new AddNodeCommand(node));
          refs.store!.setSelection({
            selectedNodeIds: new Set([node.id]),
            selectedEdgeIds: new Set(),
          });
        }
      })();
      setAssetPickerOpen(false);
    },
    [refs, state.containerSize],
  );

  // 创建新项目
  const handleNewProject = useCallback(async () => {
    let baseTitle = t('home.untitled');
    try {
      const { listProjects } = await import('@zeroexo/plugin-persistence');
      const allProjects = await listProjects();
      const existing = allProjects.filter(
        (p: { title: string }) => p.title === baseTitle || p.title.startsWith(baseTitle + ' '),
      );
      if (existing.length > 0) {
        baseTitle = `${baseTitle} ${existing.length + 1}`;
      }
    } catch {
      // listProjects 不可用时降级使用 baseTitle
    }
    const project = await createProject({ title: baseTitle });
    if (project) {
      onProjectCreated(project.id);
      onOpenProject(project.id);
    }
  }, [t, onOpenProject, onProjectCreated]);

  // 拷贝项目
  const handleCopyProject = useCallback(async () => {
    const current = await getProject(canvasId);
    const memoryGraph = refs.store?.getGraph();
    const rawGraph = memoryGraph ?? await loadProjectGraph(canvasId);
    const graph = rawGraph ? structuredClone(rawGraph) : null;
    const copyTitle = current ? `${current.title} ${t('menu.copySuffix')}` : t('editor.untitled');
    const project = await createProject({ title: copyTitle });
    if (project) {
      if (graph) {
        await saveProjectGraph(project.id, graph);
        await updateProject(project.id, { nodeCount: graph.nodes.length });
      } else {
        await saveProjectGraph(project.id, { nodes: [], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} });
        await updateProject(project.id, { nodeCount: 0 });
      }
      onProjectCreated(project.id);
      onOpenProject(project.id);
    }
  }, [canvasId, t, onOpenProject, onProjectCreated, refs.store]);

  // 移动端导航操作列表
  const mobileNavProjectActions = useMemo<NavProjectAction[]>(
    () => [
      {
        key: 'home',
        label: t('menu.backHome'),
        icon: createElement(HomeIcon, { size: 16 }),
      },
      {
        key: 'newProject',
        label: t('menu.newProject'),
        icon: createElement(PlusIcon, { size: 16 }),
      },
      {
        key: 'copyProject',
        label: t('menu.copyProject'),
        icon: createElement(CopyIcon, { size: 16 }),
      },
      {
        key: 'deleteProject',
        label: t('menu.deleteCanvas'),
        icon: createElement(Trash2, { size: 16 }),
        danger: true,
      },
    ],
    [t],
  );

  // 移动端导航操作分发
  const handleMobileProjectAction = useCallback(
    (key: NavProjectAction['key']) => {
      switch (key) {
        case 'home':
          onBack();
          break;
        case 'newProject':
          void handleNewProject();
          break;
        case 'copyProject':
          void handleCopyProject();
          break;
        case 'deleteProject':
          handleMenuDeleteProject();
          break;
      }
    },
    [onBack, handleNewProject, handleCopyProject, handleMenuDeleteProject],
  );

  return {
    // 画布标题
    title,
    setTitle,
    titleDraft,
    setTitleDraft,
    isTitleEditing,
    setIsTitleEditing,

    // 面板开关
    isMiniMapOpen,
    setIsMiniMapOpen,
    isHierarchyOpen,
    setIsHierarchyOpen,
    isHierarchyClosing,
    setIsHierarchyClosing,
    assetPickerOpen,
    setAssetPickerOpen,
    agentOpen,
    setAgentOpen,

    // 背景/网格样式
    background,
    setBackground,

    // 画布配置
    canvasConfig,
    setCanvasConfig,

    // 设置弹窗
    settingsOpen,
    setSettingsOpen,

    // 协作管理弹窗
    collaborationOpen,
    setCollaborationOpen,
    onOpenCollaboration,

    // 版本快照弹窗
    versionSaveOpen,
    setVersionSaveOpen,
    versionHistoryOpen,
    setVersionHistoryOpen,
    onSaveVersion,
    onOpenVersionHistory,

    // 协作聊天/成员面板(Dock)
    collaborationDockOpen,
    setCollaborationDockOpen,
    onOpenCollaborationDock,

    // 组样式编辑
    groupStyleDialog,
    setGroupStyleDialog,

    // 确认弹窗
    confirmDeleteProject,
    setConfirmDeleteProject,
    confirmClearCanvas,
    setConfirmClearCanvas,
    confirmDeleteGroupId,
    setConfirmDeleteGroupId,

    // 移动端
    mobileNavOpen,
    setMobileNavOpen,
    mobileAppearanceOpen,
    setMobileAppearanceOpen,
    mobileShortcutsOpen,
    setMobileShortcutsOpen,

    // 图片编辑对话框
    imageDialog,
    setImageDialog,

    // 连线释放菜单
    connectionDrop,
    setConnectionDrop,

    // 详情节点
    detailNode,
    setDetailNode,

    // 替换文件
    replaceInputRef,
    replaceNodeId,
    setReplaceNodeId,
    replaceAccept,
    setReplaceAccept,

    // 回调函数
    toggleHierarchy,
    onOpenSettings,
    onRenameGroup,
    onCanvasConfigConfirm,
    handleMenuDeleteProject,
    handleClearCanvasClick,
    doDeleteProject,
    doClearCanvas,
    handleFinishTitleEditing,
    handleAssetInsert,
    handleNewProject,
    handleCopyProject,
    handleMobileProjectAction,
    mobileNavProjectActions,
  };
}