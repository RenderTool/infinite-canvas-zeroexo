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

import React, { useMemo, useEffect, useRef, useState, useLayoutEffect } from 'react';
import type { EdgeRecord, NodeRecord, NodeTypeExtension, Pin, Viewport } from '@zeroexo/core';
import type { ReactGraphStore } from '../store.js';
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

/**
 * 缩放系数的相对量化(百分比桶)。
 * 缩放动画中 viewport.k 每帧连续变化(约 1-2%/帧),直接用 k 做 useMemo 依赖会令
 * 每条边路径每帧重建;量化到 5% 桶后,同一手势内仅跨桶帧才重建。
 * 桶心取整保证停止缩放后回到精确值,无残留误差。
 * 返回与 k 同单位,调用方可用 1/返回 值作为 invK 派生量(如 4672 边路径缓存)。
 */
export function quantizeZoom(k: number, bucket = 0.05): number {
  if (!Number.isFinite(k) || k <= 0) return k;
  const exp = Math.floor(Math.log(k) / Math.LN2);
  const base = Math.pow(2, exp); // k = base * mantissa, mantissa ∈ [1, 2)
  const mantissa = k / base;
  // +1e-9 微扰动:桶心值(如 1.65)因浮点舍入得 (m-1)=0.6499... 会跌入上一桶,
  // 破坏幂等性;扰动量远小于桶宽,不会越过真实边界。
  const step = Math.min(1 + Math.floor((mantissa - 1 + 1e-9) / bucket) * bucket, 2 - bucket);
  return base * step;
}

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
  const y = (node.position?.y ?? 0) + totalPad + (idx + 0.5) * (contentH / N);
  const x = pin.direction === 'input'
    ? (node.position?.x ?? 0)
    : (node.position?.x ?? 0) + size.width;
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
    : (source.position?.x ?? 0) + sourceSize.width;
  const sourceFallbackY = source.type === 'group' && source.bounds
    ? source.bounds.y + source.bounds.height / 2
    : (source.position?.y ?? 0) + sourceSize.height / 2;
  const targetFallbackX = target.type === 'group' && target.bounds
    ? target.bounds.x
    : (target.position?.x ?? 0);
  const targetFallbackY = target.type === 'group' && target.bounds
    ? target.bounds.y + target.bounds.height / 2
    : (target.position?.y ?? 0) + targetSize.height / 2;

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

/** 生成直线路径(边 LOD 低缩放档位使用):低缩放时贝塞尔细节不可见,直线段
 *  d 字符串更短、光栅化更便宜(4854 条边合并 path 的解析/绘制成本显著下降)。 */
function linePath(endpoints: EdgeEndpoints): string {
  const { sourceX, sourceY, targetX, targetY } = endpoints;
  return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
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
 * 边 LOD 阈值:低于此缩放时
 * 1) 视觉合并 path 直线化(linePath)——贝塞尔细节在低缩放不可见,直线段光栅化便宜;
 * 2) 非活跃边命中区(hit path)整层降级为不渲染——低缩放时 18px(世界坐标)的透明
 *    粗 stroke 在屏幕上不足 6px 且命中不可靠,光栅化面积却巨大(4854 条 path 是
 *    paint 瓶颈),去掉既省成本又不牺牲可用交互(低缩放下用户也不做边级点选)。
 * 与节点层 LOD(k<0.35 占位)同一阈值,缩放感知节奏一致。
 */
const EDGE_LOD_THRESHOLD = 0.35;

/**
 * 活跃边动画层上限(Plan#14 T2):活跃边数量超过该值时关闭 SMIL 动画脉冲层。
 * 阈值常量模块级定义,便于调参(Plan#14 约束 4)。
 */
const ACTIVE_EDGE_ANIM_LIMIT = 60;
/** 活跃边光辉层上限(Plan#14 T2):超过该值时光辉层 opacity 减半降级。 */
const ACTIVE_EDGE_GLOW_LIMIT = 150;

/**
 * 边的活跃判定:选中/悬停/任一端节点被选中(容器循环与 ActiveVisualLayer 共用)。
 * 原为容器内闭包,提取为模块级避免两处判定漂移。
 */
function isEdgeActive(
  edge: EdgeRecord,
  selectedIds: Set<string>,
  hoveredId: string | undefined,
  selectedNodeIds: Set<string> | undefined,
): boolean {
  return (
    selectedIds.has(edge.id) ||
    hoveredId === edge.id ||
    !!(selectedNodeIds?.has(edge.source.nodeId) || selectedNodeIds?.has(edge.target.nodeId))
  );
}

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
  store,
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
  store: ReactGraphStore;
  onEdgePointerDown?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerEnter?: (e: React.PointerEvent, edgeId: string) => void;
  onEdgePointerLeave?: (e: React.PointerEvent, edgeId: string) => void;
}): React.ReactElement | null {
  const endpoints = getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invK);
  if (!endpoints) return null;
  const d = pathFn(endpoints);

  // P0-2 拖动瞬态通道:interaction 拖动期间 graph 不变,这里订阅偏移表,
  // 每帧用「起点 position + 偏移」重算 path 并直写 SVG d(连线实时跟随拖动集)。
  const gRef = useRef<SVGGElement | null>(null);
  const latestSourceRef = useRef(source);
  latestSourceRef.current = source;
  const latestTargetRef = useRef(target);
  latestTargetRef.current = target;
  const latestEdgeRef = useRef(edge);
  latestEdgeRef.current = edge;
  const latestExtRef = useRef(extensions);
  latestExtRef.current = extensions;
  const latestPinRef = useRef(pinDefaults);
  latestPinRef.current = pinDefaults;
  const latestInvKRef = useRef(invK);
  latestInvKRef.current = invK;
  const latestPathFnRef = useRef(pathFn);
  latestPathFnRef.current = pathFn;
  useEffect(() => {
    return store.subscribeDragOffsets(() => {
      const g = gRef.current;
      if (!g) return;
      const offsets = store.getDragOffsets();
      if (offsets.size === 0) return;
      const s = latestSourceRef.current;
      const t = latestTargetRef.current;
      const e = latestEdgeRef.current;
      if (!s || !t) return;
      const offS = offsets.get(s.id);
      const offT = offsets.get(t.id);
      if (!offS && !offT) return;
      const shiftedS = offS
        ? { ...s, position: { x: (s.position?.x ?? 0) + offS.dx, y: (s.position?.y ?? 0) + offS.dy } }
        : s;
      const shiftedT = offT
        ? { ...t, position: { x: (t.position?.x ?? 0) + offT.dx, y: (t.position?.y ?? 0) + offT.dy } }
        : t;
      const shiftedEndpoints = getEdgeEndpointsFor(
        shiftedS,
        shiftedT,
        e,
        latestExtRef.current,
        latestPinRef.current,
        latestInvKRef.current,
      );
      if (!shiftedEndpoints) return;
      const shiftedD = latestPathFnRef.current(shiftedEndpoints);
      // 光晕/命中/主线(及激活脉冲)全部同步(d 相同)
      g.querySelectorAll('path').forEach((p) => p.setAttribute('d', shiftedD));
    });
  }, [store]);

  return (
    <g ref={gRef}>
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
      {/* 主线(光辉层与动画脉冲层已由 ActiveVisualLayer 按色合并渲染,见 Plan#14 T1) */}
      <path
        data-edge-id={edge.id}
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: 'none' }}
      />
    </g>
  );
});

/** 活跃边按颜色分组后的合并单元(光辉/动画同色同 opacity 才能合并) */
interface ActiveVisualGroup {
  stroke: string;
  edges: EdgeRecord[];
}

/**
 * ActiveVisualLayer - 活跃边视觉合并层(Plan#14 T1/T2)。
 *
 * 原实现中每条活跃边渲染 4 层 path(光辉 2.8× + 命中区 + 主线 + SMIL 动画脉冲),
 * 星形拓扑(1 中心节点连 500+ 边)或框选大片节点时 N 条边同时动画 × 3 层 paint
 * → 主线程饱和卡顿。本层将全部活跃边的「光辉底层 + 动画脉冲」按颜色分组合并为
 * 单 path + 单 <animate>(N→1),复用 inactiveMergedPath 的合并模式。
 *
 * 视觉保证:
 * - 合并 path 的 stroke-dashoffset 对多子路径天然各自流动(Plan#14 约束 1);
 * - 命中区/主线仍留在 EdgeItem(每边独立,保证点选/悬停/裁剪交互);
 * - 拖动瞬态通道与 EdgeItem 同模式:订阅偏移表直写合并 d(Plan#14 约束 2)。
 */
const ActiveVisualLayer = React.memo(function ActiveVisualLayer({
  groups,
  nodesById,
  extensions,
  pinDefaults,
  invKc,
  visualPathFn,
  store,
  animEnabled,
  glowOpacity,
}: {
  groups: ActiveVisualGroup[];
  nodesById: Map<string, NodeRecord>;
  extensions: Map<string, NodeTypeExtension>;
  pinDefaults: PinDefaults;
  invKc: number;
  visualPathFn: (endpoints: EdgeEndpoints) => string;
  store: ReactGraphStore;
  /** 动画脉冲层开关(T2 数量上限 / T3 边 LOD 时关闭,静态高亮不受影响) */
  animEnabled: boolean;
  /** 光辉层透明度(T2 超过 GLOW_LIMIT 时减半降级) */
  glowOpacity: number;
}): React.ReactElement | null {
  // 合并 d:每组边路径拼接为单条 path(与 inactiveMergedPath 同模式)
  const merged = useMemo(() => {
    const out: { stroke: string; d: string }[] = [];
    for (const g of groups) {
      const ds: string[] = [];
      for (const edge of g.edges) {
        const source = nodesById.get(edge.source.nodeId);
        const target = nodesById.get(edge.target.nodeId);
        if (!source || !target) continue;
        const endpoints = getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invKc);
        if (!endpoints) continue;
        ds.push(visualPathFn(endpoints));
      }
      if (ds.length > 0) out.push({ stroke: g.stroke, d: ds.join(' ') });
    }
    return out;
  }, [groups, nodesById, extensions, pinDefaults, invKc, visualPathFn]);

  // 拖动瞬态通道(与 EdgeItem 同模式):graph 不变,偏移表直写合并 d
  const gRefs = useRef<(SVGGElement | null)[]>([]);
  const latestRef = useRef({ groups, nodesById, extensions, pinDefaults, invKc, visualPathFn });
  latestRef.current = { groups, nodesById, extensions, pinDefaults, invKc, visualPathFn };
  useEffect(() => {
    return store.subscribeDragOffsets(() => {
      const offsets = store.getDragOffsets();
      if (offsets.size === 0) return;
      const { groups: gs, nodesById: nb, extensions: ext, pinDefaults: pd, invKc: ik, visualPathFn: vpf } = latestRef.current;
      gs.forEach((g, gi) => {
        const el = gRefs.current[gi];
        if (!el) return;
        const ds: string[] = [];
        for (const edge of g.edges) {
          const s = nb.get(edge.source.nodeId);
          const t = nb.get(edge.target.nodeId);
          if (!s || !t) continue;
          const offS = offsets.get(s.id);
          const offT = offsets.get(t.id);
          if (!offS && !offT) continue;
          const shiftedS = offS
            ? { ...s, position: { x: (s.position?.x ?? 0) + offS.dx, y: (s.position?.y ?? 0) + offS.dy } }
            : s;
          const shiftedT = offT
            ? { ...t, position: { x: (t.position?.x ?? 0) + offT.dx, y: (t.position?.y ?? 0) + offT.dy } }
            : t;
          const endpoints = getEdgeEndpointsFor(shiftedS, shiftedT, edge, ext, pd, ik);
          if (!endpoints) continue;
          ds.push(vpf(endpoints));
        }
        if (ds.length > 0) el.querySelectorAll('path').forEach((p) => p.setAttribute('d', ds.join(' ')));
      });
    });
  }, [store]);

  return (
    <>
      {merged.map((m, i) => (
        <g key={m.stroke} ref={(el) => { gRefs.current[i] = el; }}>
          {/* 光辉底层:合并同色边(宽度 7 = 原 2.5×2.8,非缩放描边屏幕恒定) */}
          <path
            d={m.d}
            fill="none"
            stroke={m.stroke}
            strokeWidth={7}
            vectorEffect="non-scaling-stroke"
            opacity={glowOpacity}
            style={{ pointerEvents: 'none' }}
          />
          {/* 能量流动特效:合并单 path + 单 <animate>(N→1,红色脉冲 dasharray "16 80" 周期 96) */}
          {animEnabled && (
            <path
              d={m.d}
              fill="none"
              stroke="#e94560"
              strokeWidth={5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="16 80"
              strokeLinecap="round"
              opacity={0.85}
              style={{ pointerEvents: 'none' }}
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
      ))}
    </>
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
  // === viewport transform 直写 <g> DOM（平移缩放零 React reconcile）===
  // 与 node-layer 同源:之前 useViewport 每帧触发 EdgeLayer 重渲染,所有 useMemo
  // 依赖虽命中缓存,但 JSX 重建 + 活跃边 map 每帧执行。现改为 g ref 直写 transform。
  // invK/edgeLod 仍需驱动路径重算,通过量化(5% 桶)低频 state 更新。
  const gRef = useRef<SVGGElement>(null);
  const [vpState, setVpState] = useState<{ k: number; invK: number }>({
    k: 1, invK: 1,
  });
  useLayoutEffect(() => {
    const apply = (vp: Viewport): void => {
      const k = vp.k > 0 ? vp.k : 1;
      const el = gRef.current;
      if (el) {
        el.setAttribute('transform', `translate(${vp.x}, ${vp.y}) scale(${k})`);
      }
    };
    apply(store.getViewport());
    return store.subscribeViewport(() => {
      const vp = store.getViewport();
      apply(vp);
      const k = vp.k > 0 ? vp.k : 1;
      const nextInvK = quantizeZoom(1 / k);
      setVpState((prev) => {
        const prevLod = prev.k < EDGE_LOD_THRESHOLD;
        const nextLod = k < EDGE_LOD_THRESHOLD;
        if (prev.invK === nextInvK && prevLod === nextLod) return prev;
        return { k, invK: nextInvK };
      });
    });
  }, [store]);
  const invK = 1 / vpState.k; // EdgeItem 用未量化值(命中区等需要精确)
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

  // 工具栏位置 —— 低频元素(仅单条边选中时显示),从 store 读最新 viewport 计算屏幕坐标,
  // 不订阅 viewport(避免平移时重渲染)。位置更新由 invK 量化 state 跨桶时顺带刷新。
  const toolbarData = useMemo(() => {
    if (!firstSelectedEdgeId) return null;
    const edge = edges.find((e) => e.id === firstSelectedEdgeId);
    if (!edge) return null;
    const endpoints = getEdgeEndpoints(edge, nodesById, extensions, pinDefaults, invK);
    if (!endpoints) return null;
    const vp = store.getViewport();
    const mp = bezierMidpoint(endpoints);
    return {
      x: mp.x * vp.k + vp.x,
      y: mp.y * vp.k + vp.y,
    };
  }, [firstSelectedEdgeId, edges, nodesById, extensions, pinDefaults, invK, store]);

  // 路径生成函数(模块级函数引用稳定,可作为 EdgeItem memo 依赖)
  const pathFn = edgePathType === 'smoothstep' ? smoothstepPath : bezierPath;

  // 性能(批次2):invK 相对量化(5% 桶)——缩放动画中 invK 每帧连续变化时,若原样进
  // useMemo 依赖,4672 条非活跃边的路径会每帧全量重建(字符串拼接 + hit 元素重建 +
  // 4672 个 d 属性更新,dev-performance 采集中 k 连续变化段帧率跌至 13-30fps)。
  // 量化后同一手势内仅跨桶的帧才重跑 memo body(约手势帧数的 1/20),其余命中缓存。
  // 注意:此处量化对象是 invK=1/k(computePinPoint 的 NODE_PIN_PADDING*invK 是屏幕恒定
  // 间距补偿),与 node-layer 的 NodeItem invK 量化保持同一函数、同一节奏。
  // 误差有界:端点世界坐标相对误差 ≤ ±bucket/2=2.5%,换算屏幕 ≈ ≤1px,仅动画期间可感知;
  // 停止缩放后 invKc 与真实值一致(落回桶心),无残留误差。
  const invKc = vpState.invK; // 已量化(5% 桶),用于非活跃边路径缓存
  // 边 LOD:低缩放(k < EDGE_LOD_THRESHOLD)时视觉边直线化 + 命中区整层降级。
  const edgeLod = vpState.k < EDGE_LOD_THRESHOLD;
  // 非活跃边视觉路径生成:低缩放用直线(linePath),正常档位保持曲线(pathFn)。
  // useMemo 稳定引用:直接三元会每渲染重建,破坏 EdgeItem 的 memo 命中(Plan#14 T3 直线化)。
  const visualPathFn = useMemo(() => (edgeLod ? linePath : pathFn), [edgeLod, pathFn]);
  // 性能(批次1):非活跃边计算提取为 useMemo,避免平移帧(k 不变时端点不变)全量重算。
  // 依赖含 invKc(量化)/edges/nodesById/选中态;平移帧这些不变 → 命中缓存,零重算。
  const inactiveMergedPath = useMemo(() => {
    const inactivePaths: string[] = [];
    for (const edge of edges) {
      if (isEdgeActive(edge, selectedIds, hoveredId, selectedNodeIds)) continue;
      const source = nodesById.get(edge.source.nodeId);
      const target = nodesById.get(edge.target.nodeId);
      if (!source || !target) continue;
      const endpoints = getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invKc);
      if (!endpoints) continue;
      inactivePaths.push(visualPathFn(endpoints));
    }
    return inactivePaths.length > 0 ? inactivePaths.join(' ') : null;
  }, [edges, nodesById, extensions, pinDefaults, invKc, visualPathFn, selectedIds, hoveredId, selectedNodeIds]);

  // 性能(批次1):非活跃边透明命中区域(每边独立,保证点击/悬停可正常交互)也 memo 化。
  // 边 LOD:低缩放时整层降级为空 —— 透明粗 stroke 屏幕命中不足 6px 且光栅化面积巨大,
  // 是低缩放 paint 的主要来源;去掉后边级点选在低缩放不可用(视觉边仍显示)。
  const inactiveHitTargets = useMemo(() => {
    if (edgeLod) return [];
    const targets: React.ReactElement[] = [];
    for (const edge of edges) {
      if (isEdgeActive(edge, selectedIds, hoveredId, selectedNodeIds)) continue;
      const source = nodesById.get(edge.source.nodeId);
      const target = nodesById.get(edge.target.nodeId);
      if (!source || !target) continue;
      const endpoints = getEdgeEndpointsFor(source, target, edge, extensions, pinDefaults, invKc);
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
    return targets;
  }, [edges, nodesById, extensions, pinDefaults, invKc, pathFn, edgeLod, selectedIds, hoveredId, selectedNodeIds, onEdgePointerDown, onEdgePointerEnter, onEdgePointerLeave]);

  // Plan#14 T1:活跃边按颜色分组的合并单元(光辉/动画合并粒度)。
  // 活跃边颜色实际只有两档(选中/关联 → edgeSelectedColor,悬停 → edgeHoverColor)。
  const activeGroups = useMemo(() => {
    const byColor = new Map<string, EdgeRecord[]>();
    for (const edge of edges) {
      if (!isEdgeActive(edge, selectedIds, hoveredId, selectedNodeIds)) continue;
      const stroke =
        selectedIds.has(edge.id) || selectedNodeIds?.has(edge.source.nodeId) || selectedNodeIds?.has(edge.target.nodeId)
          ? edgeSelectedColor
          : hoveredId === edge.id
            ? edgeHoverColor
            : edgeColor;
      const list = byColor.get(stroke);
      if (list) list.push(edge);
      else byColor.set(stroke, [edge]);
    }
    return [...byColor.entries()].map(([stroke, list]) => ({ stroke, edges: list }));
  }, [edges, selectedIds, hoveredId, selectedNodeIds, edgeSelectedColor, edgeHoverColor, edgeColor]);

  // Plan#14 T2:活跃边数量阈值降级——>60 关动画脉冲,>150 光辉 opacity 减半。
  const activeCount = useMemo(
    () => activeGroups.reduce((n, g) => n + g.edges.length, 0),
    [activeGroups],
  );
  const animEnabled = !edgeLod && activeCount > 0 && activeCount <= ACTIVE_EDGE_ANIM_LIMIT;
  const glowOpacity = activeCount > ACTIVE_EDGE_GLOW_LIMIT ? 0.35 * 0.5 : 0.35;

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
      <g ref={gRef} data-canvas-edge-g>
        {/* transform 由 useLayoutEffect 订阅直写 DOM,平移缩放不触发 React 重渲染 */}
        {/* P1-4: 非活跃边合并为单 path(视觉),减少 SVG 元素数量 (批次1: useMemo 化) */}
        {inactiveMergedPath && (
          <path
            d={inactiveMergedPath}
            fill="none"
            stroke={edgeColor}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            opacity={0.55}
            style={{ pointerEvents: 'none' }}
          />
        )}
        {/* P1-4: 非活跃边透明命中区域(每边独立,保证点击/悬停可正常交互) (批次1: useMemo 化) */}
        {inactiveHitTargets.length > 0 ? <>{inactiveHitTargets}</> : null}
        {/* Plan#14 T1: 活跃边光辉/动画合并层(按色分组 N→1,渲染在 EdgeItem 之前:光辉在主线底层,脉冲两侧露出) */}
        {activeGroups.length > 0 && (
          <ActiveVisualLayer
            groups={activeGroups}
            nodesById={nodesById}
            extensions={extensions}
            pinDefaults={pinDefaults}
            invKc={invKc}
            visualPathFn={visualPathFn}
            store={store}
            animEnabled={animEnabled}
            glowOpacity={glowOpacity}
          />
        )}
        {/* P0-3: per-edge memo EdgeItem —— 活跃边仅保留命中区/主线(光辉/动画已合并) */}
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
              pathFn={visualPathFn}
              stroke={stroke}
              sw={sw}
              store={store}
              onEdgePointerDown={onEdgePointerDown}
              onEdgePointerEnter={onEdgePointerEnter}
              onEdgePointerLeave={onEdgePointerLeave}
            />
          );
        })}
      </g>
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
