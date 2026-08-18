/**
 * GroupResizeHandle - 组 resize handle(白圆点)
 *
 * 选中正式组时显示 4 角点(nw/ne/se/sw),随视口缩放(invK)保持视觉尺寸恒定。
 * 移除 e/w 手柄避免与组连接 Pin 重叠(两者均在垂直居中位置)。
 */

import React from 'react';

/** resize handle 类型(仅 4 角,移除 e/w 避免与组 Pin 重叠) */
export type ResizeHandleType = 'nw' | 'ne' | 'se' | 'sw';

/** 4 个 handle 的位置与光标映射 */
export const GROUP_HANDLE_DEFS: Array<{ type: ResizeHandleType; cursor: string }> = [
  { type: 'nw', cursor: 'nwse-resize' },
  { type: 'ne', cursor: 'nesw-resize' },
  { type: 'se', cursor: 'nwse-resize' },
  { type: 'sw', cursor: 'nesw-resize' },
];

export function GroupResizeHandle({
  type,
  cursor,
  invK,
  onPointerDown,
}: {
  type: ResizeHandleType;
  cursor: string;
  invK: number;
  onPointerDown: (e: React.PointerEvent) => void;
}): React.ReactElement {
  const size = 12 * invK;
  const offset = -size / 2;
  const pos: Record<ResizeHandleType, { left: string; top: string }> = {
    nw: { left: `${offset}px`, top: `${offset}px` },
    ne: { left: `calc(100% + ${offset}px)`, top: `${offset}px` },
    se: { left: `calc(100% + ${offset}px)`, top: `calc(100% + ${offset}px)` },
    sw: { left: `${offset}px`, top: `calc(100% + ${offset}px)` },
  };
  return (
    <div
      data-group-resize-handle={type}
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        left: pos[type].left,
        top: pos[type].top,
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: '#fff',
        border: `${2 * invK}px solid #000`,
        boxShadow: `0 ${1 * invK}px ${3 * invK}px rgba(0,0,0,0.4)`,
        cursor,
        pointerEvents: 'auto',
        zIndex: 20,
        boxSizing: 'border-box',
      }}
    />
  );
}
