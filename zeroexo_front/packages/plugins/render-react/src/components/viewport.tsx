/**
 * Viewport - 画布视口容器
 * 负责: 视口变换(transform)、背景网格、事件透传
 * 交互逻辑由 interaction 插件通过 props 注入
 */

import React, { useState } from 'react';
import type { Viewport } from '@zeroexo/core';
import { ContextMenu } from '@/shared/components/index.js';
import type { ContextMenuItem } from '@/shared/components/index.js';

export interface ViewportProps {
  /** 视口变换状态 */
  viewport: Viewport;
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
  viewport,
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
  // 网格背景: 通过 background-image 实现,随视口平移和缩放
  // dots 模式用固定 1.15px 圆点;缩放 < 25% 时隐藏点阵
  // 缩放从 25% → 100% 过程中,点阵透明度从 0 线性恢复到原始值
  const gridBackground = React.useMemo(() => {
    if (background === 'none') return 'none';
    const dotColor = grid_dot_color ?? grid_color;
    const lineColor = grid_line_color ?? grid_color;
    if (background === 'dots') {
      // 缩放低于阈值时隐藏点阵
      if (viewport.k < 0.25) return 'none';
      // 提取 RGB,动态控制透明度: k=0.25→0, k=1→原始 alpha
      const rgbMatch = dotColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const rgb = rgbMatch ? `${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]}` : '245,245,244';
      const zoomFactor = Math.max(0, Math.min(1, (viewport.k - 0.25) / 0.75));
      // 从原始色中提取 baseAlpha(默认 0.24)
      const alphaMatch = dotColor.match(/[\d.]+\)$/);
      const baseAlpha = alphaMatch ? parseFloat(alphaMatch[0].replace(')', '')) : 0.24;
      const dotAlpha = (baseAlpha * zoomFactor).toFixed(3);
      return `radial-gradient(circle, rgba(${rgb},${dotAlpha}) 1.15px, transparent 1.35px)`;
    }
    // lines
    return `
      linear-gradient(to right, ${lineColor} 1px, transparent 1px),
      linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)
    `;
  }, [background, grid_color, grid_dot_color, grid_line_color, viewport.k]);

  const gridSize = grid_size * viewport.k;
  const gridPosition = `${viewport.x % gridSize}px ${viewport.y % gridSize}px`;

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
        ref={containerRef as React.Ref<HTMLDivElement>}
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
          backgroundImage: gridBackground,
          backgroundSize: background === 'none' ? undefined : `${gridSize}px ${gridSize}px`,
          backgroundPosition: background === 'none' ? undefined : gridPosition,
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
