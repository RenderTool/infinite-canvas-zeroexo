/**
 * NodeScaleContext - 节点缩放因子上下文
 *
 * 当节点使用 GPU 加速缩放(transform: scale)时,
 * PinView 需要读取此 context 应用反向缩放,避免 Pin 被连带缩放。
 */
import React from 'react';

export interface NodeScaleValue {
  /** 节点缩放比例 X(与 defaultSize 的比值) */
  sx: number;
  /** 节点缩放比例 Y(与 defaultSize 的比值) */
  sy: number;
}

export const NodeScaleContext = React.createContext<NodeScaleValue>({ sx: 1, sy: 1 });