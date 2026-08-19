/**
 * PendingConnectionLayer - 临时连线渲染层
 * 在连线拖拽期间,从源端口到鼠标位置绘制贝塞尔曲线
 */

import React from 'react';
import { useSyncExternalStore } from 'react';
import type { ConnectionController, PendingConnection } from './controller.js';
import type { Viewport } from '@zeroexo/core';

export interface PendingConnectionLayerProps {
  controller: ConnectionController;
  viewport: Viewport;
}

function getPinScreenPosition(nodeId: string, pinId: string, direction: 'input' | 'output'): { x: number; y: number } | null {
  const pinSelector = `[data-node-id="${nodeId}"] [data-pin-id="${pinId}"][data-pin-direction="${direction}"]`;
  const pinEl = document.querySelector(pinSelector) as HTMLElement | null;
  if (!pinEl) return null;
  const dotEl = pinEl.querySelector('[data-pin-dot]') as HTMLElement | null;
  const rect = (dotEl ?? pinEl).getBoundingClientRect();
  const container = document.querySelector('[data-canvas-container]') as HTMLElement | null;
  const containerRect = container?.getBoundingClientRect() ?? { left: 0, top: 0 };

  // 连线起点应该在节点边缘,而不是 PIN 圆点位置
  const nodeEl = pinEl.closest('[data-node-id]') as HTMLElement | null;
  let screenX: number;
  if (nodeEl) {
    const nodeRect = nodeEl.getBoundingClientRect();
    screenX = direction === 'input' ? nodeRect.left - containerRect.left : nodeRect.right - containerRect.left;
  } else {
    screenX = rect.left + rect.width / 2 - containerRect.left;
  }
  const screenY = rect.top + rect.height / 2 - containerRect.top;
  return { x: screenX, y: screenY };
}

export function PendingConnectionLayer({
  controller,
  viewport,
}: PendingConnectionLayerProps): React.ReactElement | null {
  const pending = useSyncExternalStore(controller.subscribePending, controller.getPending);
  const hoverNodeId = useSyncExternalStore(controller.subscribePending, controller.getHoverNodeId);
  const validation = controller.getHoverNodeValidation();

  // 组 pin 源端点屏幕位置缓存(强制重排缓解):
  // 拖拽期间源节点不动,位置只随视口变化;避免每帧(pointermove 触发重渲染)
  // 重复 querySelector + 3N 次 getBoundingClientRect 的写→读交错强制重排。
  const groupPositions = React.useMemo(() => {
    const eps = pending?.groupSourceEndpoints;
    if (!eps || eps.length === 0) return null;
    return eps.map((ep) => ({ ep, pos: getPinScreenPosition(ep.nodeId, ep.pinId, ep.direction) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.groupSourceEndpoints, viewport.x, viewport.y, viewport.k]);

  if (!pending) return null;

  // 将世界坐标转换为屏幕坐标(应用视口变换)
  const ex = pending.currentX * viewport.k + viewport.x;
  const ey = pending.currentY * viewport.k + viewport.y;

  const tooltipContent = hoverNodeId && validation
    ? (validation.valid ? '✓ 可连接' : `✗ ${validation.reason}`)
    : null;

  const tooltipStyle: React.CSSProperties = {
    position: 'absolute',
    left: ex + 10,
    top: ey - 25,
    padding: '4px 8px',
    background: validation?.valid ? 'rgba(60, 179, 113, 0.9)' : 'rgba(235, 87, 87, 0.9)',
    color: '#fff',
    fontSize: 11,
    borderRadius: 4,
    pointerEvents: 'none',
    zIndex: 100,
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  };

  // 如果是组 pin 拖拽,渲染多条预览线(从每个叶子节点的 pin 到鼠标位置)
  if (groupPositions && groupPositions.length > 0) {
    const paths = groupPositions.map(({ ep, pos }) => {
      if (!pos) return null;
      const sx = pos.x;
      const sy = pos.y;
      const isOutput = ep.direction === 'output';
      const dx = Math.abs(ex - sx) * 0.5;
      const c1x = isOutput ? sx + dx : sx - dx;
      const c1y = sy;
      const c2x = isOutput ? ex - dx : ex + dx;
      const c2y = ey;
      return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
    }).filter(Boolean) as string[];

    return (
      <>
        <svg
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
        >
          {paths.map((path, i) => (
            <path
              key={i}
              d={path}
              fill="none"
              stroke="#e94560"
              strokeWidth={2}
              strokeDasharray="6 4"
              opacity={0.8}
            />
          ))}
          <circle cx={ex} cy={ey} r={4} fill="#e94560" opacity={0.8} />
        </svg>
        {tooltipContent && <div style={tooltipStyle}>{tooltipContent}</div>}
      </>
    );
  }

  // 普通单条预览线
  const sx = pending.sourceX * viewport.k + viewport.x;
  const sy = pending.sourceY * viewport.k + viewport.y;

  const isOutput = pending.sourceDirection === 'output';
  const dx = Math.abs(ex - sx) * 0.5;
  const c1x = isOutput ? sx + dx : sx - dx;
  const c1y = sy;
  const c2x = isOutput ? ex - dx : ex + dx;
  const c2y = ey;

  const path = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;

  return (
    <>
      <svg
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
      >
        <path
          d={path}
          fill="none"
          stroke="#e94560"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={0.8}
        />
        <circle cx={ex} cy={ey} r={4} fill="#e94560" opacity={0.8} />
      </svg>
      {tooltipContent && <div style={tooltipStyle}>{tooltipContent}</div>}
    </>
  );
}

/** Hook: 订阅临时连线状态 */
export function usePendingConnection(controller: ConnectionController): PendingConnection | null {
  return useSyncExternalStore(controller.subscribePending, controller.getPending);
}
