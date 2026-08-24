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
  userId: string;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** 连续重连尝试次数(指数退避用,连接成功后重置为 0) */
  reconnectAttempt: number;
}

/** 已建立的连接（按 canvasId 索引，避免重复连接） */
const activeConnections = new Map<string, ActiveConnection>();

/** 断线重连基础延迟(指数退避起点) */
const BASE_RECONNECT_DELAY_MS = 3000;
/** 断线重连最大延迟(封顶,避免服务器不可用时持续高频请求) */
const MAX_RECONNECT_DELAY_MS = 60000;

/** 指数退避:3s → 6s → 12s → 24s → 48s → 60s(封顶) */
function getReconnectDelay(attempt: number): number {
  return Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

/**
 * 建立画布协作房间的实时事件连接
 * @param userId 当前用户 ID（用于检测自己被踢出）
 * @returns 连接句柄（close 方法）
 */
export function connectCollaborationEvents(canvasId: string, userId?: string): CollaborationSocketHandle {
  const existing = activeConnections.get(canvasId);
  if (existing) {
    return { close: () => closeConnection(canvasId) };
  }

  const conn: ActiveConnection = {
    ac: new AbortController(),
    canvasId,
    userId: userId ?? '',
    reconnectTimer: null,
    reconnectAttempt: 0,
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
      // 401/403/404 表示房间不存在或用户无权限 → 直接停止连接，不重连
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        const store = useCollaborationStore;
        store.getState().setError('collaboration room not available');
        store.getState().setActive(false);
        activeConnections.delete(canvasId);
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    // 连接建立（含重连成功后）→ 重置退避计数,刷新房间信息与成员列表
    conn.reconnectAttempt = 0;
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

/** 延迟重连(指数退避:连续失败逐次放大延迟,封顶 60s) */
function scheduleReconnect(conn: ActiveConnection): void {
  const delay = getReconnectDelay(conn.reconnectAttempt);
  conn.reconnectAttempt += 1;
  conn.reconnectTimer = setTimeout(() => {
    if (!activeConnections.has(conn.canvasId)) return;
    void openStream(conn);
  }, delay);
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
      void refreshMembers(canvasId);
      break;
    case 'join_application':
      // Phase 8：新的待审加入申请 → 通知房主端刷新待审列表并提示（弹窗打开时自行拉取）
      window.dispatchEvent(new CustomEvent('zeroexo:collab-join-application', { detail: { canvasId, userId: event.userId } }));
      break;
    case 'member_left':
      // 检测是否自己被踢出
      if (event.meta?.kicked === true && event.userId) {
        const conn = activeConnections.get(canvasId);
        if (conn && conn.userId === event.userId) {
          // 自己被踢出 → 断开 SSE 连接，停止重连，通知用户
          closeConnection(canvasId);
          store.getState().setActive(false);
          store.getState().setError('你已被移出协作房间');
          return;
        }
      }
      // 非自己 → 刷新成员列表
      void refreshMembers(canvasId);
      break;
    case 'room_updated':
      // 房间设置变更 → 重新拉取房间信息
      void refreshRoom(canvasId);
      break;
    case 'room_closed':
      // 房间已关闭(软删除) → 断开当前用户的 SSE 连接，停止所有同步
      // 房主关闭 → 回到"未开启"；参与者 → 标记"协作已失效"并派发事件让编辑器弹出提示后返回主页
      closeConnection(canvasId);
      {
        const ownerId = store.getState().room?.ownerId;
        store.getState().setRoom(null);
        store.getState().setAgentStatus(null);
        if (ownerId === store.getState().userId) {
          store.getState().setStatus('idle');
        } else {
          store.getState().setStatus('expired');
          window.dispatchEvent(new CustomEvent('zeroexo:collab-room-expired', { detail: { canvasId } }));
        }
        store.getState().setActive(false);
      }
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
