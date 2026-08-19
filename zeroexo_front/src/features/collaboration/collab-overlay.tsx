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
import type { CSSProperties, ReactElement } from 'react';
import { useGraph, useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeTypeExtension, NodeRecord } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import type { AwarenessState, CollaborationMember } from './collaboration-types.js';
import { useCollaborationStore, fastLocalCursor } from './use-collaboration-store.js';
// 光标渲染延迟埋点(左上角调试面板数据总线)
import { collabDebug } from '@/features/dev-performance/collab-debug.js';

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

/**
 * 昵称翻转滞回阈值(px):光标进入右边缘带(width-CUR_FLIP_IN)后昵称翻到箭头左侧,
 * 离开更宽的带(width-CUR_FLIP_OUT)才回翻 —— 临界带内保持原状态,消除边缘来回抖动"回弹"。
 */
const CUR_FLIP_IN = 170;
const CUR_FLIP_OUT = 260;

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
  const localClientId = useCollaborationStore((s) => s.localAwareness?.clientId ?? -1);
  // 本地光标(自检)开关:默认关闭,仅调试面板可开启;关闭时不渲染、不跑 rAF,零开销
  const showSelfCursor = useCollaborationStore((s) => s.showSelfCursor);
  // 远端光标昵称翻转滞回状态(key=clientId):跨帧记忆当前翻转态,临界带内保持,防来回"回弹"
  const remoteFlipRef = useRef<Map<string, boolean>>(new Map());

  // 本地光标:不订阅 store,用事件驱动调度 + rAF 直改 DOM transform,
  // 避免每帧光标移动触发 React 重渲染导致整体卡顿。
  // 仅在调试开启(showSelfCursor)时挂载;关闭时整段循环不执行。
  const selfCursorRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  useEffect(() => {
    // 每次渲染后同步最新容器尺寸,供光标标签翻转判断使用
    sizeRef.current = { width: size.width, height: size.height };
  });
  useEffect(() => {
    if (!showSelfCursor) return;
    // 首次挂载先隐藏(display 由 rAF 全权控制,不声明在 JSX 里,
    // 避免 React 重渲染时与 DOM 直更互相拉扯产生闪烁/抖动)
    const initEl = selfCursorRef.current;
    if (initEl) initEl.style.display = 'none';

    let raf = 0;
    let ticking = false;
    // 已应用过的最新即时光标时刻/位置(未变化时跳过 DOM 写入)
    let lastFastT = -1;
    let lastKey = '';
    let lastFlip: boolean | null = null;
    const apply = () => {
      ticking = false;
      const el = selfCursorRef.current;
      if (!el) return;
      const s = useCollaborationStore.getState();
      if (!s.active) {
        // 协作关闭:隐藏本地光标并终止调度
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }
      // 事件驱动:仅光标写入/store/视口变化时调度,空闲时零 rAF 消耗
      const fast = fastLocalCursor;
      const useFast = fast.t > lastFastT;
      if (useFast) lastFastT = fast.t;
      const cursor = useFast ? { x: fast.x, y: fast.y } : s.localAwareness?.cursor;
      if (!cursor) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }
      const vp = store.getViewport();
      // 像素取整:避免亚像素平移导致的"莫名的抖动"
      const x = Math.round(cursor.x * vp.k + vp.x);
      const y = Math.round(cursor.y * vp.k + vp.y);
      const key = `${x},${y}`;
      if (key === lastKey) return;
      lastKey = key;
      el.style.display = 'block';
      // translate3d 走合成器,不触发 layout/paint
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      // 昵称翻转:进入右边缘带翻转,离开更宽带才回翻(滞回),临界带内保持上一次状态
      const prevFlip = lastFlip ?? (x > sizeRef.current.width - CUR_FLIP_IN);
      let flip = prevFlip;
      if (x > sizeRef.current.width - CUR_FLIP_IN) flip = true;
      else if (x < sizeRef.current.width - CUR_FLIP_OUT) flip = false;
      if (flip !== lastFlip) {
        lastFlip = flip;
        const labelEl = el.firstElementChild as HTMLElement | null;
        // 翻转时昵称右边缘贴箭头左侧 8px:calc(-100%) 相对自身宽度,任意长短昵称都不与鼠标分离
        if (labelEl) labelEl.style.transform = flip ? 'translateX(calc(-100% - 8px))' : 'translateX(14px)';
      }
      // 调试埋点仅 DEV 构建生效,生产构建整块剔除(连同 collab-debug 模块)
      if (import.meta.env.DEV) collabDebug.recordLocalApply();
    };
    const schedule = () => {
      if (!ticking) {
        ticking = true;
        raf = requestAnimationFrame(apply);
      }
    };
    // 事件驱动调度源:本地光标写入 / store 变更(加入离开/远端事件) / 视口变化
    const unsubFast = fastLocalCursor.subscribe(schedule);
    const unsubStore = useCollaborationStore.subscribe(schedule);
    const unsubViewport = store.subscribeViewport(schedule);
    return () => {
      unsubFast();
      unsubStore();
      unsubViewport();
      cancelAnimationFrame(raf);
    };
  }, [store, showSelfCursor]);

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

  const { x: vx, y: vy, k } = viewport;

  // 世界 → 屏幕
  const toScreen = (wx: number, wy: number) => ({ x: wx * k + vx, y: wy * k + vy });

  // 光标渲染(远端 + 本地 + 测试共用),cursor 为世界坐标
  const renderCaret = (
    key: string,
    cursor: { x: number; y: number },
    color: string,
    name: string,
    zIndex = 30,
  ): ReactElement | null => {
    const p = toScreen(cursor.x, cursor.y);
    if (p.x < -40 || p.y < -40 || p.x > size.width + 40 || p.y > size.height + 40) return null;

    const initial = (name || '?').charAt(0);
    // 昵称翻转:进入右边缘带翻转,离开更宽带才回翻(滞回),临界带内保持上一次状态
    const prevFlip = remoteFlipRef.current.get(key) ?? (p.x > size.width - CUR_FLIP_IN);
    let flip = prevFlip;
    if (p.x > size.width - CUR_FLIP_IN) flip = true;
    else if (p.x < size.width - CUR_FLIP_OUT) flip = false;
    remoteFlipRef.current.set(key, flip);

    const labelStyle: CSSProperties = {
      position: 'absolute',
      // 翻转时昵称右边缘贴箭头左侧 8px:calc(-100%) 相对自身宽度,任意长短昵称都不与鼠标分离
      left: 0,
      top: 14,
      transform: flip ? 'translateX(calc(-100% - 8px))' : 'translateX(14px)',
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
      <div key={key} style={{ position: 'absolute', left: p.x, top: p.y, zIndex }}>
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
  };

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
      {(() => {
        const items: ReactElement[] = [];
        for (const { key, state, color, member } of remoteStates) {
          if (!state.cursor) continue;
          const name = member?.nickname || (state.userId ? `用户 ${String(state.userId).slice(-4)}` : '协作者');
          items.push(renderCaret(key, state.cursor, color, name, 30)!);
        }
        return items;
      })()}

      {/* 本地光标(自检,仅调试面板开启时渲染):
          DOM 直更,不触发 React 重渲染;默认不渲染,rAF 空闲零开销 */}
      {showSelfCursor ? (
        <div ref={selfCursorRef} style={{ position: 'absolute', left: 0, top: 0, zIndex: 40, willChange: 'transform' }}>
          <div style={{ position: 'absolute', left: 0, top: 14, display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 160, padding: '2px 8px 2px 3px', borderRadius: 9999, background: '#00E676', color: '#ffffff', fontSize: 11, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', userSelect: 'none', willChange: 'transform' }}>
            <span style={{ width: 15, height: 15, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0, background: 'rgba(255,255,255,0.28)', color: '#ffffff' }}>我</span>
            <span>我</span>
          </div>
          <svg width={18} height={18} viewBox="0 0 24 24" style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-2px, -2px)', display: 'block' }}>
            <path d="M4 2 L20 11 L12.5 12.7 L9 20 Z" fill="#00E676" stroke="rgba(255,255,255,0.85)" strokeWidth={1.3} strokeLinejoin="round" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
