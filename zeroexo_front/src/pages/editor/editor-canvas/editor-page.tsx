/**
 * EditorPage - 画布编辑页
 *
 * 装配:CanvasView(含交互回调)+ TopBar/LeftSideToolBar/RightSideToolBar/ToolsDock
 * + MinimapView(右下角)
 * + PromptPanel(选中节点时)/ AssetPicker(我的素材)。
 *
 * 架构调整:
 * - 移除 NodeDetailPanel(所有操作聚合到 ToolsDock)
 * - 移除 NodeHoverToolbar(悬浮节点/组上的工具栏,功能并入 ToolsDock)
 * - 移除 BottomToolbar(模式切换并入 LeftSideToolBar,成组/解组/排列并入 ToolsDock)
 * - 移除 ImageToolSettingsModal(换列/工具勾选配置不再需要)
 * - 移除 LayoutToolbar/ArrangeDropdown 自定义工具栏页面(排列改由 ToolsDock 聚合按钮承担)
 * - 配置弹窗(ConfigDialog,画布样式)由本页直接渲染,TopBar 通过 onOpenSettings 触发
 * - 组重命名通过 externalRenamingGroupId 触发 GroupLayer 的 inline input(聚焦+全选)
 *
 * 交互回调最简委托给 interactionController。
 * 弹窗状态和交互回调已提取到 use-editor-dialogs 和 use-editor-interactions 两个 Hook。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { App, Layout, Tooltip } from 'antd';
import { ClipboardPaste } from 'lucide-react';
import { EDITOR_ICONS } from './icons.js';
import { hasClipboardContent, pasteClipboard } from '@zeroexo/preset-default';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { CanvasView, PinDefaultsProvider, NodeDefaultsProvider } from '@zeroexo/plugin-render-react';
import { MinimapView } from '@zeroexo/plugin-minimap';
import { GroupLayer, GroupDefaultsProvider, getGroupBoundsWithEmptyFallback } from '@zeroexo/plugin-group';
import { useTheme } from '@zeroexo/plugin-theme';
import { fullSync, onProjectCreated, onProjectUpdated, onProjectDeleted } from '@/services/sync/sync-service.js';
import { useSyncStatus } from '@/services/sync/sync-store.js';
import type { NodeRecord, EdgeRecord } from '@zeroexo/core';
import { TopBar, ConfigDialog, VersionDialogs } from '@/features/top-bar/index.js';
import { CanvasMenu } from '@/features/top-bar/components/canvas-menu.js';
import { CanvasOverlays } from '@/features/canvas-interaction/canvas-overlays.js';
import { ConnectionDropMenu } from '@/features/canvas-interaction/connection-drop-menu.js';
import { LeftSideToolBar } from '@/features/left-side-toolbar/index.js';
import { NodeCapsuleToolbar } from '@/features/tools-dock/node-capsule-toolbar.js';
import { GroupStyleDialog } from '@/features/tools-dock/group-style-dialog.js';
import { ContextualShortcutsPanel } from '@/shared/hints/contextual-shortcuts-panel.js';
import { ContentBeacon } from '@/features/canvas-interaction/content-beacon.js';
import { useHintsEnabled } from '@/shared/hints/hints-settings.js';
import { SyncConflictDialog } from '@/features/sync-conflict-dialog/sync-conflict-dialog.js';
import { CollaborationModal } from '@/features/collaboration/collaboration-modal.js';
import { CollabOverlay } from '@/features/collaboration/collab-overlay.js';
import { AgentCursorOverlay } from '@/features/canvas-agent/ui/agent-cursor-overlay.js';
import { NodeGenerateDock } from '@/features/tools-dock/node-generate-dock.js';
import { AssetLibraryModal } from '@/features/asset-library/index.js';
import { AgentDock, CanvasContextProvider } from '@/features/canvas-agent/ui/index.js';
import { setCanvasOpBridge, type CanvasOpStore } from '@/features/canvas-agent/ui/canvas-op-bridge.js';
import { saveCanvasConfig } from '@/features/top-bar/index.js';
import { useCanvasAgentStore } from '@/features/canvas-agent/ui/store.js';
import { sendMessage } from '@/features/canvas-agent/ui/session/agent-session.js';
import { consumePendingAgentPrompt } from '@/features/canvas-agent/ui/pending-agent-prompt.js';
import { useAssets } from '@/features/asset-picker/index.js';
import { HierarchyPanelSidebar } from '@/features/hierarchy/index.js';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import type { KeyboardPlugin } from '@zeroexo/plugin-keyboard';
import { getProject } from '@zeroexo/plugin-persistence';
import { ConfirmDialog, NodeCreateMenu, AppearanceDialog, ShortcutsDialog, MobileNavDrawer, MobileNavButton, MobileNavFloatingWrapper, LanguageDialog, AssetDetailViewer, LoadingOverlay } from '@/shared/components/index.js';
import type { ContextMenuItem } from '@/shared/components/index.js';
import { ImageDialogRenderer } from '@/features/image-editor/image-dialog-renderer.js';
import { useCanvasHandlers } from '@/features/canvas-interaction/use-canvas-handlers.js';
import { useDropHandler } from '@/features/canvas-interaction/drop-handler.js';
import { UploadQueueOverlay } from '@/features/upload-queue/index.js';
import { useUploadQueue } from '@/features/upload-queue/use-upload-queue.js';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { useEditorState } from './use-editor-state.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { CreationSyncBadge } from '@/components/creation/CreationSyncBadge.js';
import { useAiConfigStore } from '@/features/ai-config/use-ai-config-store.js';
import { useEditorDialogs } from './use-editor-dialogs.js';
import { useEditorInteractions } from './use-editor-interactions.js';
import { MobileHierarchyDrawer } from './editor-mobile-drawer.js';
import { DevPerformancePanel } from '@/features/dev-performance/dev-performance-panel.js';

// 堆叠收纳提示合并窗口(征集#25 拍板 A+B):批量场景(压力注入器/JSON 加载)一次触发大量 stackCollected,
// 原实现每条独立 message 造成提示刷屏;现按 1.5s 窗口合并 + 计数,窗口内事件数 ≥ 阈值判定批量 → 完全静默。
const STACK_TOAST_KEY = 'stackCollected-batch';
const STACK_TOAST_WINDOW_MS = 1500;
const STACK_TOAST_DELAY_MS = 300;
const STACK_TOAST_BATCH_THRESHOLD = 10;

export interface EditorPageProps {
  canvasId: string;
  /** 协作邀请码(来自 /c/<code> 邀请链接解析,用于自动申请加入房间) */
  inviteCode?: string;
  onBack: () => void;
  onOpenProject: (id: string) => void;
}

export function EditorPage({ canvasId, inviteCode, onBack, onOpenProject }: EditorPageProps): React.ReactElement {
  const { state, actions, refs, containerRef, cloudUpdateAvailable, clearCloudUpdateAvailable, conflict, onPullCloud, onPushLocal, onConflictClose } = useEditorState(canvasId);
    // 快捷键注册表(键盘插件实例;供快捷键弹窗自动映射,未安装插件时为 undefined)
    const keyboardShortcuts = state.editor?.core.plugins.get<KeyboardPlugin>('keyboard')?.listShortcuts();
  const { theme } = useTheme();
  const { message } = App.useApp();
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { status } = useSyncStatus();
  const { isAuthenticated, logout } = useAuth();
  // 教育提示全局开关(设置弹窗控制,localStorage 持久化)
  const hintsEnabled = useHintsEnabled();
  // 移动端语言弹窗(由 MobileNavDrawer 触发)
  const [mobileLanguageOpen, setMobileLanguageOpen] = useState(false);
  // AI 渠道配置(用于生成中按钮展示"模型(渠道)"任务信息)
  const aiConfig = useAiConfigStore((state) => state.config);

  // 右键菜单 + 重命名状态(保留在 main 组件,因为与 JSX 渲染直接耦合)
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[] | null | undefined>(undefined);
  // 空白区域节点创建菜单(使用通用 NodeCreateMenu 组件)
  const [nodeCreateMenuPos, setNodeCreateMenuPos] = useState<{ x: number; y: number } | null>(null);
  // 组重命名:由 toolbar 的"重命名"按钮设置 groupId,GroupLayer 消费后进入 inline edit 态
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  // 普通节点重命名:由 toolbar 的"重命名"按钮设置 nodeId,CanvasView 消费后进入 inline edit 态
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);

  // 弹窗状态管理
  const dialogs = useEditorDialogs({
    canvasId, onBack, onOpenProject,
    onProjectCreated, onProjectDeleted, onProjectUpdated,
    setRenamingGroupId,
    refs, state, actions, message, t, isMobile,
  });

  // 通过邀请链接(/c/<code>)进入时,自动打开协作弹窗并申请加入房间
  useEffect(() => {
    if (inviteCode && !state.loading) {
      dialogs.setCollaborationOpen(true);
    }
    // 仅首次进入时触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode, state.loading]);

  // 素材库
  const { addAsset: addAssetToStore } = useAssets();

  // 交互回调
  const interactions = useEditorInteractions({
    refs, state, actions, t, aiConfig,
    addAssetToStore: async (input: any) => { void addAssetToStore(input); },
    canvasConfig: dialogs.canvasConfig,
    containerRef,
    setRenamingNodeId,
    setNodeCreateMenuPos,
    nodeCreateMenuPos,
    setContextMenuItems,
    setConnectionDrop: dialogs.setConnectionDrop,
    setImageDialog: dialogs.setImageDialog,
    setDetailNode: dialogs.setDetailNode,
    setAssetPickerOpen: dialogs.setAssetPickerOpen,
    setReplaceNodeId: dialogs.setReplaceNodeId,
    replaceNodeId: dialogs.replaceNodeId,
    setReplaceAccept: dialogs.setReplaceAccept,
    replaceInputRef: dialogs.replaceInputRef,
    setGroupStyleDialog: dialogs.setGroupStyleDialog,
    onRenameGroup: dialogs.onRenameGroup,
  });

  // 空白右键「重置视图」:全图适配(fit-content)。左栏缩放菜单 fitScreen 仅是 100% 复位,
  // 此处才是真正「看到全部内容」;空图回退世界原点 (0,0) k=1(Plan#21 候选 B)
  // Plan#33 D4: Agent 画布操作桥接层注入。访问器经 ref 读取最新状态,避免闭包过期;
  // 卸载时清理,非画布页(AgentDock 在首页等处的复用)保持未注入 → agent-session 回退文本展示
  const bridgeStateRef = useRef(state);
  bridgeStateRef.current = state;
  // R2-3: 画布配置桥接需要最新 dialogs 状态（set_config 应用+持久化）
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs;
  useEffect(() => {
    setCanvasOpBridge({
      getCommandQueue: () => bridgeStateRef.current.editor?.core.commandQueue ?? null,
      getStore: () => (bridgeStateRef.current.editor?.store as unknown as CanvasOpStore | null) ?? null,
      getContainerSize: () => bridgeStateRef.current.containerSize,
      getExtensions: () => bridgeStateRef.current.extensions,
      // R2-3: Agent set_config 画布操作 → 应用配置 + 持久化（与设置弹窗确认制同源）
      applyCanvasConfig: (patch) => {
        const d = dialogsRef.current;
        if (!d) return false;
        const next = { ...d.canvasConfig, ...patch };
        d.setCanvasConfig(next);
        saveCanvasConfig(next);
        return true;
      },
      // R3-A2: 附件卡点击 → 打开资产库弹窗
      openAssetLibrary: () => {
        const d = dialogsRef.current;
        if (!d) return false;
        d.setAssetPickerOpen(true);
        return true;
      },
    });
    return () => setCanvasOpBridge(null);
  }, []);

  // Plan#33 D5: 主页智能体工作流 - 消费待注入提示词
  // 流程: 主页点生成 → 先建画布项目 → 跳转本页 → 打开 Agent 面板 + 提示词完整占位到输入框 + 自动发送(面板内思考)
  useEffect(() => {
    if (state.loading || !canvasId) return;
    const prompt = consumePendingAgentPrompt();
    if (prompt == null) return;
    const s = useCanvasAgentStore.getState();
    s.setDockOpen(true);
    s.setInputText(prompt);
    s.addMessage({
      id: `msg_user_${Date.now()}`,
      role: 'user',
      type: 'text',
      text: prompt,
      timestamp: Date.now(),
    });
    void sendMessage(prompt, { projectId: canvasId });
  }, [state.loading, canvasId]);

  // TopBar Agent 按钮高亮跟随 store 单一状态源(dock 内关闭按钮关闭面板后同步灭灯)
  const agentDockOpen = useCanvasAgentStore((s) => s.dockOpen);

  const handleResetView = useCallback(() => {
    const store = state.editor?.store;
    if (!store) return;
    const graph = store.getGraph();
    if (graph.nodes.length === 0) {
      store.setViewport({ x: 0, y: 0, k: 1 });
      return;
    }
    // 全图 union:组用 getGroupBoundsWithEmptyFallback(含空组回退),普通节点 position+size(与多选聚焦同源)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph.nodes) {
      if (n.type === 'group') {
        const b = getGroupBoundsWithEmptyFallback(graph.nodes, n.id, interactions.getNodeSize);
        if (!b) continue;
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
      } else {
        const size = interactions.getNodeSize(n);
        minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + size.width); maxY = Math.max(maxY, n.position.y + size.height);
      }
    }
    if (!Number.isFinite(minX)) {
      store.setViewport({ x: 0, y: 0, k: 1 });
      return;
    }
    store.focusOnBounds(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      state.containerSize,
      400,
      51,
    );
  }, [state.editor, state.containerSize, interactions]);

  // 从 persistence 加载画布标题
  useEffect(() => {
    void (async () => {
      const project = await getProject(canvasId);
      if (project?.title) {
        dialogs.setTitle(project.title);
        dialogs.setTitleDraft(project.title);
      }
    })();
  }, [canvasId]);

  // ===== Helper Lines(对齐辅助线) 已按需求关闭绘制 =====
  useEffect(() => {
    const ctrl = refs.interactionController;
    if (!ctrl) return;
    // 关闭辅助线:不注册回调,避免绘制
    ctrl.setHelperLinesCallback(null);
    return () => ctrl.setHelperLinesCallback(null);
  }, [refs.interactionController]);

  // 画布拖拽落点处理(AssetPicker 素材 + 外部文件)
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  if (!uploadQueueRef.current) {
    uploadQueueRef.current = new UploadQueue({ concurrency: 5, maxRetries: 2 });
  }
  const commandQueue = refs.commandQueue;
  const { processFiles } = useUploadQueue(commandQueue, uploadQueueRef.current);
  // 组件卸载时重置队列
  useEffect(() => {
    return () => {
      uploadQueueRef.current?.reset();
    };
  }, []);
  const dropHandlers = useDropHandler({
    refs,
    containerRef,
    processFiles,
    onError: (msg) => message.error(msg),
  });

  // 选中节点数据
  const selectedNodeData = state.selectedNodeData;
  const isPromptRunning = selectedNodeData?.status === 'loading';
  // 节点生成面板三态判定(Plan#33 延伸):
  // - media 节点(text/image/video/audio)有实质内容(content/storageKey)= 资源态 → 隐藏生成面板(上传替换/拖入资产自动降级)
  // - media 节点无内容 = 空节点/生成器态 → 显示生成面板;生成中(loading)强制保持面板(停止按钮)
  // - generator 等非 media 类型恒显示面板(节点自身语义即生成器)
  const selectedNodeIsMedia = state.selectedNodeType === 'image' || state.selectedNodeType === 'video' || state.selectedNodeType === 'audio' || state.selectedNodeType === 'text';
  const selectedNodeHasContent = !!selectedNodeData?.content || !!selectedNodeData?.storageKey;
  const nodeDockVisible = !selectedNodeIsMedia || !selectedNodeHasContent || isPromptRunning;
  const handlers = useCanvasHandlers(refs, containerRef);

  // 双击节点缩放
  const handleNodeDoubleClick = useCallback((nodeId: string, width: number, height: number) => {
    const store = state.editor?.store;
    if (!store?.focusOnNode) return;
    store.focusOnNode(nodeId, state.containerSize, width, height, 400, 51);
  }, [state.editor?.store, state.containerSize]);

  // 是否选中可堆叠媒体节点(image/video,有内容时)
  const isStackableMedia = (() => {
    const nodeType = state.selectedNodeType as string;
    if (nodeType !== 'image' && nodeType !== 'video') return false;
    const data = state.selectedNodeData;
    if (!data) return false;
    return Boolean(data['content']);
  })();

  // StackNode 状态派生:是否有卡片/是否有连线预览
  const stackHasCards = (() => {
    if ((state.selectedNodeType as string) !== 'stacked-media') return false;
    const store = state.editor?.store;
    if (!store) return false;
    const selected = store.getSelection().selectedNodeIds;
    if (selected.size !== 1) return false;
    const nodeId = selected.values().next().value;
    if (!nodeId) return false;
    const node = store.getNode(nodeId);
    if (!node) return false;
    const data = node.data as Record<string, unknown> | undefined;
    const cards = data?.cards as unknown[] | undefined;
    return !!cards && cards.length > 0;
  })();

  const hasIncomingPreviews = (() => {
    if ((state.selectedNodeType as string) !== 'stacked-media') return false;
    const store = state.editor?.store;
    if (!store) return false;
    const selected = store.getSelection().selectedNodeIds;
    if (selected.size !== 1) return false;
    const nodeId = selected.values().next().value;
    if (!nodeId) return false;
    const graph = store.getGraph();
    return graph.edges.some((e: EdgeRecord) =>
      e.target.nodeId === nodeId && e.target.pinId === 'prompt'
    );
  })();

  // 上一个/下一个节点导航(nodeActionBus 事件)
  useEffect(() => {
    const unsubscribe = nodeActionBus.on('navigate', (event) => {
      const { nodeId } = event;
      if (!nodeId || !state.editor?.store) return;
      const graph = state.editor.store.getGraph();
      const targetNode = graph.nodes.find((n) => n.id === nodeId);
      if (!targetNode) return;
      const size = interactions.getNodeSize(targetNode as any);
      state.editor.store.focusOnNode(nodeId, state.containerSize, size.width, size.height, 400, 51);
    });
    return unsubscribe;
  }, [state.editor, state.containerSize, interactions]);

  // 堆叠卡片跨类型替换提示(征集#9 增强拍板):node-view 无法访问 message,经 nodeActionBus 通知(message 为顶层 useApp 实例)
  useEffect(() => {
    const unsubscribe = nodeActionBus.on('stackReplaceTypeChanged', (event) => {
      const { type } = event;
      if (type === 'image' || type === 'video' || type === 'audio') {
        message.info(t('nodes.stackReplaceTypeChanged', { type: t(`toolbar.${type}`) }));
      }
    });
    return unsubscribe;
  }, [t, message]);

  // 堆叠收纳/合并提示(征集#9 验收 + 征集#25 拍板 A+B):
  // 批量场景(压力注入器/JSON 加载)一次触发大量 stackCollected,原实现每条独立 message 造成提示刷屏。
  // 现改为 1.5s 窗口合并 + 计数(单条仍保留 title 与「移出」撤销);
  // 窗口内事件数 ≥ STACK_TOAST_BATCH_THRESHOLD 判定为批量加载 → 完全静默(收纳动作照做、不提示)。
  useEffect(() => {
    const w = {
      count: 0, // 普通收纳数(可撤销)
      mergedCount: 0, // 跨类型合并数(无单卡撤销)
      lastNodeId: '',
      lastTitle: '',
      timer: 0,
      showTimer: 0,
      batch: false, // 本窗口是否批量(≥ 阈值)
    };
    const show = () => {
      const key = STACK_TOAST_KEY;
      const total = w.count + w.mergedCount;
      if (total === 1) {
        // 单条:保持原行为(含 title 与撤销按钮)
        const merged = w.mergedCount === 1;
        const label = merged
          ? t('nodes.stackMerged', { title: w.lastTitle })
          : t('nodes.stackCollected', { title: w.lastTitle });
        message.info({
          key,
          content: merged ? (
            label
          ) : (
            <span>
              {label}
              <a
                style={{ marginLeft: 8, fontWeight: 600 }}
                onClick={() => {
                  nodeActionBus.emit('stackUndoCollect', { nodeId: w.lastNodeId });
                  message.destroy(key);
                }}
              >
                {t('nodes.stackUndo')}
              </a>
            </span>
          ),
          duration: merged ? 3 : 5,
        });
        return;
      }
      // 多条:合并计数 + 最近一次可撤销
      message.info({
        key,
        content: (
          <span>
            {t('nodes.stackCollectedBatch', { count: total })}
            {w.count > 0 ? (
              <a
                style={{ marginLeft: 8, fontWeight: 600 }}
                onClick={() => {
                  nodeActionBus.emit('stackUndoCollect', { nodeId: w.lastNodeId });
                  message.destroy(key);
                }}
              >
                {t('nodes.stackUndo')}
              </a>
            ) : null}
          </span>
        ),
        duration: 5,
      });
    };
    const flush = () => {
      if (w.timer) window.clearTimeout(w.timer);
      if (w.showTimer) window.clearTimeout(w.showTimer);
      w.timer = 0;
      w.showTimer = 0;
      if (!w.batch) {
        show();
      } else {
        message.destroy(STACK_TOAST_KEY); // 批量:静默(若已显示首条则收回)
      }
      w.count = 0;
      w.mergedCount = 0;
      w.lastNodeId = '';
      w.lastTitle = '';
      w.batch = false;
    };
    const unsubscribe = nodeActionBus.on('stackCollected', (event) => {
      const { nodeId, title, merged } = event;
      if (!nodeId || typeof title !== 'string') return;
      if (merged) w.mergedCount += 1;
      else w.count += 1;
      w.lastNodeId = nodeId;
      w.lastTitle = title;
      if (w.count + w.mergedCount >= STACK_TOAST_BATCH_THRESHOLD) w.batch = true;
      if (w.timer === 0) {
        w.timer = window.setTimeout(flush, STACK_TOAST_WINDOW_MS);
        // 首条延迟显示:给批量判定留出窗口(批量场景完全静默,不闪现单条后消失)
        w.showTimer = window.setTimeout(() => {
          if (!w.batch) show();
        }, STACK_TOAST_DELAY_MS);
      }
    });
    return () => {
      unsubscribe();
      if (w.timer) window.clearTimeout(w.timer);
      if (w.showTimer) window.clearTimeout(w.showTimer);
    };
  }, [t, message]);

  return (
    <Layout style={layoutStyle(theme)}>
      <div style={mainRowStyle}>
      {/* 桌面端:画布结构(层级)侧边栏 — 全高占位,展开时同时推开顶部 NAV 与右侧内容区(沉浸式体验) */}
      {!state.loading && !isMobile && (dialogs.isHierarchyOpen || dialogs.isHierarchyClosing) && state.editor && refs.groupPlugin ? (
        <HierarchyPanelSidebar
          closing={dialogs.isHierarchyClosing}
          store={state.editor.store}
          groupPlugin={refs.groupPlugin}
          theme={theme}
          onClose={dialogs.toggleHierarchy}
          onFocusNode={(nodeId) => {
            const store = state.editor?.store;
            if (!store?.focusOnNode) return;
            const graph = store.getGraph();
            const selection = store.getSelection();
            // 多选聚焦：使用所有选中节点的联合边界
            const selectedIds = Array.from(selection.selectedNodeIds).filter((id) => {
              const n = graph.nodes.find((nd) => nd.id === id);
              return n && n.type !== 'group';
            });
            if (selectedIds.length > 1) {
              // 计算联合边界
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const id of selectedIds) {
                const node = graph.nodes.find((n) => n.id === id);
                if (!node) continue;
                if (node.type === 'group') {
                  const b = getGroupBoundsWithEmptyFallback(graph.nodes, id, interactions.getNodeSize);
                  if (b) {
                    minX = Math.min(minX, b.x);
                    minY = Math.min(minY, b.y);
                    maxX = Math.max(maxX, b.x + b.width);
                    maxY = Math.max(maxY, b.y + b.height);
                  }
                } else {
                  const size = interactions.getNodeSize(node as any);
                  minX = Math.min(minX, node.position.x);
                  minY = Math.min(minY, node.position.y);
                  maxX = Math.max(maxX, node.position.x + size.width);
                  maxY = Math.max(maxY, node.position.y + size.height);
                }
              }
              if (Number.isFinite(minX)) {
                const unionW = maxX - minX;
                const unionH = maxY - minY;
                store.focusOnBounds(
                  { x: minX, y: minY, width: unionW, height: unionH },
                  state.containerSize,
                  400,
                  51,
                );
                return;
              }
            }
            // 单节点聚焦
            const targetNode = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
            if (!targetNode) return;
            // 组节点使用 bounds 聚焦(含空组回退,避免聚焦到组 position 0,0 世界原点)
            if (targetNode.type === 'group') {
              const bounds = getGroupBoundsWithEmptyFallback(graph.nodes, nodeId, interactions.getNodeSize);
              if (bounds) {
                store.focusOnBounds(bounds, state.containerSize, 400, 51);
                return;
              }
            }
            // 普通节点聚焦
            const size = interactions.getNodeSize(targetNode as any);
            store.focusOnNode(nodeId, state.containerSize, size.width, size.height, 400, 51);
          }}
        />
      ) : null}
      <div style={mainColStyle}>
      <div style={headerStyle}>
        <TopBar
          title={dialogs.title}
          titleDraft={dialogs.titleDraft}
          isTitleEditing={dialogs.isTitleEditing}
          onTitleDraftChange={dialogs.setTitleDraft}
          onStartTitleEditing={() => { dialogs.setTitleDraft(dialogs.title); dialogs.setIsTitleEditing(true); }}
          onFinishTitleEditing={dialogs.handleFinishTitleEditing}
          onCancelTitleEditing={() => dialogs.setIsTitleEditing(false)}
          agentOpen={agentDockOpen}
          onToggleAgent={() => {
            dialogs.setAgentOpen((v: boolean) => !v);
            // 同步到 AgentDock 的 zustand store
            import('@/features/canvas-agent/ui/store.js').then(m =>
              m.useCanvasAgentStore.getState().toggleDock()
            );
          }}
          gridStyle={dialogs.background}
          onGridStyleChange={dialogs.setBackground}
          onOpenSettings={dialogs.onOpenSettings}
          isMobile={isMobile}
          onMobileNavOpen={() => dialogs.setMobileNavOpen(true)}
          onOpenCollaboration={dialogs.onOpenCollaboration}
          // R2-8: 协作聊天面板入口已并入 AgentDock 页签，Nav 按钮移除
          onSaveVersion={dialogs.onSaveVersion}
          onOpenVersionHistory={dialogs.onOpenVersionHistory}
          keyboardShortcuts={keyboardShortcuts}
          syncBadge={
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CreationSyncBadge
                status={status === 'syncing' ? 'saving' : status === 'error' ? 'error' : status === 'inactive' ? 'unsaved' : 'idle'}
                lastSavedAt={null}
                theme={theme}
                compact
              />
              {/* 云端更新红点徽标 */}
              {cloudUpdateAvailable && (
                <Tooltip title={t('editor.cloudUpdateTooltip')}>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await fullSync();
                          clearCloudUpdateAvailable();
                        } catch (err) {
                          console.error('[EditorPage] sync failed:', err);
                        }
                      })();
                    }}
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      backgroundColor: '#ef4444', border: 'none',
                      cursor: 'pointer', flexShrink: 0, padding: 0,
                    }}
                    aria-label={t('editor.cloudUpdateAvailable')}
                  />
                </Tooltip>
              )}
            </div>
          }
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          onUndo={actions.undo}
          onRedo={actions.redo}
          canvasMenu={
            <CanvasMenu
              theme={theme}
              onHome={onBack}
              onNewProject={() => void dialogs.handleNewProject()}
              onCopyProject={() => void dialogs.handleCopyProject()}
              onDeleteProject={() => void dialogs.handleMenuDeleteProject()}
            />
          }
        />
      </div>

      <Layout.Content style={contentLayoutStyle}>
        <div style={flexContainerStyle}>
          {/* 画布区域(flex-1 自适应) */}
          <div ref={containerRef} style={canvasAreaStyle}>
            {state.loading ? (
              <LoadingOverlay background={theme.canvas.background} logoSize={48} onBackToHome={onBack} />
            ) : state.editor ? (
          <>
          <PinDefaultsProvider value={interactions.pinDefaults}>
          <NodeDefaultsProvider value={interactions.nodeDefaultsValue}>
          <GroupDefaultsProvider value={interactions.groupDefaultsValue}>
          <CanvasView
            store={state.editor.store}
            extensions={state.extensions}
            containerRef={containerRef}
            background={dialogs.background}
            backgroundColor={theme.canvas.background}
            gridDotColor={theme.canvas.gridDot}
            gridLineColor={theme.canvas.gridLine}
            gridSize={24}
            edgeColor={theme.edge.color}
            edgeSelectedColor={theme.edge.selectedColor}
            edgeHoverColor={theme.edge.hoverColor}
            mode={state.interactionMode}
            commandQueue={refs.commandQueue!}
            forceShowPins={interactions.forceShowPins}
            connectionHoverNodeId={interactions.connectionHoverNodeId}
            hoveredNodeId={interactions.hoveredNodeId}
            externalRenaming={renamingNodeId}
            onRenameFinish={() => setRenamingNodeId(null)}
            onCanvasPointerDown={handlers.onCanvasPointerDown}
            onNodePointerDown={handlers.onNodePointerDown}
            onNodePointerEnter={handlers.onNodePointerEnter}
            onNodePointerLeave={handlers.onNodePointerLeave}
            onNodeTouchStart={handlers.onNodeTouchStart}
            onNodeTouchEnd={handlers.onNodeTouchEnd}
            onNodeTouchMove={handlers.onNodeTouchMove}
            onEdgePointerDown={handlers.onEdgePointerDown}
            onResizeHandlePointerDown={handlers.onResizeHandlePointerDown}
            onCutEdge={interactions.handleCutEdge}
            onCanvasContextMenu={interactions.handleCanvasContextMenu}
            contextMenuItems={contextMenuItems}
            onCanvasDrop={dropHandlers.onDrop}
            onCanvasDragOver={dropHandlers.onDragOver}
            welcomeHint={t('editor.canvasHint')}
            onNodeDoubleClick={handleNodeDoubleClick}
            belowNodesLayer={
              refs.groupPlugin ? (
                <GroupLayer
                  store={state.editor.store}
                  controller={refs.groupPlugin.getController()}
                  getNodeSize={interactions.getNodeSize}
                  forceShowPins={interactions.forceShowPins}
                  onGroupPinPointerDown={handlers.onGroupPinPointerDown}
                  onGroupPinPointerEnter={handlers.onGroupPinPointerEnter}
                  onGroupPinPointerLeave={handlers.onGroupPinPointerLeave}
                  externalRenamingGroupId={renamingGroupId}
                  onRenameFinish={() => setRenamingGroupId(null)}
                  showHints={hintsEnabled}
                  onGroupDoubleClick={(groupId) => {
                    const store = state.editor?.store;
                    if (!store?.focusOnNode) return;
                    const graph = store.getGraph();
                    const targetNode = graph.nodes.find((n) => n.id === groupId);
                    if (!targetNode) return;
                    const bounds = getGroupBoundsWithEmptyFallback(graph.nodes, groupId, interactions.getNodeSize);
                    if (bounds) {
                      store.focusOnBounds(bounds, state.containerSize, 400, 51);
                    }
                  }}
                />
              ) : null
            }
          >
            {refs.selectionController && refs.connectionController ? (
              <CanvasOverlays
                store={state.editor.store}
                selectionController={refs.selectionController}
                connectionController={refs.connectionController}
              />
            ) : null}
            {/* 协作覆盖层:远端光标 + 远端选中节点高亮 */}
            {/* 调色调试:临时去掉 collaborationActive 门控,overlay 常驻,方便定位房间/光标问题 */}
            <CollabOverlay
              store={state.editor.store}
              theme={theme}
              extensions={state.extensions}
            />
            {/* R3-D1: Agent 操作光标 + 聚焦高亮（操作级低频，3.5s 自动淡出） */}
            <AgentCursorOverlay store={state.editor.store} />
          </CanvasView>
          </GroupDefaultsProvider>
          </NodeDefaultsProvider>
          </PinDefaultsProvider>
          {/* 内容信标(征集#45):远离内容区时画布四周显示游戏任务指示点,点击回到内容丰富区 */}
          {!state.loading && state.editor && (
            <ContentBeacon store={state.editor.store} containerSize={state.containerSize} />
          )}
          {/* 情境化快捷键面板(游戏式 Contextual Controls,随上下文动态显隐) */}
          {!state.loading && (
          <ContextualShortcutsPanel
            isGroupPreviewing={state.isGroupPreviewing}
            singleSelected={state.selectedCount === 1}
            singleSelectedInGroup={state.selectedInGroup}
            createMenuOpen={!!nodeCreateMenuPos}
            isStackedMedia={(state.selectedNodeType as string) === 'stacked-media'}
            stackHasCards={stackHasCards}
            hasIncomingPreviews={hasIncomingPreviews}
            isStackableMedia={isStackableMedia}
            selectedNodeType={state.selectedNodeType as string | null}
            canvasHasNodes={!!state.editor && state.editor.store.getGraph().nodes.length > 0}
            transient={refs.interactionController}
            keyboardShortcuts={keyboardShortcuts}
          />
          )}
          {/* Plan#20 T12a/T12b: 合并/拆分主体 Modal(事件驱动,useEditorInteractions 渲染) */}
          {interactions.subjectModals}
          {nodeCreateMenuPos ? (
            <NodeCreateMenu
              position={nodeCreateMenuPos}
              onSelect={interactions.handleNodeCreateMenuSelect}
              onClose={() => setNodeCreateMenuPos(null)}
              theme={theme}
              extraItems={[
                { key: 'reset-view', label: t('toolbar.resetView'), icon: <EDITOR_ICONS.resetView size={14} />, onClick: handleResetView },
                ...(hasClipboardContent() && state.editor
                  ? [{ key: 'paste', label: t('editor.paste'), icon: <ClipboardPaste size={14} />, onClick: () => {
                    pasteClipboard(state.editor!.store, state.editor!.core.commandQueue);
                  }}]
                  : []),
              ]}
            />
          ) : null}
        </>
        ) : null}

        {!state.loading && (
        <LeftSideToolBar
          scale={state.scale}
          onScaleChange={actions.setScale}
          isMiniMapOpen={dialogs.isMiniMapOpen}
          onToggleMiniMap={() => dialogs.setIsMiniMapOpen((v: boolean) => !v)}
          isHierarchyOpen={dialogs.isHierarchyOpen}
          onToggleHierarchy={dialogs.toggleHierarchy}
          onClear={dialogs.handleClearCanvasClick}
          onOpenMyAssets={() => dialogs.setAssetPickerOpen(true)}
          interactionMode={state.interactionMode}
          onToggleInteractionMode={actions.toggleInteractionMode}
          isMobile={isMobile}
          onAddNode={actions.addNode}
        />
        )}

        {/* 跟随节点的悬浮白色胶囊工具栏(通用组件) */}
        {!state.loading && state.editor && interactions.toolContext ? (
          <NodeCapsuleToolbar
            nodeId={state.isGroupPreviewing ? null : state.selectedNodeId}
            store={state.editor.store}
            getExtension={interactions.getExtension}
            toolContext={interactions.toolContext}
            getGroupTools={interactions.getGroupTools}
            selectedCount={state.selectedCount}
            showMoveOut={state.selectedInGroup}
            onMoveOutGroup={interactions.handleMoveOutGroup}
            isPreview={state.isGroupPreviewing}
            isMixedSelection={state.isMixedSelection}
            getAnchorBounds={interactions.getAnchorBounds}
            node={state.isGroupPreviewing ? interactions.previewGroupNode : undefined}
            onGroup={actions.groupSelected}
            onArrangeGrid={() => interactions.handleArrange('grid')}
            onArrangeHorizontal={() => interactions.handleArrange('horizontal')}
            onArrangeVertical={() => interactions.handleArrange('vertical')}
            onArrangeAuto={() => interactions.handleArrange('auto')}
            onAlign={(type: string) => interactions.handleAlign(type as any)}
            onUnifySizes={(type: string) => interactions.handleUnifySizes(type as any)}
            onSort={(type: string) => refs.layoutController?.sortSelection(type as any)}
            onStackSelected={interactions.handleStackSelected}
            /**
             * usePureIcon - 纯图标模式开关
             * false（默认）: icon + 文本标签
             * true: 仅显示 icon，隐藏文本标签
             * 后续如需切换纯 icon 模式，使用此 prop 传入 true 即可。
             */
            // usePureIcon={false}
          />
        ) : null}

        {import.meta.env.DEV && !state.loading && state.editor ? (
          <DevPerformancePanel store={state.editor.store} commandQueue={refs.commandQueue} syncStatus={status} />
        ) : null}

        {/* BUG5: RightSideToolBar 已移除 — 节点创建功能并入 LeftSideToolBar 加号菜单 */}

        {/* 移动端:画布结构抽屉(从右侧滑入) */}
        {!state.loading && isMobile && state.editor && refs.groupPlugin ? (
          <MobileHierarchyDrawer
            open={dialogs.isHierarchyOpen}
            store={state.editor.store}
            groupPlugin={refs.groupPlugin}
            theme={theme}
            onClose={dialogs.toggleHierarchy}
            onFocusNode={(nodeId) => {
              const store = state.editor?.store;
              if (!store?.focusOnNode) return;
              const graph = store.getGraph();
              const targetNode = graph.nodes.find((n) => n.id === nodeId);
              if (!targetNode) return;
              const w = targetNode.size?.width ?? 200;
              const h = targetNode.size?.height ?? 200;
              store.focusOnNode(nodeId, state.containerSize, w, h, 400, 51);
            }}
          />
        ) : null}

        {/* 小地图(桌面端右下角 / 移动端左下角上移,isMiniMapOpen 时显示) */}
        {!state.loading && dialogs.isMiniMapOpen && state.editor && refs.nodesPlugin ? (
          <div style={isMobile ? mobileMinimapWrapStyle : minimapWrapStyle}>
            <MinimapView
              store={state.editor.store}
              registry={refs.nodesPlugin.getRegistry()}
              viewportSize={state.containerSize}
              onViewportChange={(vp) => state.editor?.store.setViewport(vp)}
              nodeFilter={interactions.minimapNodeFilter}
            />
          </div>
        ) : null}

        {/* 节点生成面板(吸附在选中节点正下方,生成器同款 UI)
            三态:media 资源态(有内容)隐藏,空节点/生成器态/生成中显示 */}
        {!state.loading && state.editor && state.selectedNodeId && state.selectedNodeType && state.selectedNodeType !== 'script' && state.selectedNodeType !== 'storyboard' && state.selectedNodeType !== 'workbench' && nodeDockVisible ? (
          <NodeGenerateDock
            nodeId={state.selectedNodeId}
            nodeType={state.selectedNodeType as 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media'}
            store={state.editor.store}
            getAnchorBounds={interactions.getAnchorBounds}
            node={state.selectedNodeData}
            isMobile={isMobile}
            isRunning={isPromptRunning}
            initialPrompt={(selectedNodeData?.prompt as string) ?? ''}
            onPromptChange={interactions.handlePromptChange}
            onGenerate={interactions.handlePromptGenerate}
            onStop={interactions.handlePromptStop}
            configMode={interactions.selectedConfigMode}
            model={(selectedNodeData?.model as string) ?? ''}
            onConfigChange={interactions.handleNodeConfigChange}
            paramValues={(selectedNodeData?.paramValues as Record<string, any>) ?? {}}
          />
        ) : null}

        <AssetLibraryModal
          open={dialogs.assetPickerOpen}
          onClose={() => dialogs.setAssetPickerOpen(false)}
          onSendToCanvas={dialogs.handleAssetInsert as unknown as (item: any) => void}
        />

        <AssetDetailViewer
          node={dialogs.detailNode}
          onClose={() => dialogs.setDetailNode(null)}
        />
        </div>
      </div>
      </Layout.Content>
      </div>
      {/* Agent Dock（右侧可收起面板，推开整个 nav+content）
          注入画布上下文:供 Agent @ 提及弹窗实时读取画布节点 */}
      {!state.loading && !isMobile && (
        <CanvasContextProvider
          value={{
            getNodes: () => {
              const store = state.editor?.store;
              if (!store) return [];
              return store.getGraph().nodes.map((n) => {
                const data = n.data as { title?: string; storageKey?: string } | null | undefined;
                return {
                  id: n.id,
                  title: n.title || data?.title || n.type,
                  type: n.type,
                  // 媒体节点缩略图解析依赖 storageKey（@ 提及浮层/引用徽标展示用）
                  storageKey: typeof data?.storageKey === 'string' ? data.storageKey : undefined,
                };
              });
            },
            getSelectedNodeId: () => {
              const ids = state.editor?.store.getSelection().selectedNodeIds;
              return ids && ids.size > 0 ? ([...ids][0] ?? null) : null;
            },
          }}
        >
          <AgentDock projectId={canvasId} />
        </CanvasContextProvider>
      )}
      </div>

      {/* 设置弹窗(画布样式) */}
      <ConfigDialog
        open={dialogs.settingsOpen}
        onClose={() => dialogs.setSettingsOpen(false)}
        theme={theme}
        config={dialogs.canvasConfig}
        onConfirm={dialogs.onCanvasConfigConfirm}
      />

      {/* 图片编辑独立对话框 */}
      {dialogs.imageDialog && refs.commandQueue ? (
        <ImageDialogRenderer
          state={dialogs.imageDialog}
          commandQueue={refs.commandQueue}
          theme={theme}
          onClose={() => dialogs.setImageDialog(null)}
          onNodesCreated={(nodeIds: string[]) => {
            // 切图后自动成组:选中节点 → 触发预览 → 确认成组
            if (!refs.store || !refs.groupPlugin || nodeIds.length < 2) return;
            const ctrl = refs.groupPlugin.getController();
            refs.store.setSelection({
              selectedNodeIds: new Set(nodeIds),
              selectedEdgeIds: new Set(),
            });
            // setSelection 同步触发 SelectionEvents.CHANGED → createPreview 同步执行
            // 确认预览组(如果已创建)
            if (ctrl.isPreviewing()) {
              ctrl.confirmPreview(t('groupTools.defaultGroupName'));
            }
          }}
          onGetNodeTitle={(type: string, batchIndex = 0, baseCount?: number) => {
            if (!refs.store) return '';
            const graph = refs.store.getGraph();
            // baseCount 由切图等批量操作传入,避免循环中 graph 动态更新导致跳号
            const sameTypeCount = baseCount ?? graph.nodes.filter((n) => n.type === type).length;
            const baseNameKey =
              type === 'text' ? 'nodeTypes.text'
                : type === 'image' ? 'nodeTypes.ai.image'
                  : type === 'video' ? 'nodeTypes.ai.video'
                    : type === 'audio' ? 'nodeTypes.ai.audio'
                      : 'nodes.generatorTitle';
            return `${t(baseNameKey)}${sameTypeCount + 1 + batchIndex}`;
          }}
        />
      ) : null}

      {/* P2.1 ② replace 图片/视频/音频:隐藏文件输入(由 replace 工具触发 click) */}
      <input
        ref={dialogs.replaceInputRef}
        type="file"
        accept={dialogs.replaceAccept}
        style={{ display: 'none' }}
        onChange={interactions.handleReplaceFileChange}
      />

      {/* 组样式设置弹窗(背景色+透明度+圆角) */}
      {dialogs.groupStyleDialog && refs.groupPlugin ? (
        <GroupStyleDialog
          currentBgColor={dialogs.groupStyleDialog.currentBgColor}
          currentOpacity={dialogs.groupStyleDialog.currentOpacity}
          currentRadius={dialogs.groupStyleDialog.currentRadius}
          theme={theme}
          onClose={() => dialogs.setGroupStyleDialog(null)}
          onApply={(bgColor: string | undefined, opacity: number | undefined, radius: number | undefined) => {
            const ctrl = refs.groupPlugin!.getController();
            ctrl.setGroupBackground(dialogs.groupStyleDialog!.groupId, bgColor || undefined);
            ctrl.setNodeAppearance(dialogs.groupStyleDialog!.groupId, { opacity: typeof opacity === 'number' ? opacity : undefined });
            ctrl.setGroupBorderRadius(dialogs.groupStyleDialog!.groupId, typeof radius === 'number' ? radius : undefined);
          }}
        />
      ) : null}

      {/* 连线释放菜单(从 Pin 拖拽到空白区域松手时弹出) */}
      {dialogs.connectionDrop && refs.commandQueue ? (
        <ConnectionDropMenu
          commandQueue={refs.commandQueue}
          source={dialogs.connectionDrop.source}
          screenX={dialogs.connectionDrop.screenX}
          screenY={dialogs.connectionDrop.screenY}
          worldX={dialogs.connectionDrop.worldX}
          worldY={dialogs.connectionDrop.worldY}
          theme={theme}
          onClose={() => dialogs.setConnectionDrop(null)}
          connectionController={refs.connectionController}
        />
      ) : null}

      {/* P1.3 数据安全核心组:确认弹窗 */}
      {/* #4 删除当前画布 */}
      <ConfirmDialog
        open={dialogs.confirmDeleteProject}
        title={t('confirm.deleteCanvasTitle')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => dialogs.setConfirmDeleteProject(false)}
        onConfirm={() => void dialogs.doDeleteProject()}
      >
        {t('confirm.deleteCanvasMessage')}
      </ConfirmDialog>

      {/* #5 清空画布 */}
      <ConfirmDialog
        open={dialogs.confirmClearCanvas}
        title={t('confirm.clearCanvasTitle')}
        confirmLabel={t('toolbar.clear')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => dialogs.setConfirmClearCanvas(false)}
        onConfirm={dialogs.doClearCanvas}
      >
        {t('confirm.clearCanvasMessage')}
      </ConfirmDialog>

      {/* #7 删除组 */}
      <ConfirmDialog
        open={dialogs.confirmDeleteGroupId !== null}
        title={t('confirm.deleteGroupTitle')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => dialogs.setConfirmDeleteGroupId(null)}
        onConfirm={() => {
          if (dialogs.confirmDeleteGroupId && refs.groupPlugin) {
            refs.groupPlugin.getController().deleteSceneNode(dialogs.confirmDeleteGroupId);
          }
          dialogs.setConfirmDeleteGroupId(null);
        }}
      >
        {t('confirm.deleteGroupMessage')}
      </ConfirmDialog>

      {/* 批量上传队列覆盖层 */}
      <UploadQueueOverlay onRetryFailed={processFiles} />

      {/* 同步冲突弹窗(云端版本不一致 / 云端已删除时弹出,用户选择"拉取云端"或"推送本地") */}
      {conflict ? (
        <SyncConflictDialog
          conflict={conflict}
          theme={theme}
          onPullCloud={onPullCloud}
          onPushLocal={onPushLocal}
          onClose={onConflictClose}
        />
      ) : null}

      {/* 协作管理弹窗(邀请码/成员/权限管理,由 TopBar 协作按钮触发) */}
      {!state.loading && (
        <CollaborationModal
          open={dialogs.collaborationOpen}
          canvasId={canvasId}
          pendingInviteCode={inviteCode}
          onClose={() => dialogs.setCollaborationOpen(false)}
          theme={theme}
          onNavigateToCanvas={onOpenProject}
        />
      )}

      {/* 版本快照弹窗(保存版本 + 版本历史 + 回退,由 TopBar 按钮或 Ctrl+S 触发) */}
      {!state.loading && (
        <VersionDialogs
          canvasId={canvasId}
          nodeCount={refs.store?.getGraph().nodes.length ?? 0}
          saveOpen={dialogs.versionSaveOpen}
          historyOpen={dialogs.versionHistoryOpen}
          onSaveClose={() => dialogs.setVersionSaveOpen(false)}
          onHistoryClose={() => dialogs.setVersionHistoryOpen(false)}
          theme={theme}
        />
      )}

      {/* 移动端统一浮动导航按钮(与主页/创作/画布列表保持位置一致) */}
      {isMobile && (
        <MobileNavFloatingWrapper>
          <MobileNavButton onClick={() => dialogs.setMobileNavOpen(true)} />
        </MobileNavFloatingWrapper>
      )}

      {/* 移动端统一导航抽屉(与主页/创作/画布列表共享框架) */}
      {isMobile && (
        <MobileNavDrawer
          theme={theme}
          open={dialogs.mobileNavOpen}
          onClose={() => dialogs.setMobileNavOpen(false)}
          projectActions={dialogs.mobileNavProjectActions}
          onProjectAction={dialogs.handleMobileProjectAction}
          onToggleAgent={() => {
            dialogs.setAgentOpen((v: boolean) => !v);
            import('@/features/canvas-agent/ui/store.js').then(m =>
              m.useCanvasAgentStore.getState().toggleDock()
            );
          }}
          onOpenShortcuts={() => dialogs.setMobileShortcutsOpen(true)}
          onOpenSettings={() => dialogs.onOpenSettings()}
          onOpenAppearance={() => dialogs.setMobileAppearanceOpen(true)}
          onOpenLanguage={() => setMobileLanguageOpen(true)}
          isAuthenticated={isAuthenticated}
          onLogout={async () => {
            await logout();
            onBack();
          }}
        />
      )}

      {/* 移动端换肤弹窗(由 MobileNavDrawer 触发) */}
      {isMobile && dialogs.mobileAppearanceOpen ? (
        <AppearanceDialog
          theme={theme}
          currentMode={theme.mode}
          gridStyle={dialogs.background}
          onGridStyleChange={dialogs.setBackground}
          onClose={() => dialogs.setMobileAppearanceOpen(false)}
        />
      ) : null}

      {/* 移动端语言弹窗(由 MobileNavDrawer 触发) */}
      {isMobile && mobileLanguageOpen ? (
        <LanguageDialog
          theme={theme}
          currentLang={(i18n.language as any) || 'zh'}
          onClose={() => setMobileLanguageOpen(false)}
        />
      ) : null}

      {/* 移动端快捷键弹窗(由 MobileNavDrawer 触发) */}
      {isMobile && dialogs.mobileShortcutsOpen ? (
        <ShortcutsDialog
          theme={theme}
          onClose={() => dialogs.setMobileShortcutsOpen(false)}
          isMobile={isMobile}
          shortcuts={keyboardShortcuts}
        />
      ) : null}
    </Layout>
  );
}

function layoutStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  return { position: 'relative', height: '100%', overflow: 'hidden', background: theme.canvas.background };
}
const headerStyle: CSSProperties = { height: 54, background: 'transparent', padding: 0, lineHeight: '54px', position: 'relative', zIndex: 100 };
const contentLayoutStyle: CSSProperties = { position: 'relative', overflow: 'hidden' };
const flexContainerStyle: CSSProperties = { display: 'flex', width: '100%', height: '100%', overflow: 'hidden' };
// 顶层行布局:层级侧边栏(全高) + 右列(TopBar + 内容),抽屉展开时 NAV 与内容同时被推开
const mainRowStyle: CSSProperties = { display: 'flex', flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' };
const mainColStyle: CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 };
const canvasAreaStyle: CSSProperties = { flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden' };
// BUG3b: 小地图移到右下角,避免被左侧工具栏(LeftSideToolBar)遮挡
const minimapWrapStyle: CSSProperties = {
  position: 'absolute', right: 20, bottom: 20, zIndex: 40,
  width: 240, height: 160,
  borderRadius: 12, overflow: 'hidden',
  border: `1px solid rgba(255,255,255,0.1)`,
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};
// 移动端:小地图放左下角并上移,避开底部横向工具栏
// zIndex 提高到 250,确保显示在 LeftSideToolBar(zIndex 200)之上
const mobileMinimapWrapStyle: CSSProperties = {
  position: 'absolute', left: 12, bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 72px)', zIndex: 250,
  width: 200, height: 140,
  borderRadius: 12, overflow: 'hidden',
  border: `1px solid rgba(255,255,255,0.1)`,
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};
