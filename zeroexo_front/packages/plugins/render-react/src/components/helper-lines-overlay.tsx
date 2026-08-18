/**
 * HelperLinesOverlay - 对齐辅助线覆盖层
 *
 * 在画布上渲染拖拽时的对齐辅助线(SVG)。
 * 接收 HelperLine[] 数据,在视图变换坐标系中绘制线条。
 *
 * 使用方式:作为 CanvasView 的 children 传入,自动在视口变换坐标系中渲染。
 */

import React from 'react';
import type { HelperLine } from '@zeroexo/plugin-interaction';

export interface HelperLinesOverlayProps {
  lines: HelperLine[];
  /** 视口变换 k(缩放,用于线条宽度/样式自适应) */
  viewportK: number;
  /** 视口平移 x(世界坐标→屏幕坐标变换) */
  viewportX: number;
  /** 视口平移 y(世界坐标→屏幕坐标变换) */
  viewportY: number;
}

export function HelperLinesOverlay({ lines, viewportK, viewportX, viewportY }: HelperLinesOverlayProps): React.ReactElement | null {
  if (lines.length === 0) return null;

  // 线条宽度随缩放自适应(保持屏幕像素恒定)
  const strokeWidth = Math.max(1, 1.5 / viewportK);
  // 扩展线段长度,使其覆盖整个可见区域(使用大数值)
  const EXTEND = 50000;

  // 世界坐标 → 屏幕坐标变换
  const toScreenX = (worldX: number): number => worldX * viewportK + viewportX;
  const toScreenY = (worldY: number): number => worldY * viewportK + viewportY;

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 100,
        overflow: 'visible',
      }}
    >
      {lines.map((line, i) => {
        if (line.type === 'horizontal') {
          // 水平线: y = line.position, x 从 line.start 到 line.end
          const screenY = toScreenY(line.position);
          const screenX1 = toScreenX(line.start - EXTEND);
          const screenX2 = toScreenX(line.end + EXTEND);
          return (
            <line
              key={i}
              x1={screenX1}
              y1={screenY}
              x2={screenX2}
              y2={screenY}
              stroke="#e94560"
              strokeWidth={strokeWidth}
              strokeDasharray={`${3 / viewportK} ${3 / viewportK}`}
              opacity={0.8}
            />
          );
        }
        // 垂直线: x = line.position, y 从 line.start 到 line.end
        const screenX = toScreenX(line.position);
        const screenY1 = toScreenY(line.start - EXTEND);
        const screenY2 = toScreenY(line.end + EXTEND);
        return (
          <line
            key={i}
            x1={screenX}
            y1={screenY1}
            x2={screenX}
            y2={screenY2}
            stroke="#e94560"
            strokeWidth={strokeWidth}
            strokeDasharray={`${3 / viewportK} ${3 / viewportK}`}
            opacity={0.8}
          />
        );
      })}
    </svg>
  );
}