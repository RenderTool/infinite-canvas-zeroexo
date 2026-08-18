/**
 * CollabOverlay - 画布远端协作覆盖层
 *
 * 渲染在 CanvasView 的 children 中(屏幕坐标空间,pointer-events: none):
 * 1. 远端用户光标: SVG 箭头 + 名字标签(头像首字符 + 昵称)
 * 2. 远端用户选中节点高亮(跟随远端 selection 同步)
 *
 * 坐标转换: 世界坐标 → 屏幕坐标 = world * viewport.k + viewport.x/y
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGraph, useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeTypeExtension, NodeRecord } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import type { AwarenessState, CollaborationMember } from './collaboration-types.js';
import { useCollaborationStore } from './use-collaboration-store.js';

/** 远端光标/选中高亮颜色面板(按 userId 哈希取色,稳定且辨识度高) */
const CURSOR_COLORS = [
  '#e94560',
  '#4f8cff',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
];

/** 根据 userId 稳定取色 */
function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length]! ?? CURSOR_COLORS[0];
}

/** 节点默认尺寸回退(与编辑器 getNodeSize 一致) */
const FALLBACK_SIZE = { width: 200, height: 80 };

export interface CollabOverlayProps {
  store: ReactGraphStore;
  theme: ThemeConfig;
  /** 节点类型扩展(选中高亮时计算默认尺寸) */
  extensions: Map<string, NodeTypeExtension>;
}

export function CollabOverlay({ store, theme: _theme, extensions }: CollabOverlayProps): React.ReactElement | null {
  const viewport = useViewport(store);
  const graph = useGraph(store);

  const awarenessStates = useCollaborationStore((s) => s.awarenessStates);
  const members = useCollaborationStore((s) => s.members);
  const active = useCollaborationStore((s) => s.active);
  const localClientId = useCollaborationStore((s) => s.localAwareness?.clientId ?? -1);

  // 容器尺寸(用于标签翻转/裁剪)
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 成员映射(userId → member),用于取昵称/头像
  const memberMap = useMemo(() => {
    const map = new Map<string, CollaborationMember>();
    for (const m of members) map.set(m.userId, m);
    return map;
  }, [members]);

  // 节点查找映射(id → node)
  const nodeMap = useMemo(() => {
    const map = new Map<string, NodeRecord>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  const remoteStates = useMemo(() => {
    const result: {
      key: string;
      state: AwarenessState;
      color: string;
      member: CollaborationMember | undefined;
    }[] = [];
    for (const [clientId, state] of awarenessStates) {
      if (clientId === localClientId) continue;
      if (!state.cursor) continue;
      result.push({
        key: String(clientId),
        state,
        color: colorForUser(state.userId),
        member: memberMap.get(state.userId),
      });
    }
    return result;
  }, [awarenessStates, localClientId, memberMap]);

  const remoteSelections = useMemo(() => {
    const result: {
      key: string;
      color: string;
      member: CollaborationMember | undefined;
      bounds: { x: number; y: number; width: number; height: number };
    }[] = [];
    for (const [clientId, state] of awarenessStates) {
      if (clientId === localClientId) continue;
      if (!state.selectedNodeIds || state.selectedNodeIds.length === 0) continue;
      const color = colorForUser(state.userId);
      const member = memberMap.get(state.userId);
      for (const nodeId of state.selectedNodeIds) {
        const node = nodeMap.get(nodeId);
        if (!node || node.hidden) continue;
        const size2 = node.size ?? extensions.get(node.type)?.defaultSize ?? FALLBACK_SIZE;
        result.push({
          key: `${clientId}-${nodeId}`,
          color,
          member,
          bounds: {
            x: node.position.x,
            y: node.position.y,
            width: size2.width,
            height: size2.height,
          },
        });
      }
    }
    return result;
  }, [awarenessStates, localClientId, memberMap, nodeMap, extensions]);

  if (!active) return null;

  const { x: vx, y: vy, k } = viewport;

  // 世界 → 屏幕
  const toScreen = (wx: number, wy: number) => ({ x: wx * k + vx, y: wy * k + vy });

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {/* 远端选中节点高亮 */}
      {remoteSelections.map((sel) => {
        const p = toScreen(sel.bounds.x, sel.bounds.y);
        const w = sel.bounds.width * k;
        const h = sel.bounds.height * k;
        return (
          <div
            key={sel.key}
            style={{
              position: 'absolute',
              left: p.x - 2,
              top: p.y - 2,
              width: w + 4,
              height: h + 4,
              borderRadius: 4,
              border: `2px solid ${sel.color}`,
              boxShadow: `0 0 0 1px rgba(255,255,255,0.25), 0 0 10px ${sel.color}55`,
              opacity: 0.9,
            }}
          />
        );
      })}

      {/* 远端光标 */}
      {remoteStates.map(({ key, state, color, member }) => {
        const c = state.cursor;
        if (!c) return null;
        const p = toScreen(c.x, c.y);
        if (p.x < -40 || p.y < -40 || p.x > size.width + 40 || p.y > size.height + 40) return null;

        const name = member?.nickname || (state.userId ? `用户 ${String(state.userId).slice(-4)}` : '协作者');
        const initial = (name || '?').charAt(0);
        const flip = p.x > size.width - 170;

        const labelStyle: CSSProperties = {
          position: 'absolute',
          left: flip ? -166 : 14,
          top: 14,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          maxWidth: 160,
          padding: '2px 8px 2px 3px',
          borderRadius: 9999,
          background: color,
          color: '#ffffff',
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          userSelect: 'none',
        };

        return (
          <div key={key} style={{ position: 'absolute', left: p.x, top: p.y, zIndex: 30 }}>
            {/* 光标箭头 */}
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-2px, -2px)', display: 'block' }}
            >
              <path
                d="M4 2 L20 11 L12.5 12.7 L9 20 Z"
                fill={color}
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={1.3}
                strokeLinejoin="round"
              />
            </svg>
            {/* 名字标签 */}
            <div style={labelStyle}>
              <span
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 700,
                  flexShrink: 0,
                  background: 'rgba(255,255,255,0.28)',
                  color: '#ffffff',
                }}
              >
                {initial}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
