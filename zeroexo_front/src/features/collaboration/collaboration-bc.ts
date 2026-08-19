/**
 * collaboration-bc - 同浏览器同源标签页的光标直连频道
 *
 * 用途：
 * - 同源标签页(同一浏览器的多个 Tab 打开同一画布)的光标/视口/选中态
 *   经 BroadcastChannel 直达,不依赖 WebSocket 服务器(零网络延迟、可离线)。
 * - 跨浏览器/跨机器仍走 HocuspocusProvider(WS) 路径,两者并行、按 clientId 去重。
 *
 * 通道名: zeroexo:cursor:{canvasId} —— 每个画布独立频道。
 * BroadcastChannel 不会把消息回传给发送方 Tab,天然无自echo。
 */
import type { DeviceType } from './collaboration-types.js';

export const CURSOR_BC_TYPE = 'cursor';

/** BC 光标消息(与 Awareness 'cursor-data' 字段对应,附带发送端 clientId) */
export interface CursorBcMessage {
  type: typeof CURSOR_BC_TYPE;
  canvasId: string;
  clientId: number;
  userId: string;
  sessionIndex: number;
  deviceType: DeviceType;
  cursor: { x: number; y: number } | null;
  viewport?: { x: number; y: number; width: number; height: number; scale: number };
  selectedNodeIds?: string[];
  lastUpdated: number;
}

/** 同 Tab 内按 canvasId 共享的频道(避免多实例重复创建;不同 Tab 是独立 JS 上下文,互不影响) */
const channels = new Map<string, BroadcastChannel>();

function channelFor(canvasId: string): BroadcastChannel {
  let ch = channels.get(canvasId);
  if (!ch) {
    ch = new BroadcastChannel(`zeroexo:cursor:${canvasId}`);
    channels.set(canvasId, ch);
  }
  return ch;
}

/** 发布本地光标到同源标签页(不等待连线,BroadcastChannel 瞬时直达) */
export function publishCursorBc(canvasId: string, msg: CursorBcMessage): void {
  try {
    channelFor(canvasId).postMessage(msg);
  } catch {
    // BroadcastChannel 不可用时静默降级(WS 路径仍可用)
  }
}

/** 订阅同源标签页的光标消息,返回退订函数 */
export function subscribeCursorBc(
  canvasId: string,
  onMessage: (msg: CursorBcMessage) => void,
): () => void {
  const ch = channelFor(canvasId);
  const handler = (ev: MessageEvent): void => {
    const msg = ev.data as CursorBcMessage | undefined;
    if (!msg || msg.type !== CURSOR_BC_TYPE || msg.canvasId !== canvasId) return;
    onMessage(msg);
  };
  ch.addEventListener('message', handler);
  return () => {
    ch.removeEventListener('message', handler);
  };
}