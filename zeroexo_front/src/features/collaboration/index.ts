/**
 * Collaboration 模块导出入口
 *
 * 提供协作系统的所有公共 API：
 * - 类型定义
 * - API 客户端
 * - Store
 * - Hooks
 */

// 类型
export type {
  CollaborationMode,
  RoomStatus,
  MemberRole,
  MemberStatus,
  DeviceType,
  Permission,
  CollaborationRoom,
  CollaborationMember,
  MemberSession,
  CollaborationMessage,
  AwarenessState,
  CollaborationEvent,
  CollaborationEventType,
  JoinRoomRequest,
  AutoJoinRequest,
  CreateRoomRequest,
  UpdateRoomRequest,
  UpdateMemberRequest,
  SendMessageRequest,
  RoomResponse,
  MyRoomItem,
} from './collaboration-types.js';

// API 客户端
export {
  createRoom,
  getRoomByCanvas,
  updateRoom,
  closeRoom,
  listMyRooms,
  regenerateInvite,
  verifyInvite,
  joinRoom,
  autoJoinRoom,
  leaveRoom,
  listMembers,
  updateMember,
  kickMember,
  banMember,
  unbanMember,
  muteMember,
  unmuteMember,
  listMessages,
  sendMessage,
  deleteMessage,
  deviceTypeFromUA,
} from './collaboration-api.js';

// 实时事件连接（SSE）
export {
  connectCollaborationEvents,
  closeAllCollaborationConnections,
} from './collaboration-socket.js';
export type { CollaborationSocketHandle } from './collaboration-socket.js';

// Store
export {
  useCollaborationStore,
  createCollaborationStore,
  getRemoteAwarenessStates,
  groupAwarenessByUser,
} from './use-collaboration-store.js';

export type {
  CollaborationState,
  CollaborationActions,
  CollaborationStore,
} from './use-collaboration-store.js';

// Hook
export { useCollaboration } from './use-collaboration.js';
export type { UseCollaborationResult } from './use-collaboration.js';

// 协作聊天
export { CollaborationChat, MentionInput } from './collaboration-chat.js';
export type { CollaborationChatProps, MentionInputProps } from './collaboration-chat.js';

// 协作面板(Dock)
export { CollaborationPanel } from './collaboration-panel.js';
export type { CollaborationPanelProps } from './collaboration-panel.js';

// 协作管理弹窗(画布内)
export { CollaborationModal } from './collaboration-modal.js';
export type { CollaborationModalProps } from './collaboration-modal.js';

// 首页协作入口弹窗
export { HomeCollaborationModal } from './home-collaboration-modal.js';
export type { HomeCollaborationModalProps } from './home-collaboration-modal.js';

// 画布远端协作覆盖层(远端光标 + 选中高亮)
export { CollabOverlay } from './collab-overlay.js';
export type { CollabOverlayProps } from './collab-overlay.js';
