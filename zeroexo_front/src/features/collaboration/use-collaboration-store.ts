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
} from './collaboration-types.js';
import {
  autoJoinRoom,
  getRoomByCanvas,
  leaveRoom,
} from './collaboration-api.js';

/** 协作状态 */
export interface CollaborationState {
  /** 当前画布 ID */
  canvasId: string | null;
  /** 房间信息 */
  room: CollaborationRoom | null;
  /** 成员列表 */
  members: CollaborationMember[];
  /** Awareness 状态映射：clientId → AwarenessState */
  awarenessStates: Map<number, AwarenessState>;
  /** 聊天消息 */
  messages: CollaborationMessage[];
  /** 是否已初始化（auto-join 完成） */
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
}

/** 协作 actions */
export interface CollaborationActions {
  /** 初始化协作（auto-join + 加载房间信息） */
  init: (canvasId: string, deviceType?: DeviceType) => Promise<void>;
  /** 清理协作状态 */
  cleanup: () => void;
  /** 更新房间信息 */
  setRoom: (room: RoomResponse | null) => void;
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
}

export type CollaborationStore = CollaborationState & CollaborationActions;

const initialState: CollaborationState = {
  canvasId: null,
  room: null,
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
};

/**
 * 创建协作 store（每个 canvasId 一个实例）
 * 使用 zustand 的 create 工厂模式
 */
export function createCollaborationStore() {
  return create<CollaborationStore>((set, get) => ({
    ...initialState,

    init: async (canvasId: string, deviceType?: DeviceType) => {
      set({ canvasId, joining: true, error: null });

      try {
        // 1. 先尝试 auto-join（若房间不存在，后端会自动创建）
        const room = await autoJoinRoom(canvasId, deviceType);

        if (room) {
          set({
            room,
            active: true,
            initialized: true,
            joining: false,
            members: (room as RoomResponse).members ?? [],
          });
        }
      } catch (err) {
        // auto-join 失败（如网络问题），尝试直接获取房间信息
        try {
          const room = await getRoomByCanvas(canvasId);
          if (room) {
            set({
              room,
              active: true,
              initialized: true,
              joining: false,
              members: (room as RoomResponse).members ?? [],
            });
          }
        } catch {
          // 完全失败
          set({
            joining: false,
            error: err instanceof Error ? err.message : '协作初始化失败',
          });
        }
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
      set({ room, active: !!room });
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
      set({ active });
    },

    setAgentStatus: (status) => {
      set({ agentStatus: status });
    },

    setShowSelfCursor: (show) => {
      set({ showSelfCursor: show });
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
