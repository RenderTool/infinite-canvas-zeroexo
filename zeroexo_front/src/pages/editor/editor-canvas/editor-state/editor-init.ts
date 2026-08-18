/**
 * editor-init - 编辑器初始化 + 扩展注册 + 全局事件
 *
 * 在 useEffect 中调用,返回 editor 实例及清理函数。
 * 闭包变量(isInitialized / suppressNextSync)通过 syncState 对象桥接。
 */

import { createDefaultEditor } from '@zeroexo/preset-default';
import type { DefaultEditor } from '@zeroexo/preset-default';
import type { NodeTypeExtension, NodeRecord } from '@zeroexo/core';
import { getLeafDescendants } from '@zeroexo/plugin-group';
import type { GroupPinExpander } from '@zeroexo/plugin-connection';
import { ProxyProvider } from '@zeroexo/plugin-ai-provider';
import { apiFetch } from '@/services/api-client.js';
import i18n from '@/i18n/config';
import { createCreationExtensions } from '@/features/canvas-nodes/extensions.js';
import { canConnect } from '@/shared/connection-rules.js';
import type { NodeSizeMeta } from '@zeroexo/plugin-layout';
import type React from 'react';

export interface EditorInitResult {
  editor: DefaultEditor;
  extMap: Map<string, NodeTypeExtension>;
  getNodeSize: (node: NodeRecord) => NodeSizeMeta;
  cleanup: () => void;
}

export interface InitCallbacks {
  setContainerSize: (size: { width: number; height: number }) => void;
  setEditor: (editor: DefaultEditor | null) => void;
  setIsGroupPreviewing: (previewing: boolean) => void;
  setScaleState: (scale: number) => void;
  setInteractionMode: (mode: 'select' | 'pan') => void;
}

export function createEditorInstance(
  canvasId: string,
  containerRef: React.RefObject<HTMLDivElement>,
  callbacks: InitCallbacks,
): EditorInitResult {
  const { setContainerSize, setEditor, setIsGroupPreviewing, setScaleState, setInteractionMode } = callbacks;

  // P3.4: 注入 ProxyProvider,所有 AI 生成请求经后端 /api/ai/generate 代理
  const aiProvider = new ProxyProvider(apiFetch, () => i18n.language);
  const ed = createDefaultEditor({
    container: containerRef.current!,
    storageKey: 'zeroexo:graph',
    aiProvider,
  });
  const store = ed.store;

  // 设置项目 ID(per-project graph 存储)
  ed.plugins.persistence?.setProjectId(canvasId);

  // Phase 2: 注册剧创节点(剧本/分镜/出片)
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
  resizeObserver.observe(containerRef.current!);

  // 注入节点尺寸访问器给 group/layout 插件
  const extMap = new Map(ed.plugins.nodes.all().map((e) => [e.type, e]));
  const getNodeSize = (node: NodeRecord): NodeSizeMeta => {
    if (node.size) {
      const ext = extMap.get(node.type);
      return {
        width: node.size.width,
        height: node.size.height,
        defaultSize: ext?.defaultSize,
        lockAspectRatio: ext?.lockAspectRatio,
        resizable: ext?.resizable,
      };
    }
    if (node.bounds) {
      const ext = extMap.get(node.type);
      return {
        width: node.bounds.width,
        height: node.bounds.height,
        defaultSize: ext?.defaultSize,
        lockAspectRatio: ext?.lockAspectRatio,
        resizable: ext?.resizable,
      };
    }
    const ext = extMap.get(node.type);
    if (ext?.defaultSize) {
      return {
        width: ext.defaultSize.width,
        height: ext.defaultSize.height,
        defaultSize: ext.defaultSize,
        lockAspectRatio: ext.lockAspectRatio,
        resizable: ext.resizable,
      };
    }
    return { width: 200, height: 100 };
  };
  ed.plugins.group?.getController().setNodeSizeAccessor(getNodeSize);
  ed.plugins.layout?.getController().setNodeSizeAccessor(getNodeSize);

  // 订阅 GroupController 状态变化(预览态切换)
  const groupCtrl = ed.plugins.group?.getController();
  let unsubGroup: (() => void) | undefined;
  if (groupCtrl) {
    const onGroupChanged = () => setIsGroupPreviewing(groupCtrl.isPreviewing());
    onGroupChanged();
    unsubGroup = groupCtrl.subscribe(onGroupChanged);
  }

  // 注入组 pin 展开器
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
  const cc = ed.plugins.connection.getController();
  cc.setGroupPinExpander(groupPinExpander);

  // ===== 全局事件监听 =====
  const ic = ed.plugins.interaction.getController();

  const onPointerMove = (e: PointerEvent) => {
    ic.handlePointerMove(e);
    cc.handlePointerMove(e);
  };
  const onPointerUp = () => {
    ic.handlePointerUp();
    cc.handlePointerUp();
    ed.plugins.history.breakMergeChain();
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  // wheel 挂容器(非 passive)
  const onWheel = (e: WheelEvent) => {
    ic.handleWheel(e);
  };
  containerRef.current?.addEventListener('wheel', onWheel, { passive: false });

  // 移动端二指缩放(pinch zoom) + 二指平移
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

    const factor = newDistance / pinchState.distance;
    const newK = Math.min(Math.max(pinchState.startK * factor, 0.05), 5);
    const worldX = (pinchState.centerX - pinchState.startX) / pinchState.startK;
    const worldY = (pinchState.centerY - pinchState.startY) / pinchState.startK;

    const panDx = newCenterX - pinchState.centerX;
    const panDy = newCenterY - pinchState.centerY;

    store.setViewport({
      x: newCenterX - worldX * newK + panDx,
      y: newCenterY - worldY * newK + panDy,
      k: newK,
    });
  };

  const onTouchEnd = (_e: TouchEvent) => {
    if (_e.touches.length < 2) {
      pinchState = null;
    }
  };

  const onTouchCancel = () => {
    pinchState = null;
  };

  containerRef.current?.addEventListener('touchstart', onTouchStart, { passive: false });
  containerRef.current?.addEventListener('touchmove', onTouchMove, { passive: false });
  containerRef.current?.addEventListener('touchend', onTouchEnd);
  containerRef.current?.addEventListener('touchcancel', onTouchCancel);

  // 键盘: Space(临时平移) + V(切换模式)
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') {
      ic.setSpacePressed(true);
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'v' || e.key === 'V')) {
      const next: 'select' | 'pan' = ic.getMode() === 'select' ? 'pan' : 'select';
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

  // 监听 viewport 变化
  const onViewportChanged = () => {
    setScaleState(store.getViewport().k);
  };
  const unsubViewport = store.subscribeViewport(onViewportChanged);

  setEditor(ed);

  return {
    editor: ed,
    extMap,
    getNodeSize,
    cleanup: () => {
      unsubGroup?.();
      unsubViewport();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      containerRef.current?.removeEventListener('wheel', onWheel);
      containerRef.current?.removeEventListener('touchstart', onTouchStart);
      containerRef.current?.removeEventListener('touchmove', onTouchMove);
      containerRef.current?.removeEventListener('touchend', onTouchEnd);
      containerRef.current?.removeEventListener('touchcancel', onTouchCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      resizeObserver.disconnect();
      ed.cleanup();
    },
  };
}