/**
 * EdgeLayer - 连线渲染层
 * 遍历 graph.edges,渲染贝塞尔曲线连线
 * 使用 SVG,随视口变换
 *
 * 性能优化:
 * 1. 内部 useViewport 订阅,不接收 viewport prop(避免父组件重渲染波及)
 * 2. React.memo 包裹(CanvasView 无关重渲染时不重新计算)
 * 3. P0-3: 每条边拆为独立 memo EdgeItem —— 路径仅在该边两端节点记录引用
 *    变化时重算(拖拽时只重算与被拖节点相连的边,而非全量)
 * 4. P0-4: 可见线宽用 vector-effect: non-scaling-stroke(屏幕恒定),
 *    去除每边 strokeWidth×(1/k) 计算
 *
 * 动效:
 * - 选中/关联节点选中:单层 SMIL stroke-dashoffset 流动(UE5 调试模式风格)
 * - 光辉底层:宽 stroke + 低 opacity 光晕
 *
 * 交互:
 * - 点击连线弹出工具栏:裁剪(支持移动端)
 */

import React, { useMemo } from 'react';
import type { EdgeRecord, NodeRecord, NodeTypeExtension, Pin } from '@zeroexo/core';
import type { ReactGraphStore } from '../store.js';
import { useViewport } from '../store.js';
import { usePinDefaults } from '../pin-defaults.js';
import type { PinDefaults } from '../pin-defaults.js';

/**
 * Pin 布局常量(须与 NodeShell 渲染布局保持一致)。
 * - NODE_PIN_PADDING:   引脚容器上下 padding(8px)
 * NodeShell 用 flex column + space-around 垂直均匀分布引脚,
 * 此处用相同公式计算引脚中心 y,保证连线起止点对齐渲染的引脚圆点。
 *
 * X 坐标:引脚容器在节点外部(left:-52 / right:-52),圆点贴节点边缘外侧。
 * - input 圆点中心 = 节点左边缘 - pinSize/2(圆点在节点外侧)
 * - output 圆点中心 = 节点右边缘 + pinSize/2(圆点在节点外侧)
 * 连线端点吸附至节点外轮廓边缘,消除留白间隙。
 */
const NODE_PIN_PADDING = 8;

export interface EdgeLayerProps {
  edges: EdgeRecord[];
  nodes: NodeRecord[];
  /** 节点类型扩展(用于查 getPins,精确计算引脚位置) */
  extensions: Map<string, NodeTypeExtension>;
  /** store(内部用于订阅 viewport) */
  store: ReactGraphStore;
  /** 选中边 id 集合 */
  selectedIds: Set<string>;
  /** 选中节点 id 集合(用于关联连线高亮) */
  selectedNodeIds?: Set<string>;
  /** 悬停边 id */
  hoveredId?: string;
  /** 默认边色 */
  edgeColor?: string;
  /** 选中边色 */
  edgeSelectedColor?: string;
  /** 悬停边色 */
  edgeHoverColor?: string;
  /** 边路径类型: bezier=贝塞尔曲线(默认), smoothstep=平滑阶梯(组织图风格) */
  edgePathType?: 'bezier' | 'smoothstep';
  /** 边指针事件(由 interaction 插件处理) */
  onEdgePointerDown?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerEnter?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerLeave?: (e: React.PointerEvent, edgeId: string) => void;
  /** 裁切连线回调(工具栏裁剪按钮点击时触发) */
  onCutEdge?: (edgeId: string) => void;
}

interface EdgeEndpoints {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

/**
 * 计算引脚圆点中心在节点上的世界坐标(与 NodeShell 的 flex space-around 布局一致)。
 * input 引脚圆点贴节点左边缘,output 引脚圆点贴节点右边缘,垂直均匀分布。
 */
function computePinPoint(
  node: NodeRecord,
  size: { width: number; height: number },
  pinId: string | undefined,
  extensions: Map<string, NodeTypeExtension>,
  _pinDefaults: PinDefaults,
  invK: number,
): { x: number; y: number } | null {
  if (!pinId) return null;

  // group 节点:用 bounds 计算连线端点
  if (node.type === 'group' && node.bounds) {
    const bounds = node.bounds;
    const isInput = pinId === '__group_in__';
    const x = isInput ? bounds.x : bounds.x + bounds.width;
    const y = bounds.y + bounds.height / 2;
    return { x, y };
  }

  const ext = extensions.get(node.type);
  const pins: Pin[] | undefined = ext?.getPins?.(node);
  if (!pins || pins.length === 0) return null;
  const pin = pins.find((p) => p.id === pinId);
  if (!pin) return null;
  const sameDir = pins.filter((p) => p.direction === pin.direction);
  const idx = sameDir.findIndex((p) => p.id === pinId);
  if (idx < 0) return null;
  const N = sameDir.length;
  const nodePad = NODE_PIN_PADDING * invK;
  const pinAreaPad = NODE_PIN_PADDING;
  const totalPad = nodePad + pinAreaPad;
  const contentH = size.height - totalPad * 2;
  const y = node.position.y + totalPad + (idx + 0.5) * (contentH / N);
  const x = pin.direction === 'input'
    ? node.position.x
    : node.position.x + size.width;
  return { x, y };
}

/** 计算边的起止点（两端节点记录已知，P0-3 供 EdgeItem 使用） */
function getEdgeEndpointsFor(
  source: NodeRecord,
  target: NodeRecord,
  edge: EdgeRecord,
  extensions: Map<string, NodeTypeExtension>,
  pinDefaults: PinDefaults,
  invK: number,
): EdgeEndpoints {
  const sourceExt = extensions.get(source.type);
  const targetExt = extensions.get(target.type);
  const sourceSize = source.size ?? sourceExt?.defaultSize ?? { width: 200, height: 100 };
  const targetSize = target.size ?? targetExt?.defaultSize ?? { width: 200, height: 100 };

  const sp = computePinPoint(source, sourceSize, edge.source.pinId, extensions, pinDefaults, invK);
  const tp = computePinPoint(target, targetSize, edge.target.pinId, extensions, pinDefaults, invK);

  const sourceFallbackX = source.type === 'group' && source.bounds
    ? source.bounds.x + source.bounds.width
    : source.position.x + sourceSize.width;
  const sourceFallbackY = source.type === 'group' && source.bounds
    ? source.bounds.y + source.bounds.height / 2
    : source.position.y + sourceSize.height / 2;
  const targetFallbackX = target.type === 'group' && target.bounds
    ? target.bounds.x
    : target.position.x;
  const targetFallbackY = target.type === 'group' && target.bounds
    ? target.bounds.y + target.bounds.height / 2
    : target.position.y + targetSize.height / 2;

  return {
    sourceX: sp?.x ?? sourceFallbackX,
    sourceY: sp?.y ?? sourceFallbackY,
    targetX: tp?.x ?? targetFallbackX,
    targetY: tp?.y ?? targetFallbackY,
  };
}

/** 计算边的起止点（P0-2：节点查找走索引，仅工具栏等低频路径使用） */
function getEdgeEndpoints(
  edge: EdgeRecord,
  nodesById: Map<string, NodeRecord>,
  extensions: Map<string, NodeTypeExtension>,
  pinDefaults: PinDefaults,
  invK: number,
): EdgeEndpoints | null {
  const source = nodesById.get(edge.source.nodeId);
  const target = nodesById.get(edge.target.nodeId);
  if (!source || !target) return null;
  return getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invK);
}

/** 生成三次贝塞尔曲线路径 */
function bezierPath(endpoints: EdgeEndpoints): string {
  const { sourceX, sourceY, targetX, targetY } = endpoints;
  const dx = Math.abs(targetX - sourceX);
  const offset = Math.max(40, dx * 0.5);
  return `M ${sourceX} ${sourceY} C ${sourceX + offset} ${sourceY}, ${targetX - offset} ${targetY}, ${targetX} ${targetY}`;
}

/** 生成平滑阶梯路径(组织图风格,无弯折) */
function smoothstepPath(endpoints: EdgeEndpoints): string {
  const { sourceX, sourceY, targetX, targetY } = endpoints;
  const midX = (sourceX + targetX) / 2;
  return `M ${sourceX} ${sourceY} 
          C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
}

/** 计算贝塞尔 t=0.5 中点 */
function bezierMidpoint(endpoints: EdgeEndpoints): { x: number; y: number } {
  const { sourceX, sourceY, targetX, targetY } = endpoints;
  const dx = Math.abs(targetX - sourceX);
  const offset = Math.max(40, dx * 0.5);
  const isOutput = sourceX < targetX;
  const c1x = isOutput ? sourceX + offset : sourceX - offset;
  const c1y = sourceY;
  const c2x = isOutput ? targetX - offset : targetX + offset;
  const c2y = targetY;
  return {
    x: 0.125 * sourceX + 0.375 * c1x + 0.375 * c2x + 0.125 * targetX,
    y: 0.125 * sourceY + 0.375 * c1y + 0.375 * c2y + 0.125 * targetY,
  };
}

const TOOLBAR_W = 32;
const TOOLBAR_H = 32;

/**
 * EdgeItem - 单条边(memo 包裹,P0-3 per-edge 增量重算)。
 * 路径仅在两端节点记录引用/几何参数变化时重算;
 * 拖拽时只有与被拖节点相连的边拿到新 source/target 引用。
 */
const EdgeItem = React.memo(function EdgeItem({
  edge,
  source,
  target,
  extensions,
  pinDefaults,
  invK,
  pathFn,
  stroke,
  sw,
  isActive,
  onEdgePointerDown,
  onEdgePointerEnter,
  onEdgePointerLeave,
}: {
  edge: EdgeRecord;
  source: NodeRecord;
  target: NodeRecord;
  extensions: Map<string, NodeTypeExtension>;
  pinDefaults: PinDefaults;
  invK: number;
  pathFn: (endpoints: EdgeEndpoints) => string;
  stroke: string;
  sw: number;
  isActive: boolean;
  onEdgePointerDown?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerEnter?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerLeave?: (e: React.PointerEvent, edgeId: string) => void;
}): React.ReactElement | null {
  const endpoints = getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invK);
  if (!endpoints) return null;
  const d = pathFn(endpoints);
  return (
    <g>
      {/* 光辉底层:粗 stroke + 低 opacity(non-scaling-stroke:屏幕恒定线宽) */}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={sw * 2.8}
        vectorEffect="non-scaling-stroke"
        opacity={isActive ? 0.35 : 0.18}
        style={{ pointerEvents: 'none' }}
      />
      {/* 透明加宽命中区域(世界坐标宽度,与改造前行为一致) */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(18, sw * 10)}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onPointerDown={onEdgePointerDown ? (e) => onEdgePointerDown(e, edge.id) : undefined}
        onPointerEnter={onEdgePointerEnter ? (e) => onEdgePointerEnter(e, edge.id) : undefined}
        onPointerLeave={onEdgePointerLeave ? (e) => onEdgePointerLeave(e, edge.id) : undefined}
      />
      {/* 主线 */}
      <path
        data-edge-id={edge.id}
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: 'none' }}
      />
      {/* 能量流动特效:SMIL stroke-dashoffset 流动(选中/关联节点选中时)
           * 红色脉冲,加长脉冲:dasharray "16 80"(周期 96) */}
      {isActive && (
        <path
          d={d}
          fill="none"
          stroke="#e94560"
          strokeWidth={sw * 2}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="16 80"
          strokeLinecap="round"
          opacity={0.85}
        >
          <animate
            attributeName="stroke-dashoffset"
            from="96"
            to="0"
            dur="1.5s"
            repeatCount="indefinite"
          />
        </path>
      )}
    </g>
  );
});

/** EdgeLayer 容器 */
export const EdgeLayer = React.memo(function EdgeLayer({
  edges,
  nodes: _nodes,
  extensions,
  store,
  selectedIds,
  selectedNodeIds,
  hoveredId,
  edgeColor = 'rgba(255,255,255,0.55)',
  edgeSelectedColor = '#e94560',
  edgeHoverColor = '#e94560',
  edgePathType = 'bezier',
  onEdgePointerDown,
  onEdgePointerEnter,
  onEdgePointerLeave,
  onCutEdge,
}: EdgeLayerProps): React.ReactElement {
  const viewport = useViewport(store);
  const invK = viewport.k > 0 ? 1 / viewport.k : 1;
  const pinDefaults = usePinDefaults();
  // P0-2：节点索引（graph 变更时重建，引用变化可作为 useMemo 依赖）
  const nodesById = store.getNodesById();

  // 选中边(仅一条时显示工具栏)
  const firstSelectedEdgeId = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    return selectedIds.values().next().value ?? null;
  }, [selectedIds]);

  const handleCut = useMemo(
    () => (edgeId: string) => onCutEdge?.(edgeId),
    [onCutEdge],
  );

  // 工具栏位置
  const toolbarData = useMemo(() => {
    if (!firstSelectedEdgeId) return null;
    const edge = edges.find((e) => e.id === firstSelectedEdgeId);
    if (!edge) return null;
    const endpoints = getEdgeEndpoints(edge, nodesById, extensions, pinDefaults, invK);
    if (!endpoints) return null;
    const mp = bezierMidpoint(endpoints);
    return {
      x: mp.x * viewport.k + viewport.x,
      y: mp.y * viewport.k + viewport.y,
    };
  }, [firstSelectedEdgeId, edges, nodesById, extensions, pinDefaults, invK, viewport]);

  // 路径生成函数(模块级函数引用稳定,可作为 EdgeItem memo 依赖)
  const pathFn = edgePathType === 'smoothstep' ? smoothstepPath : bezierPath;

  return (
    <svg
      data-canvas-edge-layer
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      
      <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.k})`}>
        {/* P1-4: 非活跃边合并为单 path(视觉),减少 SVG 元素数量 */}
        {(() => {
          const inactivePaths: string[] = [];
          let hasInactive = false;
          for (const edge of edges) {
            const isSelected = selectedIds.has(edge.id);
            const isHovered = hoveredId === edge.id;
            const isNodeConnected = !!(selectedNodeIds?.has(edge.source.nodeId) || selectedNodeIds?.has(edge.target.nodeId));
            const isActive = isSelected || isHovered || isNodeConnected;
            if (isActive) continue;
            const source = nodesById.get(edge.source.nodeId);
            const target = nodesById.get(edge.target.nodeId);
            if (!source || !target) continue;
            const endpoints = getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invK);
            if (!endpoints) continue;
            inactivePaths.push(pathFn(endpoints));
            hasInactive = true;
          }
          if (!hasInactive) return null;
          return (
            <path
              d={inactivePaths.join(' ')}
              fill="none"
              stroke={edgeColor}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              opacity={0.55}
              style={{ pointerEvents: 'none' }}
            />
          );
        })()}
        {/* P1-4: 非活跃边透明命中区域(每边独立,保证点击/悬停可正常交互) */}
        {(() => {
          const targets: React.ReactElement[] = [];
          for (const edge of edges) {
            const isSelected = selectedIds.has(edge.id);
            const isHovered = hoveredId === edge.id;
            const isNodeConnected = !!(selectedNodeIds?.has(edge.source.nodeId) || selectedNodeIds?.has(edge.target.nodeId));
            const isActive = isSelected || isHovered || isNodeConnected;
            if (isActive) continue;
            const source = nodesById.get(edge.source.nodeId);
            const target = nodesById.get(edge.target.nodeId);
            if (!source || !target) continue;
            const endpoints = getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invK);
            if (!endpoints) continue;
            const d = pathFn(endpoints);
            targets.push(
              <path
                key={edge.id}
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(18, 1.5 * 10)}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onPointerDown={onEdgePointerDown ? (e) => onEdgePointerDown(e, edge.id) : undefined}
                onPointerEnter={onEdgePointerEnter ? (e) => onEdgePointerEnter(e, edge.id) : undefined}
                onPointerLeave={onEdgePointerLeave ? (e) => onEdgePointerLeave(e, edge.id) : undefined}
              />,
            );
          }
          return targets.length > 0 ? <>{targets}</> : null;
        })()}
        {/* P0-3: per-edge memo EdgeItem —— 仅活跃边保留多层结构(光晕/命中/主线/动画) */}
        {edges.map((edge) => {
          const source = nodesById.get(edge.source.nodeId);
          const target = nodesById.get(edge.target.nodeId);
          if (!source || !target) return null;
          const isSelected = selectedIds.has(edge.id);
          const isHovered = hoveredId === edge.id;
          const isNodeConnected = !!(selectedNodeIds?.has(edge.source.nodeId) || selectedNodeIds?.has(edge.target.nodeId));
          const isActive = isSelected || isHovered || isNodeConnected;
          if (!isActive) return null; // 非活跃边已由上方合并 path 渲染
          const stroke = isSelected || isNodeConnected ? edgeSelectedColor : isHovered ? edgeHoverColor : edgeColor;
          // P0-4: 屏幕恒定线宽(non-scaling-stroke),不再乘 1/k
          const sw = isActive ? 2.5 : 1.5;
          return (
            <EdgeItem
              key={edge.id}
              edge={edge}
              source={source}
              target={target}
              extensions={extensions}
              pinDefaults={pinDefaults}
              invK={invK}
              pathFn={pathFn}
              stroke={stroke}
              sw={sw}
              isActive={isActive}
              onEdgePointerDown={onEdgePointerDown}
              onEdgePointerEnter={onEdgePointerEnter}
              onEdgePointerLeave={onEdgePointerLeave}
            />
          );
        })}
      </g>
      {/* 工具栏 */}
      {toolbarData && (
        <foreignObject
          x={toolbarData.x - TOOLBAR_W / 2}
          y={toolbarData.y - TOOLBAR_H / 2 - 6}
          width={TOOLBAR_W}
          height={TOOLBAR_H}
          style={{ pointerEvents: 'auto' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              gap: 4,
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              padding: 0,
              boxShadow: 'none',
              pointerEvents: 'auto',
              width: '100%',
              height: '100%',
              boxSizing: 'border-box',
            }}
          >
            <button
              type="button"
              title="裁剪连线"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (firstSelectedEdgeId) handleCut(firstSelectedEdgeId);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                flexShrink: 0,
                border: 'none',
                borderRadius: '50%',
                background: 'rgba(233, 69, 96, 0.9)',
                color: '#fff',
                outline: '1px solid rgba(233, 69, 96, 0.9)',
                outlineOffset: '1px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'inherit',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="3" />
                <path d="M8.12 8.12 12 12" />
                <path d="M20 4 8.12 15.88" />
                <circle cx="6" cy="18" r="3" />
                <path d="M14.8 14.8 20 20" />
              </svg>
            </button>
          </div>
        </foreignObject>
      )}
    </svg>
  );
});
