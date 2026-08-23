/**
 * agent-cursor.ts - Agent 画布操作光标状态（R3-D1）
 *
 * Agent 每次操作画布（建节点/聚焦/选中/工作链展开）后，经 executeCanvasOp
 * 脉冲一次光标（位置 + 目标包围盒 + 操作语义），由 AgentCursorOverlay 渲染：
 * 1. 聚焦高亮框（对齐远程协作选中样式：2px 彩色边框 + glow）
 * 2. Agent 光标（箭头 + 胶囊，对齐远端光标视觉语言）
 *
 * 低频（操作级）事件，React 订阅渲染即可，无需 DOM 直更/rAF
 * （区别于高频远端光标，见经验 collab-cursor-perf）。
 */

/** Agent 光标状态（屏幕坐标空间，渲染层直接用） */
export interface AgentCursorState {
  /** 箭头锚点屏幕坐标 */
  x: number;
  y: number;
  /** 目标节点包围盒（世界坐标，聚焦高亮框用；null = 无高亮） */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** 操作语义文案（如「已创建节点」） */
  label: string;
  /** 出现时间戳（覆盖层据此淡出） */
  ts: number;
}

let cursor: AgentCursorState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function showAgentCursor(next: AgentCursorState): void {
  cursor = next;
  emit();
}

export function hideAgentCursor(): void {
  if (!cursor) return;
  cursor = null;
  emit();
}

export function getAgentCursor(): AgentCursorState | null {
  return cursor;
}

export function subscribeAgentCursor(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
