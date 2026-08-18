/**
 * useGroupInteractions - 组的独立交互 hooks(不走 interaction 的 NodeDrag 流程)
 *
 * 组 position 恒为 {x:0,y:0},拖拽用独立 onPointerDown + window pointermove/pointerup:
 * - useGroupDrag: 组本体拖拽(平移所有叶子后代;预览组则平移预览节点)
 * - useGroupResize: resize handle 拖拽(8 方向,最小尺寸约束,实时 ResizeGroupCommand)
 */

import React from 'react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { GroupController } from '../controller.js';
import { PREVIEW_GROUP_ID } from '../constants.js';
import type { ResizeHandleType } from '../components/group-resize-handle.js';

/**
 * 组拖拽 hook。
 * 点击先选中组(预览组不改选区),移动阈值 3px 后开始拖拽。
 * 普通组:O-1b 瞬态拖拽通道 — pointermove 期间直写 position(不走命令队列),
 *        pointerup 时提交合并的 MoveGroupCommand 入历史。
 * 预览组:直接调用 controller.movePreviewNodes(已用 setStateSilent,无需修改)。
 */
export function useGroupDrag(
  store: ReactGraphStore,
  controller: GroupController,
): (e: React.PointerEvent, groupId: string) => void {
  return React.useCallback(
    (e: React.PointerEvent, groupId: string) => {
      if (e.button !== 0) return;
      // 阻止冒泡到 CanvasView 的 onCanvasPointerDown(避免触发框选/平移)
      e.stopPropagation();

      const isPreviewGroup = groupId === PREVIEW_GROUP_ID;

      // 选中组(若未选中);预览组不改变选区(保持原始预览节点选中,避免胶囊工具栏消失)
      if (!isPreviewGroup) {
        const currentSelection = store.getSelection().selectedNodeIds;
        if (!currentSelection.has(groupId)) {
          store.setSelection({
            selectedNodeIds: new Set([groupId]),
            selectedEdgeIds: new Set(),
          });
        }
      }

      const startX = e.clientX;
      const startY = e.clientY;
      let lastX = startX;
      let lastY = startY;
      let hasMoved = false;
      // O-1b: 累积总偏移(用于 pointerup 提交命令)
      let totalDx = 0;
      let totalDy = 0;

      const handleMove = (me: PointerEvent): void => {
        const dxClient = me.clientX - lastX;
        const dyClient = me.clientY - lastY;
        // 移动阈值(避免纯点击触发拖拽)
        if (
          !hasMoved &&
          (Math.abs(me.clientX - startX) > 3 || Math.abs(me.clientY - startY) > 3)
        ) {
          hasMoved = true;
        }
        if (hasMoved && (dxClient !== 0 || dyClient !== 0)) {
          const vp = store.getViewport();
          const worldDx = dxClient / vp.k;
          const worldDy = dyClient / vp.k;
          if (isPreviewGroup) {
            controller.movePreviewNodes(worldDx, worldDy);
          } else {
            // O-1b: 瞬态拖拽 — 直写 position,不走命令队列
            controller.moveGroupSilent(groupId, worldDx, worldDy);
          }
          totalDx += worldDx;
          totalDy += worldDy;
          lastX = me.clientX;
          lastY = me.clientY;
        }
      };

      const handleUp = (): void => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        // O-1b: 松手时提交合并命令入历史
        if (hasMoved && !isPreviewGroup && (totalDx !== 0 || totalDy !== 0)) {
          controller.moveGroupCommit(groupId, totalDx, totalDy);
        }
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [store, controller],
  );
}

/**
 * 组 resize handle 拖拽 hook。
 * 按 handle 方位增量调整 bounds(最小 80×60)。
 * O-1c: pointermove 期间瞬态直写 bounds(不走命令队列),
 *       pointerup 时提交合并的 ResizeGroupCommand 入历史。
 */
export function useGroupResize(
  store: ReactGraphStore,
  controller: GroupController,
): (e: React.PointerEvent, groupId: string, handle: ResizeHandleType) => void {
  return React.useCallback(
    (e: React.PointerEvent, groupId: string, handle: ResizeHandleType) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      // 读取当前 bounds(尊重 dirty 标记和用户自定义 bounds 缓存)
      const startBounds = controller.getGroupBounds(groupId);
      if (!startBounds) return;

      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const oldBounds = { ...startBounds };
      let lastBounds = { ...startBounds };

      const handleMove = (me: PointerEvent): void => {
        const vp = store.getViewport();
        const dx = (me.clientX - startClientX) / vp.k;
        const dy = (me.clientY - startClientY) / vp.k;

        let newX = startBounds.x;
        let newY = startBounds.y;
        let newW = startBounds.width;
        let newH = startBounds.height;

        if (handle.includes('w')) {
          newX = startBounds.x + dx;
          newW = startBounds.width - dx;
        }
        if (handle.includes('e')) {
          newW = startBounds.width + dx;
        }
        if (handle.includes('n')) {
          newY = startBounds.y + dy;
          newH = startBounds.height - dy;
        }
        if (handle.includes('s')) {
          newH = startBounds.height + dy;
        }

        // 最小尺寸约束
        const minW = 80;
        const minH = 60;
        if (newW < minW) {
          if (handle.includes('w')) newX -= minW - newW;
          newW = minW;
        }
        if (newH < minH) {
          if (handle.includes('n')) newY -= minH - newH;
          newH = minH;
        }

        const newBounds = { x: newX, y: newY, width: newW, height: newH };
        lastBounds = newBounds;
        // O-1c: 瞬态缩放 — 直写 bounds,不走命令队列
        controller.resizeGroupSilent(groupId, newBounds);
      };

      const handleUp = (): void => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        // O-1c: 松手时提交合并命令入历史
        if (lastBounds.x !== oldBounds.x || lastBounds.y !== oldBounds.y ||
            lastBounds.width !== oldBounds.width || lastBounds.height !== oldBounds.height) {
          controller.resizeGroupCommit(groupId, oldBounds, lastBounds);
        }
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [controller, store],
  );
}
