/**
 * DragOffsetWriter - 节点拖动瞬态直写器
 *
 * 背景: interaction 拖动节点时,store 只持有「拖动集节点 → 世界偏移」的偏移表,
 * 不重建 graph(避免 pointermove 每帧全量重建节点 DOM 树 → 主线程被占 → 光标/拖拽卡顿)。
 * 节点元素自身的 transform 由本组件订阅偏移表后每帧直写 DOM(与 React 渲染解耦)。
 *
 * 一致性: 与 node-layer.tsx 的 NodeItem 渲染共用同一套 transform 计算(translate +
 * 可选 GPU 等比 scale;低缩放 LOD 时仅 translate),保证两种路径产物字符串一致;
 * 拖动结束(偏移清空)后 interaction 提交 MoveNodesCommand,React 渲染最终位置,无跳变。
 */
import { useEffect, type ReactElement } from 'react';
import type { NodeTypeExtension } from '@zeroexo/core';
import type { ReactGraphStore } from '../store.js';

/** 低缩放 LOD 阈值(与 node-layer 的 k < 0.35 一致) */
const LOW_ZOOM_THRESHOLD = 0.35;

/** 节点容器 transform(世界坐标 + 可选 GPU 等比缩放);与 node-layer 渲染逻辑一致 */
function buildNodeTransform(
  position: { x: number; y: number },
  scale?: { sx: number; sy: number },
): string {
  const t = `translate(${position.x}px, ${position.y}px)`;
  return scale ? `${t} scale(${scale.sx}, ${scale.sy})` : t;
}

export interface DragOffsetWriterProps {
  store: ReactGraphStore;
  extensions: Map<string, NodeTypeExtension>;
}

export function DragOffsetWriter({ store, extensions }: DragOffsetWriterProps): ReactElement | null {
  useEffect(() => {
    return store.subscribeDragOffsets(() => {
      const offsets = store.getDragOffsets();
      if (offsets.size === 0) return;
      const layer = document.querySelector('[data-canvas-node-layer]');
      if (!layer) return;
      // 一次遍历构建 nodeId → 元素 索引(O(V)),避免对每个拖动节点单独 querySelector
      const elByNodeId = new Map<string, HTMLElement>();
      // NodeLayer 容器的直接子元素即 NodeItem
      for (let i = 0; i < layer.children.length; i++) {
        const el = layer.children[i] as HTMLElement;
        const id = el.getAttribute('data-node-id');
        if (id) elByNodeId.set(id, el);
      }
      const vp = store.getViewport();
      for (const [nodeId, off] of offsets) {
        const node = store.getNode(nodeId);
        if (!node) continue;
        const el = elByNodeId.get(nodeId);
        if (!el) continue;
        const pos = { x: node.position.x + off.dx, y: node.position.y + off.dy };
        // 低缩放 LOD:仅 translate(与 node-layer 占位分支一致)
        if (vp.k < LOW_ZOOM_THRESHOLD) {
          el.style.transform = buildNodeTransform(pos);
          continue;
        }
        // GPU 等比缩放判定(与 node-layer 的 useScale 公式一致,保证字符串相同)
        const ext = extensions.get(node.type);
        const size = node.size ?? ext?.defaultSize ?? { width: 200, height: 100 };
        const defaultSize = ext?.defaultSize;
        const scaleContract = ext?.runtime?.definition?.size;
        const canScale = ext?.lockAspectRatio === true || scaleContract?.mode === 'uniform';
        const rawSx = defaultSize && defaultSize.width > 0 ? size.width / defaultSize.width : 1;
        const rawSy = defaultSize && defaultSize.height > 0 ? size.height / defaultSize.height : 1;
        // 与 node-layer 一致:高度偏差 ≤0.75px 判等比(容忍 resize 整数化的舍入误差)
        const isUniformScale = Math.abs(rawSx - rawSy) * (defaultSize?.height ?? 1) <= 0.75;
        const useScale = canScale && isUniformScale && !!(defaultSize && (size.width !== defaultSize.width || size.height !== defaultSize.height));
        el.style.transform = buildNodeTransform(pos, useScale ? { sx: rawSx, sy: rawSy } : undefined);
      }
    });
  }, [store, extensions]);
  return null;
}