/**
 * CanvasOverlays - 画布覆盖层(渲染在节点层之上)
 *
 * 聚合 SelectionBoxLayer(框选视觉)+ PendingConnectionLayer(连线拖拽预览)。
 * 内部用 useViewport(store) 订阅视口,传递给两个子层做世界→屏幕坐标转换。
 */

import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useViewport } from '@zeroexo/plugin-render-react';
import { SelectionBoxLayer } from '@zeroexo/plugin-selection';
import type { SelectionController } from '@zeroexo/plugin-selection';
import { PendingConnectionLayer } from '@zeroexo/plugin-connection';
import type { ConnectionController } from '@zeroexo/plugin-connection';

export interface CanvasOverlaysProps {
  store: ReactGraphStore;
  selectionController: SelectionController;
  connectionController: ConnectionController;
}

export function CanvasOverlays({
  store,
  selectionController,
  connectionController,
}: CanvasOverlaysProps): React.ReactElement {
  const viewport = useViewport(store);
  return (
    <>
      <SelectionBoxLayer controller={selectionController} viewport={viewport} />
      <PendingConnectionLayer controller={connectionController} viewport={viewport} />
    </>
  );
}
