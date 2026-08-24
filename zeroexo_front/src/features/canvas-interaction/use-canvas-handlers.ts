/**
 * use-canvas-handlers - 画布交互回调
 *
 * 委托给 interactionController/connectionController/contextMenuController。
 * 右键菜单统一处理 canvas/node/edge 三种类型(通过 data-node-id/data-edge-id 检测)。
 */

import { useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { EditorRefs } from '@/pages/editor/editor-canvas/use-editor-state.js';

export interface CanvasHandlers {
  onCanvasPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onNodePointerDown: (e: ReactPointerEvent, nodeId: string) => void;
  onNodePointerEnter: (e: ReactPointerEvent, nodeId: string) => void;
  onNodePointerLeave: (e: ReactPointerEvent, nodeId: string) => void;
  onEdgePointerDown: (e: ReactPointerEvent, edgeId: string) => void;
  onResizeHandlePointerDown: (
    e: ReactPointerEvent,
    nodeId: string,
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  ) => void;
  onCanvasContextMenu: (e: ReactMouseEvent) => void;
  /** 组引脚 pointerdown(委托 connectionController,允许从组引脚拉出连线) */
  onGroupPinPointerDown: (
    e: ReactPointerEvent,
    pinEl: HTMLElement,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  /** 组引脚 pointerenter */
  onGroupPinPointerEnter: (
    e: ReactPointerEvent,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  /** 组引脚 pointerleave */
  onGroupPinPointerLeave: () => void;
  /** 触摸开始(用于移动端长按检测) */
  onNodeTouchStart: (e: React.TouchEvent, nodeId: string) => void;
  /** 触摸结束(用于移动端长按检测) */
  onNodeTouchEnd: (e: React.TouchEvent, nodeId: string) => void;
  /** 触摸移动(用于移动端长按检测) */
  onNodeTouchMove: (e: React.TouchEvent, nodeId: string) => void;
}

export function useCanvasHandlers(
  refs: EditorRefs,
  containerRef: React.RefObject<HTMLDivElement | null>,
): CanvasHandlers {
  const ic = refs.interactionController;

  const onCanvasPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    ic?.handleCanvasPointerDown(e.nativeEvent);
  }, [ic]);

  const onNodePointerDown = useCallback((e: ReactPointerEvent, nodeId: string) => {
    // 仅左键(button===0)需要拦截:拖拽/选中逻辑;中键/右键一律放行(右键冒泡到 Viewport_ 触发右键菜单)
    if (e.button !== 0) return;
    e.stopPropagation();
    ic?.handleNodePointerDown(e.nativeEvent, nodeId);
  }, [ic]);

  const onNodePointerEnter = useCallback((_e: ReactPointerEvent, nodeId: string) => {
    // 缩放操作中不更新 hover 状态,避免指针经过底下节点时触发 z-index 竞争导致卡顿
    if (ic?.getTransient().resizing) return;
    refs.connectionController?.handleNodePointerEnter(nodeId);
  }, [refs, ic]);

  const onNodePointerLeave = useCallback(() => {
    // 缩放操作中不更新 hover 状态
    if (ic?.getTransient().resizing) return;
    refs.connectionController?.handleNodePointerLeave();
  }, [refs, ic]);

  const onEdgePointerDown = useCallback((e: ReactPointerEvent, edgeId: string) => {
    // 中键透传:冒泡到画布层平移
    if (e.button === 1) return;
    e.stopPropagation();
    ic?.handleEdgePointerDown(e.nativeEvent, edgeId);
  }, [ic]);

  const onResizeHandlePointerDown = useCallback(
    (
      e: ReactPointerEvent,
      nodeId: string,
      handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
    ) => {
      // 中键透传:冒泡到画布层平移
      if (e.button === 1) return;
      e.stopPropagation();
      ic?.handleResizeHandlePointerDown(e.nativeEvent, nodeId, handle);
    },
    [ic],
  );

  // 右键菜单:统一处理(canvas/node/edge)
  const onCanvasContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    // 先取消正在进行的连线拖拽(避免拖拽连线时右键菜单受干扰)
    refs.connectionController?.cancel();
    const target = e.target as Element;
    const vp = refs.store?.getViewport();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !vp) return;
    const worldX = (e.clientX - rect.left - vp.x) / vp.k;
    const worldY = (e.clientY - rect.top - vp.y) / vp.k;

    // 优先检测连线(edge 在 NodeLayer 下方,先检测避免被节点遮挡)
    const edgeEl = target.closest('[data-edge-id]');
    if (edgeEl) {
      const edgeId = edgeEl.getAttribute('data-edge-id');
      if (edgeId) {
        refs.contextMenuController?.openAt(e.clientX, e.clientY, { type: 'edge', edgeId });
        return;
      }
    }
    const nodeEl = target.closest('[data-node-id]');
    if (nodeEl) {
      const nodeId = nodeEl.getAttribute('data-node-id');
      if (nodeId) {
        refs.contextMenuController?.openAt(e.clientX, e.clientY, { type: 'node', nodeId });
        return;
      }
    }
    // 空白区域
    refs.contextMenuController?.openAt(e.clientX, e.clientY, {
      type: 'canvas',
      worldPosition: { x: worldX, y: worldY },
    });
  }, [refs, containerRef]);

  // 组引脚回调(委托 connectionController,支持从组引脚拉出连线)
  const onGroupPinPointerDown = useCallback(
    (
      e: ReactPointerEvent,
      pinEl: HTMLElement,
      groupId: string,
      pinId: string,
      direction: 'input' | 'output',
    ) => {
      // 中键透传:冒泡到画布层平移
      if (e.button === 1) return;
      e.stopPropagation();
      refs.connectionController?.handlePinPointerDown(
        e.nativeEvent,
        pinEl,
        groupId,
        pinId,
        direction,
      );
    },
    [refs],
  );

  const onGroupPinPointerEnter = useCallback(
    (
      e: ReactPointerEvent,
      groupId: string,
      pinId: string,
      direction: 'input' | 'output',
    ) => {
      refs.connectionController?.handlePinPointerEnter(
        e.nativeEvent,
        groupId,
        pinId,
        direction,
      );
    },
    [refs],
  );

  const onGroupPinPointerLeave = useCallback(() => {
    refs.connectionController?.handlePinPointerLeave();
  }, [refs]);

  const longPressTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
  const touchedNodeRef = { current: null as string | null };
  const touchStartPosRef = { current: { x: 0, y: 0 } };

  const onNodeTouchStart = useCallback((e: React.TouchEvent, nodeId: string) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchedNodeRef.current = nodeId;
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      if (touchedNodeRef.current === nodeId) {
        refs.connectionController?.cancel();
        refs.contextMenuController?.openAt(touch.clientX, touch.clientY, { type: 'node', nodeId });
      }
    }, 500);
  }, [refs]);

  const onNodeTouchEnd = useCallback((_e: React.TouchEvent, _nodeId: string) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchedNodeRef.current = null;
  }, []);

  const onNodeTouchMove = useCallback((e: React.TouchEvent) => {
    if (!longPressTimerRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartPosRef.current.x;
    const dy = touch.clientY - touchStartPosRef.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  return {
    onCanvasPointerDown,
    onNodePointerDown,
    onNodePointerEnter,
    onNodePointerLeave,
    onEdgePointerDown,
    onResizeHandlePointerDown,
    onCanvasContextMenu,
    onGroupPinPointerDown,
    onGroupPinPointerEnter,
    onGroupPinPointerLeave,
    onNodeTouchStart,
    onNodeTouchEnd,
    onNodeTouchMove,
  };
}
