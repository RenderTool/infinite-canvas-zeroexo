/**
 * collaboration-api - 协作系统 HTTP API 客户端
 *
 * 所有协作相关的后端 API 调用封装：
 * - 房间 CRUD
 * - 邀请码管理
 * - 加入/离开
 * - 成员管理
 * - 聊天消息
 */
import { apiGet, apiPost, apiPatch, apiDelete } from '@/services/api-client.js';
import type {
  CreateRoomRequest,
  UpdateRoomRequest,
  AutoJoinRequest,
  RoomResponse,
  CollaborationMember,
  CollaborationMessage,
  UpdateMemberRequest,
  SendMessageRequest,
  MyRoomItem,
  MyCanvasItem,
  ParticipatingCanvasItem,
  DeviceType,
  AgentSession,
  AgentSessionMessage,
  AgentExecuteRequest,
  AgentExecuteResponse,
} from './collaboration-types.js';

function deviceTypeFromUA(): DeviceType {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
    if (/iPad|tablet|PlayBook/i.test(ua)) return 'tablet';
    return 'mobile';
  }
  return 'desktop';
}

/** 协作 API 路径前缀 */
const COLLAB = '/collaboration';

// ==================== 房间管理 ====================

export function createRoom(dto: CreateRoomRequest): Promise<RoomResponse> {
  return apiPost(`${COLLAB}/rooms`, dto);
}

export function getRoomByCanvas(canvasId: string): Promise<RoomResponse> {
  return apiGet(`${COLLAB}/rooms/${canvasId}`);
}

export function updateRoom(canvasId: string, dto: UpdateRoomRequest): Promise<RoomResponse> {
  return apiPatch(`${COLLAB}/rooms/${canvasId}`, dto);
}

export function closeRoom(canvasId: string): Promise<{ message: string }> {
  return apiDelete(`${COLLAB}/rooms/${canvasId}`);
}

export function listMyRooms(): Promise<MyRoomItem[]> {
  return apiGet(`${COLLAB}/rooms/mine`);
}

/** 我拥有的画布 + 各画布协作状态（主页"发起协作"模式/协作 Tag） */
export function listMyCanvases(): Promise<MyCanvasItem[]> {
  return apiGet(`${COLLAB}/rooms/my-canvases`);
}

/** 我参与的协作画布列表（含已失效） */
export function listParticipating(): Promise<ParticipatingCanvasItem[]> {
  return apiGet(`${COLLAB}/rooms/participating`);
}

// ==================== 邀请码 ====================

export function regenerateInvite(canvasId: string, expiresInHours?: number): Promise<{
  inviteCode: string;
  inviteLink: string;
  expiresAt: string | null;
}> {
  const params = expiresInHours !== undefined ? `?expiresInHours=${expiresInHours}` : '';
  return apiPost(`${COLLAB}/rooms/${canvasId}/invite${params}`);
}

export function verifyInvite(inviteCode: string): Promise<{
  id: string;
  canvasId: string;
  mode: string;
  status: string;
  ownerId: string;
}> {
  return apiGet(`${COLLAB}/invite/${inviteCode}`);
}

// ==================== 加入/离开 ====================

export function joinRoom(canvasId: string, inviteCode: string, nickname?: string, deviceType?: DeviceType): Promise<RoomResponse> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/join`, {
    inviteCode,
    nickname,
    deviceType: deviceType ?? deviceTypeFromUA(),
  });
}

/**
 * 同账户多设备自动加入（auto-self 模式）
 * 打开画布时调用，若房间不存在则自动创建
 */
export function autoJoinRoom(canvasId: string, deviceType?: DeviceType): Promise<RoomResponse> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/auto-join`, {
    deviceType: deviceType ?? deviceTypeFromUA(),
  } satisfies AutoJoinRequest);
}

export function leaveRoom(canvasId: string): Promise<{ message: string; affected: number }> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/leave`, {});
}

/** 参与者主动移除自己的成员身份（退出协作 / 失效画布移除） */
export function removeSelfFromRoom(canvasId: string): Promise<{ message: string; removed: number }> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/remove-self`, {});
}

// ==================== 成员管理 ====================

export function listMembers(canvasId: string): Promise<CollaborationMember[]> {
  return apiGet(`${COLLAB}/rooms/${canvasId}/members`);
}

export function updateMember(canvasId: string, userId: string, dto: UpdateMemberRequest): Promise<{ message: string }> {
  return apiPatch(`${COLLAB}/rooms/${canvasId}/members/${userId}`, dto);
}

export function kickMember(canvasId: string, userId: string): Promise<{ message: string }> {
  return apiDelete(`${COLLAB}/rooms/${canvasId}/members/${userId}`);
}

export function banMember(canvasId: string, userId: string): Promise<{ message: string }> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/members/${userId}/ban`, {});
}

export function unbanMember(canvasId: string, userId: string): Promise<{ message: string }> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/members/${userId}/unban`, {});
}

export function muteMember(canvasId: string, userId: string): Promise<{ message: string }> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/members/${userId}/mute`, {});
}

export function unmuteMember(canvasId: string, userId: string): Promise<{ message: string }> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/members/${userId}/unmute`, {});
}

// ==================== 聊天消息 ====================

export function listMessages(canvasId: string, limit: number = 50, beforeId?: string): Promise<CollaborationMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (beforeId) params.set('beforeId', beforeId);
  return apiGet(`${COLLAB}/rooms/${canvasId}/messages?${params.toString()}`);
}

export function sendMessage(canvasId: string, dto: SendMessageRequest): Promise<CollaborationMessage> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/messages`, dto);
}

export function deleteMessage(canvasId: string, messageId: string): Promise<{ message: string }> {
  return apiDelete(`${COLLAB}/rooms/${canvasId}/messages/${messageId}`);
}

// ==================== Agent 协作(共享记忆群聊) ====================

/** 获取 Agent 会话与共享记忆 */
export function getAgentSession(canvasId: string): Promise<AgentSession> {
  return apiGet(`${COLLAB}/rooms/${canvasId}/agent/session`);
}

/** 获取 Agent 会话消息历史 */
export function listAgentMessages(canvasId: string, limit: number = 50): Promise<AgentSessionMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return apiGet(`${COLLAB}/rooms/${canvasId}/agent/messages?${params.toString()}`);
}

/**
 * @deprecated 协作聊天 @AI 派发路径已废弃（Plan#8 T6），Agent 交互迁移至 AgentDock。
 * 保留仅作历史引用。
 */
// 执行 Agent（协作模式，结果写入协作消息并广播给所有成员）
export function executeAgent(canvasId: string, dto: AgentExecuteRequest): Promise<AgentExecuteResponse> {
  return apiPost(`${COLLAB}/rooms/${canvasId}/agent/execute`, dto);
}

/** 更新共享记忆 */
export function updateAgentMemory(canvasId: string, memory: Record<string, unknown>): Promise<{ message: string }> {
  return apiPatch(`${COLLAB}/rooms/${canvasId}/agent/session/memory`, { memory });
}

export { deviceTypeFromUA };
