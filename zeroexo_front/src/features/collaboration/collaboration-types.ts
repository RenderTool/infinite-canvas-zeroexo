/**
 * 协作系统类型定义
 */

/** 协作房间模式 */
export type CollaborationMode = 'invite-only' | 'public' | 'auto-self';

/** 房间状态 */
export type RoomStatus = 'active' | 'closed' | 'expired';

/** 画布协作状态（对外语义：未开启/协作中/已失效/待审中——2026-08-25 审核制：画布页内重进被转 pending） */
export type CollaborationStatus = 'idle' | 'active' | 'expired' | 'pending';

/** 成员角色 */
export type MemberRole = 'owner' | 'editor' | 'viewer';

/** 成员状态 */
export type MemberStatus = 'online' | 'offline' | 'banned' | 'muted' | 'left';

/** 设备类型 */
export type DeviceType = 'desktop' | 'tablet' | 'mobile';

/** 权限标记 */
export type Permission = 'view' | 'chat' | 'edit' | 'agent' | 'download';

/** 协作房间 */
export interface CollaborationRoom {
  id: string;
  canvasId: string;
  ownerId: string;
  inviteCode: string;
  inviteLink: string;
  mode: CollaborationMode;
  status: RoomStatus;
  expiresAt: string | null;
  allowChat: boolean;
  allowAgentChat: boolean;
  allowEdit: boolean;
  allowDownload: boolean;
  /** 加入方式（Plan#38 Phase 8）：true=需要房主审核 | false=凭码直接加入 */
  requiresApproval?: boolean;
  isOwner: boolean;
  memberCount: number;
}

/** 协作成员（按用户聚合，含多设备 session） */
export interface CollaborationMember {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: MemberRole;
  permissions: Permission[];
  sessions: MemberSession[];
  isSelf: boolean;
}

/** 成员的单个设备会话 */
export interface MemberSession {
  sessionIndex: number;
  deviceType: DeviceType;
  status: MemberStatus;
  lastActiveAt: string;
}

/** 聊天消息 */
export interface CollaborationMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderRole: MemberRole;
  type: 'text' | 'system' | 'agent' | 'agent_action';
  content: string;
  mentions: string[];
  agentMentioned: boolean;
  replyToId: string | null;
  createdAt: string;
}

/** 协作实时事件类型（对应后端 CollaborationEventType） */
export type CollaborationEventType =
  | 'member_joined'
  | 'member_left'
  | 'join_application'
  | 'membership_pending' // 2026-08-25：申请人自己被转为待审（画布页内重进被 SSE 拦截）
  | 'room_updated'
  | 'member_updated'
  | 'message'
  | 'message_deleted'
  | 'room_closed'
  | 'agent_thinking'
  | 'agent_tool_call'
  | 'agent_result'
  | 'welcome';

/** 协作实时事件（SSE 推送） */
export interface CollaborationEvent {
  type: CollaborationEventType;
  canvasId: string;
  userId?: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

/** 远端用户光标/选区信息（Awareness） */
export interface AwarenessState {
  /** 客户端唯一 ID */
  clientId: number;
  /** 用户 ID */
  userId: string;
  /** 会话索引（同账户多设备区分） */
  sessionIndex: number;
  /** 设备类型 */
  deviceType: DeviceType;
  /** 光标位置（画布坐标） */
  cursor: { x: number; y: number } | null;
  /** 视口信息 */
  viewport?: { x: number; y: number; width: number; height: number; scale: number };
  /** 选中节点 ID 列表 */
  selectedNodeIds: string[];
  /** 在线状态 */
  online: boolean;
  /** 发送端最后更新时间（双通道去重用） */
  lastUpdated: number;
  /** 接收端本地时间（超时判定用；两端时钟差 >30s 时发送端时间戳会误判离线） */
  receivedAt: number;
}

/** 加入房间请求 */
export interface JoinRoomRequest {
  inviteCode: string;
  nickname?: string;
  deviceType?: DeviceType;
}

/** 自动加入请求 */
export interface AutoJoinRequest {
  deviceType?: DeviceType;
}

/** 创建房间请求 */
export interface CreateRoomRequest {
  canvasId: string;
  mode?: CollaborationMode;
  maxMembers?: number;
  allowChat?: boolean;
  allowAgentChat?: boolean;
  allowEdit?: boolean;
  allowDownload?: boolean;
  requiresApproval?: boolean;
  expiresInHours?: number;
}

/** 更新房间请求 */
export interface UpdateRoomRequest {
  mode?: CollaborationMode;
  maxMembers?: number;
  allowChat?: boolean;
  allowAgentChat?: boolean;
  allowEdit?: boolean;
  allowDownload?: boolean;
  requiresApproval?: boolean;
  expiresInHours?: number;
}

/** 待审加入申请（房主视角，Plan#38 Phase 8） */
export interface JoinApplication {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  appliedAt: string;
}

/** join 接口结果：直接入房返回房间信息；需审核时返回待审标记 */
export type JoinRoomResult = RoomResponse | { pending: true; canvasId: string; roomId: string };

/** 类型守卫：join 结果是否为「待审申请」（审核制房间） */
export function isPendingJoinResult(result: JoinRoomResult): result is Extract<JoinRoomResult, { pending: true }> {
  return (result as { pending?: boolean }).pending === true;
}

/** 成员角色更新请求 */
export interface UpdateMemberRequest {
  role?: MemberRole;
  permissions?: Permission[];
}

/** 发送消息请求 */
export interface SendMessageRequest {
  content: string;
  mentions?: string[];
  agentMentioned?: boolean;
  replyToId?: string;
}

/** API 响应：房间信息 */
export interface RoomResponse extends CollaborationRoom {
  members?: CollaborationMember[];
  /** 画布标题(服务端下发,参与者本地无 project 元数据时用于编辑页标题) */
  canvasTitle?: string | null;
}

/** API 响应：我的房间列表项 */
export interface MyRoomItem {
  id: string;
  canvasId: string;
  mode: CollaborationMode;
  status: RoomStatus;
  ownerId: string;
  ownerName: string | null;
  memberCount: number;
  lastActiveAt: string;
}

/** API 响应：我拥有的画布 + 协作状态（主页"发起协作"模式/协作 Tag） */
export interface MyCanvasItem {
  canvasId: string;
  title: string;
  thumbnailUrl: string | null;
  updatedAt: string;
  collaborationStatus: CollaborationStatus;
  roomId: string | null;
  inviteCode: string | null;
  memberCount: number;
}

/** API 响应：我参与的协作画布列表项（含已失效） */
export interface ParticipatingCanvasItem {
  roomId: string;
  canvasId: string;
  title: string;
  thumbnailUrl: string | null;
  ownerName: string | null;
  roomStatus: RoomStatus;
  memberCount: number;
  lastActiveAt: string;
}

/** Agent 会话（共享记忆） */
export interface AgentSession {
  id: string;
  agentType: string;
  status: string;
  memory: Record<string, unknown> | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Agent 会话消息 */
export interface AgentSessionMessage {
  id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  toolCalls: Record<string, unknown> | null;
  createdAt: string;
}

/** Agent 执行请求 */
export interface AgentExecuteRequest {
  content: string;
  mentions?: string[];
  replyToId?: string;
}

/** Agent 执行响应 */
export interface AgentExecuteResponse {
  sessionId: string;
  message: CollaborationMessage | null;
  agentSessionMessage: AgentSessionMessage;
  error?: string;
}
