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
import { useHintsEnabled } from '@/shared/hints/hints-settings.js';
import { SyncConflictDialog } from '@/features/sync-conflict-dialog/sync-conflict-dialog.js';
import { CollaborationModal } from '@/features/collaboration/collaboration-modal.js';
import { CollaborationPanel } from '@/features/collaboration/collaboration-panel.js';
import { CollabOverlay } from '@/features/collaboration/collab-overlay.js';
import { PromptPanel } from '@/features/prompt-panel/index.js';
import { AssetLibraryModal } from '@/features/asset-library/index.js';
import { AgentDock } from '@/features/canvas-agent/ui/index.js';
import { useAssets } from '@/features/asset-picker/index.js';
import { HierarchyPanelSidebar } from '@/features/hierarchy/index.js';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
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

export interface EditorPageProps {
  canvasId: string;
  /** 协作邀请码(来自 /c/<code> 邀请链接解析,用于自动申请加入房间) */
  inviteCode?: string;
  onBack: () => void;
  onOpenProject: (id: string) => void;
}

export function EditorPage({ canvasId, inviteCode, onBack, onOpenProject }: EditorPageProps): React.ReactElement {
  const { state, actions, refs, containerRef, cloudUpdateAvailable, clearCloudUpdateAvailable, conflict, onPullCloud, onPushLocal, onConflictClose } = useEditorState(canvasId);
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
  const handlers = useCanvasHandlers(refs, containerRef);

  // 双击节点缩放
  const handleNodeDoubleClick = useCallback((nodeId: string, width: number, height: number) => {
    const store = state.editor?.store;
    if (!store?.focusOnNode) return;
    store.focusOnNode(nodeId, state.containerSize, width, height, 400, 51);
  }, [state.editor?.store, state.containerSize]);

  // Ctrl+Shift+G 可否收纳为版本文件夹:选中 ≥2 个图片节点(与 createVersionFolder 真实条件一致)
  const canVersionFolder = (() => {
    const store = state.editor?.store;
    if (!store || state.selectedCount < 2) return false;
    const selected = store.getSelection().selectedNodeIds;
    const graph = store.getGraph();
    let imageCount = 0;
    for (const id of selected) {
      const n = graph.nodes.find((nd: NodeRecord) => nd.id === id);
      if (n?.type === 'image') imageCount++;
    }
    return imageCount >= 2;
  })();

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
                const padding = 0.82;
                const targetK = Math.min(
                  (state.containerSize.width / unionW) * padding,
                  (state.containerSize.height / (unionH + 51)) * padding,
                  2.0,
                );
                const cx = state.containerSize.width / 2;
                const cy = state.containerSize.height / 2;
                const centerX = minX + unionW / 2;
                const centerY = minY + unionH / 2;
                store.animateViewport(cx - centerX * targetK, cy - centerY * targetK, targetK, 400);
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
                const padding = 0.82;
                const targetK = Math.min(
                  (state.containerSize.width / bounds.width) * padding,
                  (state.containerSize.height / (bounds.height + 51)) * padding,
                  2.0,
                );
                const cx = state.containerSize.width / 2;
                const cy = state.containerSize.height / 2;
                const centerX = bounds.x + bounds.width / 2;
                const centerY = bounds.y + bounds.height / 2;
                store.animateViewport(cx - centerX * targetK, cy - centerY * targetK, targetK, 400);
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
          agentOpen={dialogs.agentOpen}
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
          onSaveVersion={dialogs.onSaveVersion}
          onOpenVersionHistory={dialogs.onOpenVersionHistory}
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
                      const padding = 0.82;
                      const targetK = Math.min(
                        (state.containerSize.width / bounds.width) * padding,
                        (state.containerSize.height / (bounds.height + 51)) * padding,
                        2.0,
                      );
                      const cx = state.containerSize.width / 2;
                      const cy = state.containerSize.height / 2;
                      const centerX = bounds.x + bounds.width / 2;
                      const centerY = bounds.y + bounds.height / 2;
                      store.animateViewport(cx - centerX * targetK, cy - centerY * targetK, targetK, 400);
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
          </CanvasView>
          </GroupDefaultsProvider>
          </NodeDefaultsProvider>
          </PinDefaultsProvider>
          {/* 情境化快捷键面板(游戏式 Contextual Controls,随上下文动态显隐) */}
          {!state.loading && (
          <ContextualShortcutsPanel
            isGroupPreviewing={state.isGroupPreviewing}
            singleSelected={state.selectedCount === 1}
            singleSelectedInGroup={state.selectedInGroup}
            createMenuOpen={!!nodeCreateMenuPos}
            selectionHasGroup={state.selectedHasGroup}
            canVersionFolder={canVersionFolder}
            isStackedMedia={(state.selectedNodeType as string) === 'stacked-media'}
            stackHasCards={stackHasCards}
            hasIncomingPreviews={hasIncomingPreviews}
            isStackableMedia={isStackableMedia}
            transient={refs.interactionController}
          />
          )}
          {nodeCreateMenuPos ? (
            <NodeCreateMenu
              position={nodeCreateMenuPos}
              onSelect={interactions.handleNodeCreateMenuSelect}
              onClose={() => setNodeCreateMenuPos(null)}
              theme={theme}
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
            selectedHasGroup={state.selectedHasGroup}
            showMoveOut={state.selectedInGroup}
            onMoveOutGroup={interactions.handleMoveOutGroup}
            isPreview={state.isGroupPreviewing}
            isMixedSelection={state.isMixedSelection}
            getAnchorBounds={interactions.getAnchorBounds}
            node={state.isGroupPreviewing ? interactions.previewGroupNode : undefined}
            onGroup={actions.groupSelected}
            onUngroup={actions.ungroupSelected}
            onArrangeGrid={() => interactions.handleArrange('grid')}
            onArrangeHorizontal={() => interactions.handleArrange('horizontal')}
            onArrangeVertical={() => interactions.handleArrange('vertical')}
            onArrangeAuto={() => interactions.handleArrange('auto')}
            onAlign={(type: string) => interactions.handleAlign(type as any)}
            onUnifySizes={(type: string) => interactions.handleUnifySizes(type as any)}
            onSort={(type: string) => refs.layoutController?.sortSelection(type as any)}
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

        {/* 节点提示词面板(选中单个文本/图片/视频/音频节点时显示;剧创节点无提示词面板) */}
        {!state.loading && state.selectedNodeId && state.selectedNodeType && state.selectedNodeType !== 'script' && state.selectedNodeType !== 'storyboard' && state.selectedNodeType !== 'workbench' ? (
          <div style={isMobile ? mobilePromptPanelWrapStyle : promptPanelWrapStyle}>
            <PromptPanel
              nodeId={state.selectedNodeId}
              nodeType={state.selectedNodeType as 'text' | 'image' | 'video' | 'audio' | 'generator'}
              isRunning={isPromptRunning}
              initialPrompt={(selectedNodeData?.prompt as string) ?? ''}
              onPromptChange={interactions.handlePromptChange}
              onGenerate={interactions.handlePromptGenerate}
              onStop={interactions.handlePromptStop}
              configMode={interactions.selectedConfigMode}
              composerDescription={interactions.selectedComposerDescription}
              references={interactions.selectedReferences}
              model={(selectedNodeData?.model as string) ?? ''}
              onConfigChange={interactions.handleNodeConfigChange}
              onOpenAiConfig={() => { dialogs.setSettingsOpen(true); }}
              imageQuality={(selectedNodeData?.quality as string) ?? undefined}
              imageSize={(selectedNodeData?.size as string) ?? undefined}
              imageCount={typeof selectedNodeData?.count === 'number' ? (selectedNodeData.count as number) : undefined}
              videoVquality={(selectedNodeData?.vquality as string) ?? undefined}
              videoSize={(selectedNodeData?.size as string) ?? undefined}
              videoSeconds={typeof selectedNodeData?.seconds === 'number' ? (selectedNodeData.seconds as number) : undefined}
              videoGenerateAudio={typeof selectedNodeData?.generateAudio === 'boolean' ? (selectedNodeData.generateAudio as boolean) : undefined}
              videoWatermark={typeof selectedNodeData?.watermark === 'boolean' ? (selectedNodeData.watermark as boolean) : undefined}
              videoMode={(selectedNodeData?.videoMode as string) ?? undefined}
              audioVoice={(selectedNodeData?.voice as string) ?? undefined}
              audioFormat={(selectedNodeData?.audioFormat as string) ?? undefined}
              audioSpeed={typeof selectedNodeData?.audioSpeed === 'number' ? (selectedNodeData.audioSpeed as number) : undefined}
              audioInstructions={(selectedNodeData?.audioInstructions as string) ?? undefined}
            />
          </div>
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
      {/* Agent Dock（右侧可收起面板，推开整个 nav+content） */}
      {!state.loading && !isMobile && (
        <AgentDock projectId={canvasId} />
      )}
      </div>

      {/* 设置弹窗(画布样式) */}
      <ConfigDialog
        open={dialogs.settingsOpen}
        onClose={() => dialogs.setSettingsOpen(false)}
        theme={theme}
        config={dialogs.canvasConfig}
        onConfirm={dialogs.onCanvasConfigConfirm}
        onPreview={dialogs.onCanvasConfigPreview}
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
        />
      )}

      {/* 协作聊天/成员面板(Dock,由 TopBar 协作聊天按钮开关) */}
      {!state.loading && (
        <CollaborationPanel
          open={dialogs.collaborationDockOpen}
          onClose={() => dialogs.setCollaborationDockOpen(false)}
          theme={theme}
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
const promptPanelWrapStyle: CSSProperties = {
  position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
  zIndex: 40, width: 480, maxWidth: 'calc(100% - 32px)',
};
// 移动端:上移避开底部 LeftSideToolBar(底部安全区 + 工具栏高度)
const mobilePromptPanelWrapStyle: CSSProperties = {
  position: 'absolute', bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 60px)', left: 12, right: 12,
  transform: 'none', zIndex: 40, width: 'auto', maxWidth: 'none',
};
