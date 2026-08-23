/**
 * Viewport - 画布视口容器
 * 负责: 视口变换(transform)、背景网格、事件透传
 * 交互逻辑由 interaction 插件通过 props 注入
 */

import React, { useState, useRef, useLayoutEffect } from 'react';
import type { Viewport } from '@zeroexo/core';
import { ContextMenu } from './context-menu.js';
import type { ContextMenuItem } from './context-menu.js';
import type { ReactGraphStore } from '../store.js';

export interface ViewportProps {
  /** 状态存储(内部订阅 viewport 并直写背景样式,平移缩放零 React reconcile) */
  store: ReactGraphStore;
  /** 容器 ref */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** 子节点(通常为 NodeLayer + EdgeLayer) */
  children: React.ReactNode;
  /** 背景网格类型 */
  background?: 'dots' | 'lines' | 'none';
  /** 背景色 */
  background_color?: string;
  /** 网格颜色(向后兼容,dots 和 lines 共用) */
  grid_color?: string;
  /** 点阵网格色(优先于 grid_color,用于 dots 模式) */
  grid_dot_color?: string;
  /** 线条网格色(优先于 grid_color,用于 lines 模式) */
  grid_line_color?: string;
  /** 网格大小(世界坐标) */
  grid_size?: number;
  /** 右键菜单项(覆盖默认的 复制/粘贴/删除; null=不显示内置菜单) */
  contextMenuItems?: ContextMenuItem[] | null;
  /** 自定义事件处理(由 interaction 插件注入) */
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 拖拽事件(Phase D2:AssetPicker 拖拽到画布生成节点) */
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** 自定义样式 */
  style?: React.CSSProperties;
  className?: string;
  /** 交互模式: select=选择(默认光标), pan=平移(手型光标) */
  mode?: 'select' | 'pan';
}

export function Viewport_({
  store,
  containerRef,
  children,
  background = 'lines',
  background_color = '#1a1a2e',
  grid_color = '#16213e',
  grid_dot_color,
  grid_line_color,
  grid_size = 32,
  contextMenuItems,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onContextMenu,
  onDrop,
  onDragOver,
  style,
  className,
  mode = 'select',
}: ViewportProps): React.ReactElement {
  const bgRef = useRef<HTMLDivElement | null>(null);

  // 背景网格直写 DOM:订阅 viewport,在回调里直接写 background-position/size,
  // 不触发 React 重渲染(背景 gridBackground 是纯计算,无状态依赖)。
  useLayoutEffect(() => {
    const dotColor = grid_dot_color ?? grid_color;
    const lineColor = grid_line_color ?? grid_color;
    const apply = (vp: Viewport): void => {
      const el = bgRef.current;
      if (!el) return;
      const k = vp.k > 0 ? vp.k : 1;
      let bgImage = 'none';
      if (background !== 'none') {
        if (background === 'dots') {
          if (k >= 0.25) {
            const rgbMatch = dotColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            const rgb = rgbMatch ? `${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]}` : '245,245,244';
            const zoomFactor = Math.max(0, Math.min(1, (k - 0.25) / 0.75));
            const alphaMatch = dotColor.match(/[\d.]+\)$/);
            const baseAlpha = alphaMatch ? parseFloat(alphaMatch[0].replace(')', '')) : 0.24;
            const dotAlpha = (baseAlpha * zoomFactor).toFixed(3);
            bgImage = `radial-gradient(circle, rgba(${rgb},${dotAlpha}) 1.15px, transparent 1.35px)`;
          }
        } else {
          bgImage = `linear-gradient(to right, ${lineColor} 1px, transparent 1px), linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`;
        }
      }
      const gridSize = grid_size * k;
      el.style.backgroundImage = bgImage;
      if (background !== 'none') {
        el.style.backgroundSize = `${gridSize}px ${gridSize}px`;
        el.style.backgroundPosition = `${vp.x % gridSize}px ${vp.y % gridSize}px`;
      }
    };
    apply(store.getViewport());
    return store.subscribeViewport(() => apply(store.getViewport()));
  }, [store, background, background_color, grid_color, grid_dot_color, grid_line_color, grid_size]);

  // 根据交互模式切换光标: pan 模式手型(平移), select 模式默认(框选/选中)
  const cursor = mode === 'pan' ? 'grab' : 'default';

  // ===== 右键菜单(新 ContextMenu 组件) =====
  const [ctxMenuPos, setCtxMenuPos] = useState<{ x: number; y: number } | null>(null);
  const defaultCtxMenuItems: ContextMenuItem[] = [
    { key: 'copy', label: '复制', onClick: () => {} },
    { key: 'paste', label: '粘贴', onClick: () => {} },
    { key: 'divider-1', divider: true, label: '', onClick: () => {} },
    { key: 'delete', label: '删除', danger: true, onClick: () => {} },
  ];
  // null = 外部管理菜单(如 NodeCreateMenu),不显示内置菜单
  // undefined = 使用默认菜单项
  // [] = 空菜单(不显示任何项)
  const ctxMenuItems = contextMenuItems === undefined ? defaultCtxMenuItems : (contextMenuItems ?? []);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // 先调用外部 handler,让其决定是否跳过内置菜单
    onContextMenu?.(e);
    // 外部 handler 可设置 skipBuiltinMenu 来跳过内置菜单
    const skip = (e as unknown as { skipBuiltinMenu?: boolean }).skipBuiltinMenu;
    if (!skip && ctxMenuItems.length > 0) {
      setCtxMenuPos({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <ContextMenu items={ctxMenuItems} position={ctxMenuPos} onClose={() => setCtxMenuPos(null)}>
      <div
        ref={(el) => {
          bgRef.current = el;
          if (containerRef) {
            (containerRef as { current: HTMLDivElement | null }).current = el;
          }
        }}
        data-canvas-viewport
        data-canvas-mode={mode}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={handleContextMenu}
        onDrop={onDrop}
        onDragOver={onDragOver}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: background_color,
          // backgroundImage/Size/Position 由 useLayoutEffect 订阅 viewport 直写 DOM
          touchAction: 'none',
          cursor,
          userSelect: 'none',
          contain: 'layout style paint',
          ...style,
        }}
        className={className}
      >
        {children}
      </div>
    </ContextMenu>
  );
}
