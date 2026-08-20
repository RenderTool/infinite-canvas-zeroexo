/**
 * PinView - 引脚视图组件(UE5 风格命名: Pin)
 * 渲染引脚圆点 + 类型颜色
 *
 * 悬浮磁吸模式(magnetMode):
 * - input 引脚(position=left): 圆点中心贴在容器右边缘,便于连线起点
 * - output 引脚(position=right): 圆点中心贴在容器左边缘,便于连线起点
 * - magnetOffsetX/Y: XY 偏移,使引脚跟随鼠标在容器范围内移动
 */

import React from 'react';
import type { Pin } from '@zeroexo/core';
import { usePinDefaults } from '../pin-defaults.js';
import { NodeScaleContext } from './node-scale-context.js';

export interface PinViewProps {
  pin: Pin;
  /** 引脚在节点上的位置 */
  position: 'left' | 'right' | 'top' | 'bottom';
  /** 是否可连接(由 connection 插件控制) */
  isConnecting?: boolean;
  /** 是否可见(默认 true;hover 显示/隐藏控制) */
  visible?: boolean;
  /** 磁吸模式:水平偏移 */
  magnetOffsetX?: number;
  /** 磁吸模式:垂直偏移 */
  magnetOffsetY?: number;
  onPointerDown?: (e: React.PointerEvent, pin: Pin) => void;
  onPointerEnter?: (e: React.PointerEvent, pin: Pin) => void;
  onPointerLeave?: (e: React.PointerEvent, pin: Pin) => void;
}

/** 默认 Pin 尺寸(像素) */
const DEFAULT_PIN_SIZE = 14;
const PIN_COLORS: Record<string, string> = {
  exec: '#ffffff',
  bool: '#b3474b',
  int: '#3cb371',
  float: '#3cb371',
  string: '#ee9d3d',
  object: '#3c87b3',
  any: '#95a5a6',
};

export function PinView({
  pin,
  position,
  isConnecting = false,
  visible = true,
  magnetOffsetX,
  magnetOffsetY,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
}: PinViewProps): React.ReactElement {
  const pinDefaults = usePinDefaults();
  const color = pin.color ?? pinDefaults.color ?? PIN_COLORS[pin.dataType ?? 'any'] ?? '#95a5a6';
  const shape = pin.shape ?? pinDefaults.shape ?? 'circle';
  const pinSize = pin.size ?? pinDefaults.size ?? DEFAULT_PIN_SIZE;
  const pinOpacity = pinDefaults.opacity ?? 1;

  // 读取节点缩放因子,对 Pin 应用反向缩放,避免被节点的 transform:scale 连带缩放
  const nodeScale = React.useContext(NodeScaleContext);
  const invSx = 1 / nodeScale.sx;
  const invSy = 1 / nodeScale.sy;

  // 磁吸模式下:input 圆点中心靠右边缘,output 靠左边缘
  // 通过 translateX 将圆点中心移到容器对应边缘
  const isInput = position === 'left';
  const isMagnetMode = magnetOffsetX !== undefined || magnetOffsetY !== undefined;
  const baseTranslateX = isInput ? pinSize / 2 : -pinSize / 2;
  // magnetOffset 是屏幕坐标:先除节点缩放转本地坐标,再乘连续 --zx-invk(视口反缩放)。
  // 视觉 = offset/sx × (1/k) × sx × k = offset 屏幕恒定;乘法走 CSS 变量而非 JS 量化 invK,
  // 消除缩放动画跨桶(5%)瞬间磁吸偏移突变(T10)
  const translateX = isMagnetMode
    ? `calc(${baseTranslateX}px + ${(magnetOffsetX ?? 0) / nodeScale.sx}px * var(--zx-invk, 1))`
    : '0px';
  const translateY = isMagnetMode
    ? `calc(${(magnetOffsetY ?? 0) / nodeScale.sy}px * var(--zx-invk, 1))`
    : '0px';

  return (
    <div
      data-pin-id={pin.id}
      data-pin-direction={pin.direction}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, pin) : undefined}
      onPointerEnter={onPointerEnter ? (e) => onPointerEnter(e, pin) : undefined}
      onPointerLeave={onPointerLeave ? (e) => onPointerLeave(e, pin) : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'crosshair',
        pointerEvents: visible ? 'auto' : 'none',
        userSelect: 'none',
        padding: '4px 0',
        opacity: visible ? pinOpacity : 0,
        transition: isMagnetMode ? 'none' : 'opacity 0.15s cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      {/* 空心圆环/方形 + "+" 号 */}
      <div
        data-pin-dot
        data-pin-size={pinSize}
        style={{
          width: pinSize,
          height: pinSize,
          borderRadius: shape === 'square' ? 2 : '50%',
          backgroundColor: 'transparent',
          border: `2px solid ${color}`,
          boxShadow: isConnecting ? `0 0 8px ${color}99` : `0 0 3px ${color}44`,
          // 注意:transition 不包含 transform —— 节点 resize/视口缩放时反缩放 scale 逐帧变化,
          // 若 transform 带过渡会导致 PIN 滞后动画(表现为"突然变大又回弹"的跳动)
          transition: 'box-shadow 0.15s cubic-bezier(0.22,1,0.36,1), border-color 0.15s cubic-bezier(0.22,1,0.36,1)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: isMagnetMode
            ? `translate(${translateX}, ${translateY}) scale(${invSx}, ${invSy})`
            : `scale(${invSx}, ${invSy})`,
          zIndex: isMagnetMode ? 35 : 'auto',
        }}
      >
        {/* "+" 号 — 使用100%填充确保居中 */}
        <svg viewBox="0 0 24 24" fill="none" style={{ width: '100%', height: '100%', padding: '2px' }}>
          <line x1="12" y1="4" x2="12" y2="20" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
