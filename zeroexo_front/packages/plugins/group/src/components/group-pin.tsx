/**
 * GroupPin - group 聚合引脚(集中连接点)
 *
 * 在 group 容器左/右边缘渲染圆点,聚合组内所有同方向 pin。
 * 连接存储为指向 group 的边(nodeId=groupId, pinId='__group_in/out__')。
 *
 * DOM 约定(与 PinView 一致,供 connection controller 识别):
 * - 根 div: data-pin-id + data-pin-direction + data-node-id(=groupId)
 * - 圆点 div: data-pin-dot + data-pin-size
 *
 * 位置:input 贴左边缘(output 贴右边缘),垂直居中。
 * 圆点跨边缘渲染(半在内半在外),尺寸用世界坐标(随视口缩放,与节点 pin 一致)。
 * 相比普通节点 pin 尺寸扩大 15%,便于在组节点上识别和操作。
 */

import React from 'react';
import { usePinDefaults } from '@zeroexo/plugin-render-react';

/** 组 pin 相对普通 pin 的尺寸放大系数(便于识别和操作) */
const GROUP_PIN_SCALE = 1.15;

export function GroupPin({
  groupId,
  pinId,
  direction,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
}: {
  groupId: string;
  pinId: string;
  direction: 'input' | 'output';
  onPointerDown?: (
    e: React.PointerEvent,
    pinEl: HTMLElement,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  onPointerEnter?: (
    e: React.PointerEvent,
    groupId: string,
    pinId: string,
    direction: 'input' | 'output',
  ) => void;
  onPointerLeave?: () => void;
}): React.ReactElement {
  // 读取全局 pin 默认配置(与 NodeShell/EdgeLayer 一致的三层优先级)
  const pinDefaults = usePinDefaults();
  // 组 pin 在普通 pin 尺寸基础上放大 15%
  const baseSize = pinDefaults.size ?? 12;
  const worldSize = baseSize * GROUP_PIN_SCALE;
  const color = pinDefaults.color ?? '#95a5a6';
  const shape = pinDefaults.shape ?? 'circle';
  const pinOpacity = pinDefaults.opacity ?? 1;
  const isInput = direction === 'input';

  // Hover 状态
  const [hovered, setHovered] = React.useState(false);

  // 圆点跨边缘:中心在边缘线上 → left = -worldSize/2 (input) 或 calc(100% - worldSize/2) (output)
  const edgeOffset = -worldSize / 2;

  return (
    <div
      data-pin-id={pinId}
      data-pin-direction={direction}
      data-node-id={groupId}
      onPointerDown={
        onPointerDown
          ? (e) => onPointerDown(e, e.currentTarget, groupId, pinId, direction)
          : undefined
      }
      onPointerEnter={(e) => {
        setHovered(true);
        onPointerEnter?.(e, groupId, pinId, direction);
      }}
      onPointerLeave={() => {
        setHovered(false);
        onPointerLeave?.();
      }}
      style={{
        position: 'absolute',
        left: isInput ? edgeOffset : `calc(100% + ${edgeOffset}px)`,
        top: `calc(50% + ${edgeOffset}px)`,
        width: worldSize,
        height: worldSize,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        zIndex: 15,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pinOpacity,
        transform: hovered ? 'scale(1.3)' : 'scale(1)',
        transition: 'transform 0.15s ease, filter 0.15s ease',
        filter: hovered ? 'drop-shadow(0 0 6px var(--pin-hover-glow, rgba(255,255,255,0.5)))' : 'none',
      }}
    >
      <div
        data-pin-dot
        data-pin-size={worldSize}
        style={{
          width: worldSize,
          height: worldSize,
          borderRadius: shape === 'square' ? 2 : '50%',
          backgroundColor: 'transparent',
          border: `2px solid ${color}`,
          boxShadow: hovered ? `0 0 8px ${color}, 0 0 16px ${color}66` : `0 0 4px ${color}44`,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'box-shadow 0.15s ease',
        }}
      >
        <svg width={worldSize * 0.5} height={worldSize * 0.5} viewBox="0 0 24 24" fill="none">
          <line x1="12" y1="4" x2="12" y2="20" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}