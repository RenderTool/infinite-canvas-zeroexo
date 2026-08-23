/**
 * AgentCursorOverlay - Agent 画布操作光标覆盖层（R3-D1）
 *
 * 渲染在 CanvasView children 中（屏幕坐标空间，pointer-events: none），
 * 对齐 CollabOverlay 视觉语言：
 * 1. 聚焦高亮框：目标节点包围盒 2px 彩色边框 + glow（对齐远程选中节点样式）
 * 2. Agent 光标：箭头 + 「Agent」胶囊（对齐远端光标箭头+昵称胶囊）
 *
 * 出现 3.5s 后自动淡出（操作级低频事件，React 订阅即可）；
 * 视口动画（focusOnNode）期间经 useViewport 驱动重算，光标跟随节点。
 */

import { useEffect, useRef, useState } from 'react';
import { useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { getAgentCursor, hideAgentCursor, subscribeAgentCursor, type AgentCursorState } from './agent-cursor.js';

/** Agent 主题色（对齐 --agent-accent 视觉） */
const AGENT_COLOR = '#a78bfa';
/** 光标展示时长（ms） */
const CURSOR_LIFETIME = 3500;

export function AgentCursorOverlay({ store }: { store: ReactGraphStore }): React.ReactElement | null {
  const viewport = useViewport(store);
  const [cursor, setCursor] = useState<AgentCursorState | null>(() => getAgentCursor());

  useEffect(() => subscribeAgentCursor(() => setCursor(getAgentCursor())), []);

  // 自动淡出（新光标脉冲重置计时）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!cursor) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      hideAgentCursor();
    }, CURSOR_LIFETIME);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cursor]);

  if (!cursor) return null;

  // 世界坐标 → 屏幕坐标（对齐 CollabOverlay：world * k + viewport.x/y）
  const k = viewport.k;
  const vx = viewport.x;
  const vy = viewport.y;
  const b = cursor.bounds;

  return (
    <>
      {/* 聚焦高亮框（对齐远程选中节点样式） */}
      {b && (
        <div
          style={{
            position: 'absolute',
            left: Math.round(b.x * k + vx) - 2,
            top: Math.round(b.y * k + vy) - 2,
            width: b.width * k + 4,
            height: b.height * k + 4,
            borderRadius: 4,
            border: `2px solid ${AGENT_COLOR}`,
            boxShadow: `0 0 0 1px rgba(255,255,255,0.25), 0 0 10px ${AGENT_COLOR}55`,
            opacity: 0.9,
            pointerEvents: 'none',
            transition: 'opacity 0.4s ease',
          }}
        />
      )}

      {/* Agent 光标：箭头 + 胶囊（对齐远端光标视觉） */}
      <div style={{ position: 'absolute', left: cursor.x, top: cursor.y, zIndex: 40, pointerEvents: 'none', willChange: 'transform' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            maxWidth: 200,
            padding: '2px 8px 2px 3px',
            borderRadius: 9999,
            background: AGENT_COLOR,
            color: '#ffffff',
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            userSelect: 'none',
            willChange: 'transform',
          }}
        >
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
            AI
          </span>
          <span>Agent{cursor.label ? ` · ${cursor.label}` : ''}</span>
        </div>
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-2px, -2px)', display: 'block' }}
        >
          <path d="M4 2 L20 11 L12.5 12.7 L9 20 Z" fill={AGENT_COLOR} stroke="rgba(255,255,255,0.85)" strokeWidth={1.3} strokeLinejoin="round" />
        </svg>
      </div>
    </>
  );
}
