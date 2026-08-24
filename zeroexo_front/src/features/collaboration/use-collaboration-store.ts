/**
 * useCollaborationStore - 协作状态管理 (zustand)
 *
 * 管理：
 * - 当前画布的协作房间信息
 * - 成员列表（含多设备 session）
 * - Awareness 光标状态
 * - 聊天消息
 * - 连接状态
 *
 * 设计：每个 canvasId 独立的 store 实例，通过 getState() 获取。
 */
import { create } from 'zustand';
import type {
  CollaborationRoom,
  CollaborationMember,
  CollaborationMessage,
  AwarenessState,
  DeviceType,
  RoomResponse,
  CollaborationStatus,
} from './collaboration-types.js';
import {
  getRoomByCanvas,
  leaveRoom,
} from './collaboration-api.js';
import { isPendingJoinResult } from './collaboration-types.js';

/** 协作状态 */
export interface CollaborationState {
  /** 当前画布 ID */
  canvasId: string | null;
  /** 当前用户 ID（用于区分房主/参与者视角） */
  userId: string | null;
  /** 房间信息 */
  room: CollaborationRoom | null;
  /** 协作状态: idle(未开启) | active(协作中) | expired(已失效) */
  status: CollaborationStatus;
  /** 成员列表 */
  members: CollaborationMember[];
  /** Awareness 状态映射：clientId → AwarenessState */
  awarenessStates: Map<number, AwarenessState>;
  /** 聊天消息 */
  messages: CollaborationMessage[];
  /** 是否已初始化（房间状态探测完成） */
  initialized: boolean;
  /** 协作是否活跃 */
  active: boolean;
  /** 是否正在加入 */
  joining: boolean;
  /** 错误信息 */
  error: string | null;
  /** 自己的 Awareness 状态 */
  localAwareness: AwarenessState | null;
  /** Agent 执行状态（思考中 / 工具调用中） */
  agentStatus: {
    thinking: boolean;
    toolName?: string;
    senderName?: string;
  } | null;
  /** 是否显示本地光标(自检):默认关闭,仅调试面板可开启 */
  showSelfCursor: boolean;
  /** 会话级协作激活标记:本次页面会话中协作曾激活过(active/房间存在)。
   *  room_closed 后保持 true → 光标广播继续(关协作只断 SSE 不断 Yjs);
   *  从未开启协作时保持 false → 不广播光标(双页签 idle 无谓广播是卡顿源之一) */
  collabSessionActive: boolean;
  /** 未读聊天消息数（SSE 实时消息到达且不在聊天 Tab 时累加；切到聊天 Tab 清零） */
  unreadMessages: number;
  /** 待审加入申请数（房主侧；join_application 到达时累加，弹窗同步真实列表后覆盖） */
  pendingApprovals: number;
  /** 新成员加入提醒数（member_joined 到达且非自己时累加；切到成员 Tab 清零） */
  newMemberCount: number;
}

/** 协作 actions */
export interface CollaborationActions {
  /** 初始化协作（探测房间状态；不再自动创建房间） */
  init: (canvasId: string, deviceType?: DeviceType, userId?: string) => Promise<void>;
  /** 清理协作状态 */
  cleanup: () => void;
  /** 更新房间信息（status/active 随房间状态联动） */
  setRoom: (room: RoomResponse | null) => void;
  /** 设置协作状态 */
  setStatus: (status: CollaborationStatus) => void;
  /** 更新成员列表 */
  setMembers: (members: CollaborationMember[]) => void;
  /** 添加/更新 Awareness 状态 */
  updateAwareness: (state: AwarenessState) => void;
  /** 移除 Awareness 状态 */
  removeAwareness: (clientId: number) => void;
  /** 批量更新 Awareness */
  batchUpdateAwareness: (states: AwarenessState[]) => void;
  /** 设置本地 Awareness 状态（自己的光标/视口） */
  setLocalAwareness: (state: AwarenessState) => void;
  /** 添加聊天消息 */
  addMessage: (message: CollaborationMessage) => void;
  /** 移除聊天消息（消息被删除时） */
  removeMessage: (messageId: string) => void;
  /** 加载历史消息 */
  setMessages: (messages: CollaborationMessage[]) => void;
  /** 设置错误 */
  setError: (error: string | null) => void;
  /** 设置活跃状态 */
  setActive: (active: boolean) => void;
  /** 设置 Agent 执行状态 */
  setAgentStatus: (status: CollaborationState['agentStatus']) => void;
  /** 切换本地光标(自检)显示 */
  setShowSelfCursor: (show: boolean) => void;
  /** 设置会话级协作激活标记(只置 true,不因 room_closed 清除) */
  setCollabSessionActive: (active: boolean) => void;
  /** 未读消息 +1（排除自己发的） */
  bumpUnreadMessages: () => void;
  /** 清空未读消息（切到聊天 Tab / 发消息时） */
  clearUnreadMessages: () => void;
  /** 待审申请数（以弹窗拉取的真实列表覆盖） */
  setPendingApprovals: (n: number) => void;
  /** 待审申请数 +1（SSE join_application 到达） */
  bumpPendingApprovals: () => void;
  /** 新成员加入提醒 +1（SSE member_joined 到达且非自己） */
  bumpNewMemberCount: () => void;
  /** 清空新成员提醒（切到成员 Tab 时） */
  clearNewMemberCount: () => void;
}

export type CollaborationStore = CollaborationState & CollaborationActions;

const initialState: CollaborationState = {
  canvasId: null,
  userId: null,
  room: null,
  status: 'idle',
  members: [],
  awarenessStates: new Map(),
  messages: [],
  initialized: false,
  active: false,
  joining: false,
  error: null,
  localAwareness: null,
  agentStatus: null,
  showSelfCursor: false,
  collabSessionActive: false,
  /** 未读聊天消息数(SSE 实时消息到达且不在聊天 Tab 时累加;切到聊天 Tab 清零) */
  unreadMessages: 0,
  /** 待审加入申请数(房主侧;join_application 到达时累加,弹窗同步真实列表后覆盖) */
  pendingApprovals: 0,
  /** 新成员加入提醒数(member_joined 到达且非自己时累加;切到成员 Tab 清零) */
  newMemberCount: 0,
};

/**
 * 创建协作 store（每个 canvasId 一个实例）
 * 使用 zustand 的 create 工厂模式
 */
export function createCollaborationStore() {
  return create<CollaborationStore>((set, get) => ({
    ...initialState,

    init: async (canvasId: string, _deviceType?: DeviceType, userId?: string) => {
      set({ canvasId, userId: userId ?? null, joining: true, error: null });

      try {
        // 探测画布房间状态（不自动创建房间；房间不存在 → 未开启）
        const room = await getRoomByCanvas(canvasId);

        if (room) {
          // 审核制（2026-08-25）：待审申请未批准（画布页内重进被 SSE 转 pending /
          // 重进时后端返回待审标记）→ 置"待审中"状态，画布页据此显示等待审核覆盖层
          if (isPendingJoinResult(room)) {
            set({ room: null, status: 'pending', active: false, initialized: true, joining: false });
            return;
          }
          const isOwner = room.ownerId === String(userId ?? room.ownerId);
          // 房主视角：已失效(expired)视同未开启(idle)，可重新发起协作
          // 参与者视角：已失效(expired)标记为"协作已失效"
          let status: CollaborationStatus = 'idle';
          if (room.status === 'active') status = 'active';
          else if (!isOwner) status = 'expired';

          set({
            room,
            status,
            active: status === 'active',
            initialized: true,
            joining: false,
            members: (room as RoomResponse).members ?? [],
            // 房间活跃 → 标记会话级激活(光标广播门控用)
            collabSessionActive: status === 'active' ? true : get().collabSessionActive,
          });
        } else {
          set({
            room: null,
            status: 'idle',
            active: false,
            initialized: true,
            joining: false,
          });
        }
      } catch {
        // 房间不存在/非成员/网络异常 → 一律按"未开启"处理（C 端不展示后端错误细节）
        set({
          room: null,
          status: 'idle',
          active: false,
          initialized: true,
          joining: false,
          error: null,
        });
      }
    },

    cleanup: () => {
      const { canvasId, active } = get();
      if (active && canvasId) {
        // 异步离开房间（不阻塞）
        void leaveRoom(canvasId).catch(() => {});
      }
      set({ ...initialState });
    },

    setRoom: (room) => {
      set({
        room,
        active: !!room && room.status === 'active',
        status: !room ? 'idle' : room.status === 'active' ? 'active' : 'expired',
        // 房间曾活跃 → 置位;room_closed 置 null 时不清(光标广播跟随 Yjs 生命周期)
        collabSessionActive: !!room && room.status === 'active' ? true : get().collabSessionActive,
      });
    },

    setStatus: (status) => {
      set({ status });
    },

    setMembers: (members) => {
      set({ members });
    },

    updateAwareness: (state) => {
      const { awarenessStates } = get();
      const next = new Map(awarenessStates);
      next.set(state.clientId, state);
      set({ awarenessStates: next });
    },

    removeAwareness: (clientId) => {
      const { awarenessStates } = get();
      const next = new Map(awarenessStates);
      next.delete(clientId);
      set({ awarenessStates: next });
    },

    batchUpdateAwareness: (states) => {
      const { awarenessStates } = get();
      const next = new Map(awarenessStates);
      for (const s of states) {
        next.set(s.clientId, s);
      }
      set({ awarenessStates: next });
    },

    setLocalAwareness: (state) => {
      set({ localAwareness: state });
    },

    addMessage: (message) => {
      const { messages } = get();
      // 按 id 去重：同一消息可能由 SSE 推送与 API 响应同时到达
      if (messages.some((m) => m.id === message.id)) return;
      set({ messages: [...messages, message] });
    },

    removeMessage: (messageId) => {
      const { messages } = get();
      set({ messages: messages.filter((m) => m.id !== messageId) });
    },

    setMessages: (messages) => {
      set({ messages });
    },

    setError: (error) => {
      set({ error });
    },

    setActive: (active) => {
      set({
        active,
        // 激活过即置位,关协作(setActive false)不清——光标广播门控依赖此标记
        collabSessionActive: active ? true : get().collabSessionActive,
      });
    },

    setAgentStatus: (status) => {
      set({ agentStatus: status });
    },

    setShowSelfCursor: (show) => {
      set({ showSelfCursor: show });
    },

    setCollabSessionActive: (active) => {
      set({ collabSessionActive: active ? true : get().collabSessionActive });
    },

    bumpUnreadMessages: () => {
      set((s) => ({ unreadMessages: s.unreadMessages + 1 }));
    },

    clearUnreadMessages: () => {
      set({ unreadMessages: 0 });
    },

    setPendingApprovals: (n) => {
      set({ pendingApprovals: n });
    },

    bumpPendingApprovals: () => {
      set((s) => ({ pendingApprovals: s.pendingApprovals + 1 }));
    },

    bumpNewMemberCount: () => {
      set((s) => ({ newMemberCount: s.newMemberCount + 1 }));
    },

    clearNewMemberCount: () => {
      set({ newMemberCount: 0 });
    },
  }));
}

/** 全局 store 实例（单画布场景） */
export const useCollaborationStore = createCollaborationStore();

/**
 * 本地光标"即时"通道:pointermove 每帧直写,不经过 40ms 广播节流。
 * 仅用于 CanvasOverlay 本地光标 DOM 渲染(每帧读取,与 OS 鼠标同步);
 * 不触发 store 变更/React 重渲染,真实广播仍走节流后的 localAwareness。
 * t 为最近一次写入的 performance.now(),-1 表示尚无数据。
 *
 * 订阅:写入时通知订阅者(本地光标 rAF 渲染调度用),避免空转自续帧。
 */
type CursorSubscriber = () => void;
const cursorListeners = new Set<CursorSubscriber>();

export const fastLocalCursor = {
  x: 0,
  y: 0,
  t: -1,
  set(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.t = performance.now();
    for (const fn of cursorListeners) fn();
  },
  /** 订阅光标写入事件,返回取消订阅函数 */
  subscribe(fn: CursorSubscriber): () => void {
    cursorListeners.add(fn);
    return () => {
      cursorListeners.delete(fn);
    };
  },
};

/** 工具：从 store 获取远端 Awareness 列表（排除自己） */
export function getRemoteAwarenessStates(
  states: Map<number, AwarenessState>,
  localClientId: number,
): AwarenessState[] {
  const result: AwarenessState[] = [];
  for (const [clientId, state] of states) {
    if (clientId !== localClientId) {
      result.push(state);
    }
  }
  return result;
}

/** 工具：按用户 ID 聚合 Awareness 状态 */
export function groupAwarenessByUser(
  states: AwarenessState[],
): Map<string, AwarenessState[]> {
  const map = new Map<string, AwarenessState[]>();
  for (const state of states) {
    const existing = map.get(state.userId);
    if (existing) {
      existing.push(state);
    } else {
      map.set(state.userId, [state]);
    }
  }
  return map;
}
