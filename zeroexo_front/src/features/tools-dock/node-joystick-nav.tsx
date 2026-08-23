/**
 * NodeJoystickNav - 向量求交径向导航（征集#47 H6）
 *
 * 从导航按钮弹出，**按下即跟随**：红圈始终跟随指针（无论是否按住，降低理解门槛），
 * 确认方式二选一：按住拖拽到目标松手，或瞄准后直接点击。
 * 以「中心 → 红圈」连线向量为射线，对画布节点做 AABB 求交：
 * - 首个命中节点 → 红圈到节点边缘出现预览虚线 + 命中节点显示 hover 态（overlay 自绘等效阴影）
 * - 以导航原点（红圈中心）为圆心形成「土星环」判定环：射线命中节点且红圈越过环内缘 → 整链变绿（环高亮）→ 松手跳转；
 *   红圈拉回环内 = 取消（回红），无需精确落在环带内，体验更顺滑
 * - 未激活点击/松手 → 保持开启继续瞄准(点击空白则收起)
 *
 * 颜色铁律：默认红（主题 accent）；可跳转（engaged）时整链绿（红点→虚线→环→节点）；丢失目标回红。
 */

import React, { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraph, useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeRecord, NodeTypeExtension } from '@zeroexo/core';
import { resolveNodeSize } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { Compass } from 'lucide-react';
import { Z_INDEX } from '@/shared/constants/z-index.js';

export interface NodeJoystickNavProps {
  /** 触发按钮的屏幕坐标（用于定位 overlay 中心） */
  anchorX: number;
  anchorY: number;
  store: ReactGraphStore;
  nodeId: string;
  /** 节点扩展查询（尺寸契约统一解析层，由胶囊工具栏透传） */
  getExtension?: (nodeId: string) => NodeTypeExtension | undefined;
  onClose: () => void;
}

/** 中心死区半径（小于此值不求交） */
const CENTER_DEAD_ZONE = 12;
/** 土星环：以导航原点为圆心的环带中线半径 / 环带半宽（屏幕 px，紧凑版，用户手调） */
const RING_MID_RADIUS = 60;
const RING_HALF_BAND = 10;
/** 环内缘半径：红圈越过此值(向外)即视为激活，拉回此值以内 = 取消 */
const RING_INNER = RING_MID_RADIUS - RING_HALF_BAND;
/** 可跳转链路绿（主题无 success token，固定语义色） */
const GREEN = '#22c55e';
/** 收回动画时长 ms */
const COLLAPSE_MS = 200;

/** 射线求交命中结果（全部为相对 anchor 的屏幕坐标） */
interface RayHit {
  id: string;
  /** 射线与节点边缘交点 */
  hitX: number;
  hitY: number;
  /** 节点屏幕包围盒 */
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
}

/**
 * 以 anchor→follow 为射线，对节点 AABB 做 slab 求交，返回首个命中（最小 t）
 * 排除当前节点与组节点；视口为均匀缩放，屏幕方向即世界方向
 */
function castRayToNode(
  anchorX: number,
  anchorY: number,
  followX: number,
  followY: number,
  viewport: { x: number; y: number; k: number },
  canvasLeft: number,
  canvasTop: number,
  nodes: NodeRecord[],
  currentNodeId: string,
  getExtension?: (nodeId: string) => NodeTypeExtension | undefined,
): RayHit | null {
  const len = Math.sqrt(followX * followX + followY * followY);
  if (len < CENTER_DEAD_ZONE) return null;
  const dx = followX / len;
  const dy = followY / len;
  // 射线原点换算到世界坐标（viewport.x/y 以画布容器为基准，需先减去容器屏幕偏移）
  const ox = (anchorX - canvasLeft - viewport.x) / viewport.k;
  const oy = (anchorY - canvasTop - viewport.y) / viewport.k;

  let best: { node: NodeRecord; t: number; w: number; h: number } | null = null;

  for (const n of nodes) {
    if (n.id === currentNodeId || n.type === 'group') continue;
    const size = resolveNodeSize(n, getExtension?.(n.id));
    const minX = n.position.x;
    const minY = n.position.y;
    const maxX = minX + size.width;
    const maxY = minY + size.height;

    // slab 法（tmin 下限 0：原点在盒内时命中起点）
    let tmin = 0;
    let tmax = Infinity;
    if (Math.abs(dx) < 1e-9) {
      if (ox < minX || ox > maxX) continue;
    } else {
      let t1 = (minX - ox) / dx;
      let t2 = (maxX - ox) / dx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < minY || oy > maxY) continue;
    } else {
      let t1 = (minY - oy) / dy;
      let t2 = (maxY - oy) / dy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
    }
    if (tmax < tmin) continue;

    if (!best || tmin < best.t) {
      best = { node: n, t: tmin, w: size.width, h: size.height };
    }
  }

  if (!best) return null;
  const { node, t, w, h } = best;
  const k = viewport.k;
  // 命中点（世界 → 屏幕(含容器偏移) → 相对 anchor）
  const hitX = (ox + dx * t) * k + viewport.x + canvasLeft - anchorX;
  const hitY = (oy + dy * t) * k + viewport.y + canvasTop - anchorY;
  // 节点屏幕包围盒（相对 anchor）
  const rectX = node.position.x * k + viewport.x + canvasLeft - anchorX;
  const rectY = node.position.y * k + viewport.y + canvasTop - anchorY;
  const rectW = w * k;
  const rectH = h * k;

  return {
    id: node.id,
    hitX,
    hitY,
    rectX,
    rectY,
    rectW,
    rectH,
  };
}

/** 节点类型 → 显示名称（无标题节点的兕底） */
function getNodeTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case 'image': return t('nodeJoystickNav.typeImage');
    case 'video': return t('nodeJoystickNav.typeVideo');
    case 'text': return t('nodeJoystickNav.typeText');
    case 'stacked-media': return t('nodeJoystickNav.typeStacked');
    case 'generator': return t('nodeJoystickNav.typeGenerator');
    default: return type;
  }
}

/** 红圈是否已越过环内缘（向外）：越过 = 可跳转，拉回环内 = 取消 */
function isPastRingInner(px: number, py: number): boolean {
  return Math.sqrt(px * px + py * py) >= RING_INNER;
}

export function NodeJoystickNav({
  anchorX, anchorY, store, nodeId, getExtension, onClose,
}: NodeJoystickNavProps): React.ReactElement {
  const { theme, mode } = useTheme();
  const { t } = useTranslation();
  const graph = useGraph(store);
  const viewport = useViewport(store);

  // 红圈位置（相对 anchor，跟随指针不钳制）
  const [follow, setFollow] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  const accent = theme.toolbar.accent ?? '#e94560';
  const isDark = mode === 'dark';

  // 画布容器屏幕偏移：viewport.x/y 是画布容器内坐标基准，而本 overlay 用 fixed 屏幕系定位，
  // 世界↔屏幕换算两端必须补上容器偏移，否则目标框/求交点与节点错位（用户实测反馈）
  const [canvasOrigin, setCanvasOrigin] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const rect = document.querySelector('[data-canvas-viewport]')?.getBoundingClientRect();
    if (rect) setCanvasOrigin({ x: rect.left, y: rect.top });
  }, []);

  // 射线求交：首个命中节点（预览虚线 + hover 态的数据源）
  const hit = useMemo(() => castRayToNode(
    anchorX, anchorY, follow.x, follow.y,
    viewport, canvasOrigin.x, canvasOrigin.y, graph.nodes, nodeId, getExtension,
  ), [anchorX, anchorY, follow.x, follow.y, viewport, canvasOrigin.x, canvasOrigin.y, graph.nodes, nodeId, getExtension]);

  // engaged = 射线命中节点且红圈越过环内缘（拉回环内即取消）→ 整链变绿、可跳转
  const engaged = !!hit && isPastRingInner(follow.x, follow.y);
  const chainColor = engaged ? GREEN : accent;
  // 命中节点标题：优先 node.title，无标题时回落类型名称（i18n）
  const hitTitle = useMemo(() => {
    if (!hit) return '';
    const n = graph.nodes.find((nn) => nn.id === hit.id);
    return n ? (n.title || getNodeTypeLabel(n.type, t)) : '';
  }, [hit, graph.nodes, t]);
  // 标题贴在环上沿射线方向（随拖拽角度转动）
  const followLen = Math.sqrt(follow.x * follow.x + follow.y * follow.y);
  const labelR = RING_MID_RADIUS + RING_HALF_BAND + 14;
  const labelX = followLen > 1e-6 ? (follow.x / followLen) * labelR : labelR;
  const labelY = followLen > 1e-6 ? (follow.y / followLen) * labelR : 0;

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    setFollow({ x: clientX - anchorX, y: clientY - anchorY });
  }, [anchorX, anchorY]);

  // ref 存最新值，避免全局监听器闭包陷阱
  const draggingRef = useRef(false);
  const engagedRef = useRef<{ engaged: boolean; id: string | null }>({ engaged: false, id: null });
  const updateRef = useRef(updateFromPointer);
  const onCloseRef = useRef(onClose);
  draggingRef.current = dragging;
  engagedRef.current = { engaged, id: hit?.id ?? null };
  updateRef.current = updateFromPointer;
  onCloseRef.current = onClose;

  // 组件挂载即监听全局 pointer 事件 — 点击导航按钮后鼠标还在按下状态，直接跟随
  useEffect(() => {
    if (closing) return;

    const onMove = (e: PointerEvent) => {
      // 按下即跟随：无论是否按住按钮，红圈始终跟随指针(降低理解门槛)
      if (!draggingRef.current && e.buttons !== 0) setDragging(true);
      updateRef.current(e.clientX, e.clientY);
    };

    const onUp = () => {
      // 按住拖拽松手 = 确认尝试：激活则跳转，否则保持开启继续瞄准(不回弹，跟随不断)
      if (!draggingRef.current) return;
      setDragging(false);
      const { engaged: ok, id } = engagedRef.current;
      if (ok && id) {
        setClosing(true);
        const targetId = id;
        setTimeout(() => {
          nodeActionBus.emit('navigate', { nodeId: targetId });
          onCloseRef.current();
        }, COLLAPSE_MS);
      }
    };

    const onCancel = () => {
      setDragging(false);
      setClosing(true);
      setTimeout(() => onCloseRef.current(), COLLAPSE_MS);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
  }, [closing]);

  // 点击确认：激活态(绿)点击即跳转；未激活点击空白则收起(取消)
  const onMaskPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const { engaged: ok, id } = engagedRef.current;
    setClosing(true);
    if (ok && id) {
      const targetId = id;
      setTimeout(() => {
        nodeActionBus.emit('navigate', { nodeId: targetId });
        onCloseRef.current();
      }, COLLAPSE_MS);
    } else {
      setTimeout(() => onCloseRef.current(), COLLAPSE_MS);
    }
  };

  const animName = closing ? 'ze-nav-collapse' : 'ze-nav-pop';
  const followActive = follow.x !== 0 || follow.y !== 0;

  const maskStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: Z_INDEX.DROPDOWN,
    background: 'transparent',
  };

  return (
    <>
      <style>{`
        @keyframes ze-nav-pop {
          from { opacity: 0; transform: scale(0.85); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes ze-nav-collapse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.5); }
        }
      `}</style>

      {/* 透明遮罩 */}
      <div style={maskStyle} onPointerDown={onMaskPointerDown} />

      {/* 导航 overlay — 以导航按钮为原点，子元素用相对坐标定位 */}
      <div style={{ position: 'fixed', left: anchorX, top: anchorY, width: 0, height: 0, zIndex: Z_INDEX.DROPDOWN + 1, pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            pointerEvents: 'none',
            animation: `${animName} 0.25s cubic-bezier(0.34,1.56,0.64,1)${closing ? ' forwards' : ''}`,
          }}
        >
          {/* 命中节点 hover 态 — overlay 自绘等效阴影（与 node-layer hover 同参数） */}
          {hit && (
            <div
              style={{
                position: 'absolute',
                left: hit.rectX,
                top: hit.rectY,
                width: hit.rectW,
                height: hit.rectH,
                borderRadius: 6,
                boxShadow: engaged
                  ? `0 0 0 2px ${GREEN}, 6px 8px 20px rgba(0,0,0,0.35)`
                  : '6px 8px 20px rgba(0,0,0,0.35)',
                transition: 'box-shadow 0.15s',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
          )}

          {/* 牵引线（中心→红圈）+ 预览虚线（红圈→命中点）+ 土星环 */}
          <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}>
            {/* 土星环 — 以导航原点为圆心的环形判定区（径向渐变环带：内外缘淡出中线最亮 + 虚线中线，常显） */}
            <defs>
              <radialGradient
                id="ze-nav-ring-grad"
                gradientUnits="userSpaceOnUse"
                cx={0} cy={0} r={RING_MID_RADIUS + RING_HALF_BAND}
              >
                <stop offset={(RING_MID_RADIUS - RING_HALF_BAND) / (RING_MID_RADIUS + RING_HALF_BAND)} stopColor={chainColor} stopOpacity={0} />
                <stop offset={RING_MID_RADIUS / (RING_MID_RADIUS + RING_HALF_BAND)} stopColor={chainColor} stopOpacity={engaged ? 0.55 : 0.32} />
                <stop offset={1} stopColor={chainColor} stopOpacity={0} />
              </radialGradient>
            </defs>
            <circle
              cx={0} cy={0} r={RING_MID_RADIUS}
              fill="none" stroke="url(#ze-nav-ring-grad)" strokeWidth={RING_HALF_BAND * 2}
            />
            <circle
              cx={0} cy={0} r={RING_MID_RADIUS}
              fill="none" stroke={chainColor} strokeWidth={1.5}
              strokeDasharray="7 6" opacity={engaged ? 1 : 0.7}
            />
            {/* 牵引线 — 从中心到红圈 */}
            {followActive && (
              <line x1={0} y1={0} x2={follow.x} y2={follow.y} stroke={chainColor} strokeWidth={1.5} strokeDasharray="4 4" opacity={0.6} />
            )}
            {/* 预览虚线 — 从红圈到命中节点边缘 */}
            {hit && (
              <line x1={follow.x} y1={follow.y} x2={hit.hitX} y2={hit.hitY} stroke={chainColor} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.9} />
            )}
          </svg>

          {/* 操作原点 — 取下来的只有指南针图标本体(图标多大就多大 16px，不带填充圆/光晕等附加效果)，
              颜色随链路红绿 */}
          <Compass
            size={16}
            color={chainColor}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(calc(-50% + ${follow.x}px), calc(-50% + ${follow.y}px))`,
              // 跟随不断:位移永不过渡(避免拖尾感),仅颜色变化有过渡
              pointerEvents: 'none',
              zIndex: 2,
              ...(closing ? {
                transition: 'opacity 0.2s ease, transform 0.2s ease',
                opacity: 0,
                transform: 'translate(-50%, -50%) scale(0.3)',
              } : {}),
            }}
          />

          {/* 命中节点名称 — 贴在环上沿射线方向（随拖拽角度转动），颜色随链路红绿 */}
          {hit && hitTitle && (
            <div
              style={{
                position: 'absolute',
                left: labelX,
                top: labelY,
                transform: 'translate(-50%, -50%)',
                padding: '2px 8px',
                borderRadius: 4,
                background: isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.92)',
                color: chainColor,
                fontSize: 11,
                lineHeight: '16px',
                fontWeight: engaged ? 600 : 400,
                whiteSpace: 'nowrap',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              {hitTitle}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
