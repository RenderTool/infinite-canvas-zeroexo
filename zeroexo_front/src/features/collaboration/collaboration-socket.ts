/**
 * collaboration-socket - 协作实时事件 SSE 客户端
 *
 * 使用 fetch + ReadableStream 连接后端 SSE 端点，
 * 将实时事件分发到 useCollaborationStore：
 * - member_joined / member_left → 重新拉取成员列表
 * - room_updated / room_closed  → 更新房间状态
 * - message                      → 追加聊天消息
 * - message_deleted              → 移除聊天消息
 * - member_updated               → 重新拉取成员列表
 *
 * 安全: JWT 经 Authorization header 传递(URL 不拼接 token,
 * 避免 token 进入日志/浏览器历史/Referer)。
 */

import { getApiBaseUrl, getToken } from '@/services/api-client.js';
import { useCollaborationStore } from './use-collaboration-store.js';
import { listMembers, getRoomByCanvas, listMessages } from './collaboration-api.js';
import type { CollaborationEvent, CollaborationMessage } from './collaboration-types.js';

export interface CollaborationSocketHandle {
  /** 关闭 SSE 连接 */
  close: () => void;
}

interface ActiveConnection {
  ac: AbortController;
  canvasId: string;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

/** 已建立的连接（按 canvasId 索引，避免重复连接） */
const activeConnections = new Map<string, ActiveConnection>();

/** 断线重连延迟 */
const RECONNECT_DELAY_MS = 3000;

/**
 * 建立画布协作房间的实时事件连接
 * @returns 连接句柄（close 方法）
 */
export function connectCollaborationEvents(canvasId: string): CollaborationSocketHandle {
  const existing = activeConnections.get(canvasId);
  if (existing) {
    return { close: () => closeConnection(canvasId) };
  }

  const conn: ActiveConnection = {
    ac: new AbortController(),
    canvasId,
    reconnectTimer: null,
  };
  activeConnections.set(canvasId, conn);
  void openStream(conn);

  return { close: () => closeConnection(canvasId) };
}

/** 建立并读取 SSE 流(失败时自动重连,直到主动关闭) */
async function openStream(conn: ActiveConnection): Promise<void> {
  const { ac, canvasId } = conn;
  const token = getToken();
  const base = getApiBaseUrl();
  // 去掉 base 末尾的斜杠
  const normalizedBase = base.replace(/\/+$/, '');
  const url = `${normalizedBase}/collaboration/rooms/${encodeURIComponent(canvasId)}/events`;

  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: ac.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // 连接建立（含重连成功后）→ 刷新房间信息与成员列表
    void refreshRoomState(canvasId);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取流式响应');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 格式: 每个事件由 "\n\n" 分隔，data: 行包含 JSON
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const chunk of chunks) {
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          handleServerEvent(canvasId, trimmed.slice(5).trim());
        }
      }
    }
  } catch {
    // 主动关闭时不重连
    if (ac.signal.aborted) {
      activeConnections.delete(canvasId);
      return;
    }
    scheduleReconnect(conn);
    return;
  }

  // 流正常结束(服务端关闭) → 自动重连
  if (ac.signal.aborted) {
    activeConnections.delete(canvasId);
  } else {
    scheduleReconnect(conn);
  }
}

/** 延迟重连 */
function scheduleReconnect(conn: ActiveConnection): void {
  conn.reconnectTimer = setTimeout(() => {
    if (!activeConnections.has(conn.canvasId)) return;
    void openStream(conn);
  }, RECONNECT_DELAY_MS);
}

/** 关闭指定画布的事件连接 */
function closeConnection(canvasId: string): void {
  const conn = activeConnections.get(canvasId);
  if (conn) {
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.ac.abort();
    activeConnections.delete(canvasId);
  }
}

/** 关闭所有事件连接（登出/清理时调用） */
export function closeAllCollaborationConnections(): void {
  for (const conn of activeConnections.values()) {
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    conn.ac.abort();
  }
  activeConnections.clear();
}

/** 处理服务端下发的事件 */
function handleServerEvent(canvasId: string, dataLine: string): void {
  let event: CollaborationEvent;
  try {
    event = JSON.parse(dataLine) as CollaborationEvent;
  } catch {
    return;
  }

  const store = useCollaborationStore;

  switch (event.type) {
    case 'welcome':
      // 连接确认，无需额外处理
      break;
    case 'message': {
      const message = event.meta?.message as CollaborationMessage | undefined;
      if (message?.id) {
        store.getState().addMessage(message);
      }
      break;
    }
    case 'message_deleted': {
      const messageId = event.meta?.messageId as string | undefined;
      if (messageId) {
        store.getState().removeMessage(messageId);
      }
      break;
    }
    case 'member_joined':
    case 'member_left':
    case 'member_updated':
      // 成员列表变化 → 重新拉取
      void refreshMembers(canvasId);
      break;
    case 'room_updated':
      // 房间设置变更 → 重新拉取房间信息
      void refreshRoom(canvasId);
      break;
    case 'room_closed':
      store.getState().setRoom(null);
      store.getState().setActive(false);
      store.getState().setAgentStatus(null);
      void refreshMembers(canvasId);
      break;
    case 'agent_thinking': {
      // Agent 开始思考
      store.getState().setAgentStatus({
        thinking: true,
        senderName: (event.meta?.senderName as string | undefined) ?? 'AI 助手',
      });
      break;
    }
    case 'agent_tool_call': {
      // Agent 正在调用工具
      store.getState().setAgentStatus({
        thinking: true,
        toolName: (event.meta?.toolName as string | undefined) ?? undefined,
        senderName: store.getState().agentStatus?.senderName,
      });
      break;
    }
    case 'agent_result': {
      // Agent 执行结束（清空状态；若携带消息则一并追加）
      store.getState().setAgentStatus(null);
      const message = event.meta?.message as CollaborationMessage | undefined;
      if (message?.id) {
        store.getState().addMessage(message);
      }
      break;
    }
    default:
      break;
  }
}

/** 重新拉取房间信息 */
async function refreshRoom(canvasId: string): Promise<void> {
  try {
    const room = await getRoomByCanvas(canvasId);
    if (room) {
      useCollaborationStore.getState().setRoom(room);
    }
  } catch {
    // 房间可能已关闭，忽略
  }
}

/** 重新拉取成员列表 */
async function refreshMembers(canvasId: string): Promise<void> {
  try {
    const members = await listMembers(canvasId);
    useCollaborationStore.getState().setMembers(members);
  } catch {
    // 忽略拉取失败
  }
}

/** 重新拉取房间 + 成员列表（连接建立时） */
async function refreshRoomState(canvasId: string): Promise<void> {
  await Promise.all([refreshRoom(canvasId), refreshMembers(canvasId), refreshMessages(canvasId)]);
}

/** 重新拉取消息历史 */
async function refreshMessages(canvasId: string): Promise<void> {
  try {
    const messages = await listMessages(canvasId, 50);
    useCollaborationStore.getState().setMessages(messages);
  } catch {
    // 忽略拉取失败
  }
}
