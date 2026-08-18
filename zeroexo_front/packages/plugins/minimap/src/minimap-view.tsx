/**
 * MinimapView - 缩略图视图(Canvas 渲染)
 *
 * 改进点(相对源项目 canvas-mini-map.tsx):
 * 1. Canvas 渲染替代 DOM div, 支持 5000+ 节点
 * 2. 节点密度采样: 超过 500 节点时按等间隔采样, 避免逐个绘制
 * 3. 视口框拖拽: 点击/拖动 minimap 直接平移 viewport
 * 4. 节点颜色: 优先从 node-registry 获取, 未注册用 type 哈希生成
 *
 * 订阅:
 * - graph (节点列表) via useSyncExternalStore
 * - viewport (平移/缩放) via useSyncExternalStore
 */

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { NodeRecord, Viewport } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeRegistryPlugin } from '@zeroexo/plugin-node-registry';

// ===== 主题(参考 React Flow MiniMap 风格) =====
const THEME = {
  bg: '#f0f0f0',
  border: '#bbb',
  nodeStroke: 'rgba(0,0,0,0.35)',
  nodeFill: 'rgba(0,0,0,0.05)',
  viewportStroke: '#555',
  viewportFill: 'rgba(0,0,0,0.05)',
  viewportDash: [3, 3],
} as const;

/** 节点采样上限(超过此值触发密度采样) */
const SAMPLE_THRESHOLD = 500;

// ===== 类型 =====

export interface MinimapViewProps {
  store: ReactGraphStore;
  /** 节点注册中心(可选, 用于获取节点颜色和默认尺寸) */
  registry?: NodeRegistryPlugin;
  /** minimap 宽度(像素) */
  width?: number;
  /** minimap 高度(像素) */
  height?: number;
  /** 视口容器尺寸(用于计算视口框) */
  viewportSize: { width: number; height: number };
  /** 视口变化回调(拖拽 minimap 时触发) */
  onViewportChange: (viewport: Viewport) => void;
  /** 自定义节点颜色覆盖(优先级最高) */
  getNodeColor?: (node: NodeRecord) => string;
  /** 默认节点尺寸(当 NodeRecord.size 和 registry 都无值时) */
  defaultNodeSize?: { width: number; height: number };
  /**
   * 节点过滤(配置式,非硬编码):返回 true 保留,返回 false 从 minimap 中排除。
   * 典型用法:排除 group 节点 `(n) => n.type !== 'group'`,
   * 或仅显示某类节点 `(n) => n.type === 'text'`。
   * 不传则绘制全部节点。
   */
  nodeFilter?: (node: NodeRecord) => boolean;
}

// ===== 主组件 =====

export function MinimapView({
  store,
  registry,
  width = 240,
  height = 160,
  viewportSize,
  onViewportChange,
  getNodeColor,
  defaultNodeSize = { width: 200, height: 80 },
  nodeFilter,
}: MinimapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 订阅 graph + viewport
  const graph = useSyncExternalStore(store.subscribeGraph, store.getGraph, store.getGraph);
  const viewport = useSyncExternalStore(store.subscribeViewport, store.getViewport, store.getViewport);

  // 配置式过滤(非硬编码):nodeFilter 决定哪些节点进入 minimap
  const visibleNodes = nodeFilter ? graph.nodes.filter(nodeFilter) : graph.nodes;

  // 计算 worldBounds / scale / offset(基于过滤后的节点)
  const { worldBounds, scale, offset } = computeBounds(visibleNodes, width, height);

  // 坐标转换
  const toMinimap = useCallback(
    (worldX: number, worldY: number): { x: number; y: number } => {
      return {
        x: (worldX - worldBounds.x) * scale + offset.x,
        y: (worldY - worldBounds.y) * scale + offset.y,
      };
    },
    [worldBounds, scale, offset],
  );

  const toWorld = useCallback(
    (minimapX: number, minimapY: number): { x: number; y: number } => {
      return {
        x: (minimapX - offset.x) / scale + worldBounds.x,
        y: (minimapY - offset.y) / scale + worldBounds.y,
      };
    },
    [worldBounds, scale, offset],
  );

  // P1-2: rAF 节流 refs — 最多 30fps (33ms)
  const THROTTLE_MS = 33;
  const lastDrawTimeRef = useRef(0);
  const pendingRafRef = useRef<number>(0);

  // ===== Canvas 渲染(节流版) =====
  useEffect(() => {
    const draw = (): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 高 DPI 适配
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 清空 + 背景
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = THEME.bg;
      ctx.fillRect(0, 0, width, height);

      // 节点采样(超阈值时等间隔采样,基于已过滤的 visibleNodes)
      const nodesToDraw =
        visibleNodes.length > SAMPLE_THRESHOLD
          ? sampleNodes(visibleNodes, SAMPLE_THRESHOLD)
          : visibleNodes;

      // 绘制节点(React Flow MiniMap 风格:描边+半透明填充,圆角矩形)
      const radius = 2; // 圆角半径(minimap 坐标)
      for (const node of nodesToDraw) {
        const size = getNodeSize(node, registry, defaultNodeSize);
        const pos = toMinimap(node.position.x, node.position.y);
        const w = Math.max(size.width * scale, 2);
        const h = Math.max(size.height * scale, 2);
        const color = resolveNodeColor(node, registry, getNodeColor);
        // 半透明填充(hash 色块,更鲜艳)
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.roundRect(pos.x, pos.y, w, h, radius);
        ctx.fill();
        // 描边(更明显的颜色)
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(pos.x, pos.y, w, h, radius);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 绘制视口框(React Flow MiniMap 风格:虚线边框 + 半透明填充)
      const vx = -viewport.x / viewport.k;
      const vy = -viewport.y / viewport.k;
      const vw = viewportSize.width / viewport.k;
      const vh = viewportSize.height / viewport.k;
      const p1 = toMinimap(vx, vy);
      const p2 = toMinimap(vx + vw, vy + vh);
      const rectX = p1.x;
      const rectY = p1.y;
      const rectW = Math.max(p2.x - p1.x, 4);
      const rectH = Math.max(p2.y - p1.y, 4);

      ctx.fillStyle = THEME.viewportFill;
      ctx.fillRect(rectX, rectY, rectW, rectH);
      ctx.strokeStyle = THEME.viewportStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(THEME.viewportDash);
      ctx.strokeRect(rectX, rectY, rectW, rectH);
      ctx.setLineDash([]);
    };

    // P1-2: rAF 节流 — 同帧内多次数据变更只绘制一次,帧间隔 < 33ms 时跳过
    const now = performance.now();
    if (now - lastDrawTimeRef.current < THROTTLE_MS) {
      // 节流: 推迟到下一帧绘制
      if (!pendingRafRef.current) {
        pendingRafRef.current = requestAnimationFrame(() => {
          pendingRafRef.current = 0;
          lastDrawTimeRef.current = performance.now();
          draw();
        });
      }
      return;
    }
    lastDrawTimeRef.current = now;
    draw();

    return () => {
      if (pendingRafRef.current) {
        cancelAnimationFrame(pendingRafRef.current);
        pendingRafRef.current = 0;
      }
    };
  }, [visibleNodes, viewport, width, height, viewportSize, toMinimap, registry, getNodeColor, defaultNodeSize]);

  // ===== 拖拽处理(拖拽偏移模式: 保持鼠标在视口框内的相对位置) =====

  // 拖拽偏移量(世界坐标): 鼠标在视口框内的相对位置
  // pointerdown 时计算, pointermove 时保持
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /** 计算视口框在 minimap 中的位置(用于判断鼠标是否在内) */
  const getViewportRectInMinimap = useCallback((): {
    x: number;
    y: number;
    w: number;
    h: number;
  } => {
    const vx = -viewport.x / viewport.k;
    const vy = -viewport.y / viewport.k;
    const vw = viewportSize.width / viewport.k;
    const vh = viewportSize.height / viewport.k;
    const p1 = toMinimap(vx, vy);
    const p2 = toMinimap(vx + vw, vy + vh);
    return {
      x: p1.x,
      y: p1.y,
      w: Math.max(p2.x - p1.x, 4),
      h: Math.max(p2.y - p1.y, 4),
    };
  }, [viewport, viewportSize, toMinimap]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setIsDragging(true);

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const minimapX = e.clientX - rect.left;
      const minimapY = e.clientY - rect.top;
      const world = toWorld(minimapX, minimapY);

      // 视口框左上角世界坐标
      const vpLeftWorldX = -viewport.x / viewport.k;
      const vpLeftWorldY = -viewport.y / viewport.k;

      // 判断鼠标是否在视口框内
      const vpRect = getViewportRectInMinimap();
      const inViewport =
        minimapX >= vpRect.x &&
        minimapX <= vpRect.x + vpRect.w &&
        minimapY >= vpRect.y &&
        minimapY <= vpRect.y + vpRect.h;

      if (inViewport) {
        // 拖拽偏移模式: 保持鼠标在视口框内的相对位置
        dragOffsetRef.current = {
          x: world.x - vpLeftWorldX,
          y: world.y - vpLeftWorldY,
        };
      } else {
        // 中心模式: 视口中心跳到鼠标位置
        dragOffsetRef.current = {
          x: viewportSize.width / 2 / viewport.k,
          y: viewportSize.height / 2 / viewport.k,
        };
      }

      // 立即更新一次视口
      const newVpLeftWorldX = world.x - dragOffsetRef.current.x;
      const newVpLeftWorldY = world.y - dragOffsetRef.current.y;
      onViewportChange({
        x: -newVpLeftWorldX * viewport.k,
        y: -newVpLeftWorldY * viewport.k,
        k: viewport.k,
      });
    },
    [toWorld, viewport, viewportSize, getViewportRectInMinimap, onViewportChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const minimapX = e.clientX - rect.left;
      const minimapY = e.clientY - rect.top;
      const world = toWorld(minimapX, minimapY);

      // 保持拖拽偏移: 视口框左上角 = 鼠标世界坐标 - dragOffset
      const newVpLeftWorldX = world.x - dragOffsetRef.current.x;
      const newVpLeftWorldY = world.y - dragOffsetRef.current.y;
      onViewportChange({
        x: -newVpLeftWorldX * viewport.k,
        y: -newVpLeftWorldY * viewport.k,
        k: viewport.k,
      });
    },
    [isDragging, toWorld, viewport.k, onViewportChange],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        borderRadius: 6,
        border: `1px solid ${THEME.border}`,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}

// ===== 工具函数 =====

/** 计算 worldBounds / scale / offset */
function computeBounds(
  nodes: NodeRecord[],
  width: number,
  height: number,
): {
  worldBounds: { x: number; y: number; w: number; h: number };
  scale: number;
  offset: { x: number; y: number };
} {
  if (nodes.length === 0) {
    const w = 1000;
    const h = 1000;
    return {
      worldBounds: { x: -500, y: -500, w, h },
      scale: Math.min(width / w, height / h),
      offset: { x: 0, y: 0 },
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const size = node.size ?? { width: 200, height: 80 };
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  // padding 避免节点贴边
  const padding = 200;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const boundsW = maxX - minX;
  const boundsH = maxY - minY;
  const scale = Math.min(width / boundsW, height / boundsH);
  const contentW = boundsW * scale;
  const contentH = boundsH * scale;

  return {
    worldBounds: { x: minX, y: minY, w: boundsW, h: boundsH },
    scale,
    offset: { x: (width - contentW) / 2, y: (height - contentH) / 2 },
  };
}

/** 等间隔采样 */
function sampleNodes(nodes: NodeRecord[], limit: number): NodeRecord[] {
  const step = nodes.length / limit;
  const sampled: NodeRecord[] = [];
  for (let i = 0; i < nodes.length; i += step) {
    const node = nodes[Math.floor(i)];
    if (node) sampled.push(node);
  }
  return sampled;
}

/** 获取节点尺寸 */
function getNodeSize(
  node: NodeRecord,
  registry: NodeRegistryPlugin | undefined,
  defaultSize: { width: number; height: number },
): { width: number; height: number } {
  if (node.size) return node.size;
  const def = registry?.get(node.type);
  if (def?.defaultSize) return def.defaultSize;
  return defaultSize;
}

/** 解析节点颜色(使用 hash 色块,与 block-canvas-layer 的骨架屏颜色独立) */
function resolveNodeColor(
  node: NodeRecord,
  _registry: NodeRegistryPlugin | undefined,
  override?: (node: NodeRecord) => string,
): string {
  if (override) return override(node);
  // 始终使用 hash 色块,还原为之前的彩色小地图风格
  return hashColor(node.type);
}

/** 字符串哈希 → HSL 颜色 */
function hashColor(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 50%)`;
}
