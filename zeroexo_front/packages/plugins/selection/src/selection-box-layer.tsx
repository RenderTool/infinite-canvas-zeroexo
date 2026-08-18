/**
 * SelectionBoxLayer - 框选视觉渲染层
 * 在框选期间,绘制半透明矩形(虚线边框)
 *
 * 世界坐标 → 屏幕坐标: 应用视口变换
 */

import React from 'react';
import { useSyncExternalStore } from 'react';
import type { SelectionController, MarqueeRect } from './controller.js';
import type { Viewport } from '@zeroexo/core';

export interface SelectionBoxLayerProps {
  controller: SelectionController;
  viewport: Viewport;
}

export function SelectionBoxLayer({
  controller,
  viewport,
}: SelectionBoxLayerProps): React.ReactElement | null {
  const marquee = useSyncExternalStore(controller.subscribeMarquee, controller.getMarquee);
  if (!marquee) return null;

  // 世界坐标 → 屏幕坐标
  const x1 = marquee.startX * viewport.k + viewport.x;
  const y1 = marquee.startY * viewport.k + viewport.y;
  const x2 = marquee.currentX * viewport.k + viewport.x;
  const y2 = marquee.currentY * viewport.k + viewport.y;

  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        width: '100%',
        height: '100%',
      }}
    >
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        fill="rgba(233, 69, 96, 0.1)"
        stroke="#e94560"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
    </svg>
  );
}

/** Hook: 订阅框选状态 */
export function useMarquee(controller: SelectionController): MarqueeRect | null {
  return useSyncExternalStore(controller.subscribeMarquee, controller.getMarquee);
}
