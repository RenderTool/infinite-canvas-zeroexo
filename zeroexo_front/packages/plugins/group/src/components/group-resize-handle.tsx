/**
 * GroupResizeHandle - 组 resize handle(白圆点)
 *
 * 选中正式组时显示 4 角点(nw/ne/se/sw),随视口缩放保持视觉尺寸恒定。
 * 移除 e/w 手柄避免与组连接 Pin 重叠(两者均在垂直居中位置)。
 * T3: 尺寸/偏移改走连续 CSS 变量 --zx-invk(GroupLayer 容器每帧写入),缩放逐帧连续跟随。
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
  onPointerDown,
}: {
  type: ResizeHandleType;
  cursor: string;
  onPointerDown: (e: React.PointerEvent) => void;
}): React.ReactElement {
  // 白圆点直径 12 世界像素(视觉恒定随视口缩放),半偏移 6
  const invKVar = 'var(--zx-invk, 1)';
  const size = `calc(12px * ${invKVar})`;
  const offset = `calc(-6px * ${invKVar})`;
  const pos: Record<ResizeHandleType, { left: string; top: string }> = {
    nw: { left: offset, top: offset },
    ne: { left: `calc(100% + ${offset})`, top: offset },
    se: { left: `calc(100% + ${offset})`, top: `calc(100% + ${offset})` },
    sw: { left: offset, top: `calc(100% + ${offset})` },
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
        border: `calc(2px * ${invKVar}) solid #000`,
        boxShadow: `0 calc(1px * ${invKVar}) calc(3px * ${invKVar}) rgba(0,0,0,0.4)`,
        cursor,
        pointerEvents: 'auto',
        zIndex: 20,
        boxSizing: 'border-box',
      }}
    />
  );
}
