/**
 * useCollaboration - 协作系统核心 Hook
 *
 * 整合：
 * 1. auto-join 自动加入房间
 * 2. Awareness 光标同步（通过 Yjs Awareness 协议）
 * 3. 成员状态管理
 * 4. 协作 API 调用封装
 *
 * 用法：
 *   const {
 *     room, members, awarenessStates,
 *     sendCursor, subscribeRemoteCursors,
 *     joinRoom, leaveRoom, kickMember, ...
 *   } = useCollaboration(canvasId);
 */
import { useEffect, useCallback, useRef } from 'react';
import { useCollaborationStore } from './use-collaboration-store.js';
import { connectCollaborationEvents, closeAllCollaborationConnections } from './collaboration-socket.js';
import type { AwarenessState, DeviceType, CollaborationMessage } from './collaboration-types.js';
import {
  joinRoom,
  leaveRoom,
  kickMember,
  banMember,
  muteMember,
  unmuteMember,
  listMessages,
  sendMessage as sendMessageApi,
  executeAgent as executeAgentApi,
  listMembers,
  deviceTypeFromUA,
} from './collaboration-api.js';
import type { AgentExecuteRequest, AgentExecuteResponse } from './collaboration-types.js';
import type { CanvasSyncResult, AwarenessStateInfo } from '@/shared/hooks/use-doc-sync.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { publishCursorBc, subscribeCursorBc, type CursorBcMessage } from './collaboration-bc.js';
// 调试埋点(左上角调试面板数据总线,全部 O(1) 计数,不污染运行时)
import { collabDebug } from '@/features/dev-performance/collab-debug.js';
import { fastLocalCursor } from './use-collaboration-store.js';

/** 光标广播节流间隔(ms):pointermove 可达 60~120Hz,合并到该间隔发送,减少 WS/BC 消息量 */
const CURSOR_THROTTLE_MS = 40;

export interface UseCollaborationResult {
  /** 房间信息 */
  room: ReturnType<typeof useCollaborationStore.getState>['room'];
  /** 成员列表 */
  members: ReturnType<typeof useCollaborationStore.getState>['members'];
  /** Awareness 状态映射（所有远端光标/视口） */
  awarenessStates: Map<number, AwarenessState>;
  /** 是否活跃 */
  active: boolean;
  /** 是否已初始化 */
  initialized: boolean;
  /** 是否正在加入 */
  joining: boolean;
  /** 错误信息 */
  error: string | null;
  /** 初始化协作（auto-join） */
  initCollaboration: (canvasId: string) => Promise<void>;
  /** 清理协作状态 */
  cleanup: () => void;
  /** 设置本地光标位置（通过 Awareness） */
  setLocalCursor: (cursor: { x: number; y: number } | null, viewport?: AwarenessState['viewport'], selectedNodeIds?: string[]) => void;
  /** 加入房间（通过邀请码） */
  joinWithInvite: (canvasId: string, inviteCode: string, nickname?: string) => Promise<void>;
  /** 离开房间 */
  leave: () => Promise<void>;
  /** 踢出成员 */
  kick: (userId: string) => Promise<void>;
  /** 封禁成员 */
  ban: (userId: string) => Promise<void>;
  /** 禁言成员 */
  mute: (userId: string) => Promise<void>;
  /** 解除禁言 */
  unmute: (userId: string) => Promise<void>;
  /** 发送聊天消息 */
  sendChatMessage: (content: string, mentions?: string[]) => Promise<CollaborationMessage | null>;
  /**
   * @deprecated 协作聊天 @AI 派发路径已废弃（Plan#8 T6），Agent 交互迁移至 AgentDock。
   * 保留仅作历史引用。
   */
  executeAgent: (content: string, mentions?: string[], replyToId?: string) => Promise<AgentExecuteResponse | null>;
  /** Agent 执行状态（思考中 / 工具调用中） */
  agentStatus: ReturnType<typeof useCollaborationStore.getState>['agentStatus'];
  /** 加载聊天历史 */
  loadMessages: (limit?: number) => Promise<void>;
  /** 订阅远端 Awareness 变化 */
  subscribeRemoteAwareness: (canvasSync: CanvasSyncResult | null) => () => void;
}

/**
 * 主协作 Hook
 * @param canvasId 画布 ID
 * @param canvasSync 来自 useCanvasSync 的同步结果（包含 awareness 方法）
 */
export function useCollaboration(
  canvasId: string | null | undefined,
  canvasSync: CanvasSyncResult | null,
): UseCollaborationResult {
  const store = useCollaborationStore;
  const { user } = useAuth();
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // 光标节流状态(仅最新位置会被补发,保证最终位置不丢)
  const lastCursorSentAtRef = useRef(0);
  const cursorPendingRef = useRef<Record<string, unknown> | undefined>(undefined);
  const cursorSendTimerRef = useRef<number | null>(null);

  // 初始化协作（auto-join）
  const initCollaboration = useCallback(async (id: string) => {
    const deviceType = deviceTypeFromUA();
    await store.getState().init(id, deviceType);

    // 加载成员列表
    try {
      const members = await listMembers(id);
      store.getState().setMembers(members);
    } catch { /* ignore */ }

    // 建立实时事件连接（SSE），收到成员/消息/房间事件时自动刷新 store
    // 传入 userId 用于检测自己被踢出（必须依赖 user?.id，避免闭包捕获过时值）
    connectCollaborationEvents(id, user?.id);
  }, [store, user?.id]);

  // 组件挂载时自动加入
  useEffect(() => {
    if (!canvasId || !user) return;
    void initCollaboration(canvasId);

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, user?.id]);

  // 订阅同源标签页的光标直连频道(绕过服务器,按 clientId 去重)
  useEffect(() => {
    if (!canvasId || !canvasSync) return;
    const unsubBc = subscribeCursorBc(canvasId, (msg) => {
      const localClientId = canvasSync.getAwarenessClientId();
      if (localClientId !== null && msg.clientId === localClientId) return;
      store.getState().updateAwareness({
        clientId: msg.clientId,
        userId: msg.userId,
        sessionIndex: msg.sessionIndex,
        deviceType: msg.deviceType,
        cursor: msg.cursor,
        viewport: msg.viewport,
        selectedNodeIds: msg.selectedNodeIds ?? [],
        online: true,
        lastUpdated: msg.lastUpdated,
      });
    });
    return unsubBc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, canvasSync]);

  // 清理
  const cleanup = useCallback(() => {
    // 清理未发送的光标节流定时器
    if (cursorSendTimerRef.current !== null) {
      clearTimeout(cursorSendTimerRef.current);
      cursorSendTimerRef.current = null;
    }
    cursorPendingRef.current = undefined;
    lastCursorSentAtRef.current = 0;

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    // 断开所有实时事件连接
    closeAllCollaborationConnections();
    store.getState().cleanup();
  }, [store]);

  // 实际发送:写入 WS Awareness + 本地 store + 同源 BC 直达
  const applyLocalCursor = useCallback((state: Record<string, unknown>, clientId: number) => {
    // 调试埋点仅 DEV 构建生效,生产构建整块剔除(连同 collab-debug 模块)
    if (import.meta.env.DEV) collabDebug.recordBroadcast();
    if (!canvasSync) return;
    canvasSync.setAwarenessField('cursor-data', state);

    const sessionIndex = (state.sessionIndex as number) ?? 0;
    const deviceType = (state.deviceType as DeviceType) ?? deviceTypeFromUA();
    store.getState().setLocalAwareness({
      clientId,
      userId: (state.userId as string) ?? '',
      sessionIndex,
      deviceType,
      cursor: (state.cursor as { x: number; y: number }) ?? null,
      viewport: state.viewport as AwarenessState['viewport'] | undefined,
      selectedNodeIds: (state.selectedNodeIds as string[]) ?? [],
      online: true,
      lastUpdated: (state.lastUpdated as number) ?? Date.now(),
    });

    // 同源标签页直连(不走服务器)
    publishCursorBc(canvasId ?? '', {
      type: 'cursor',
      canvasId: canvasId ?? '',
      clientId,
      userId: (state.userId as string) ?? '',
      sessionIndex,
      deviceType,
      cursor: (state.cursor as { x: number; y: number }) ?? null,
      viewport: state.viewport as CursorBcMessage['viewport'],
      selectedNodeIds: (state.selectedNodeIds as string[]) ?? [],
      lastUpdated: (state.lastUpdated as number) ?? Date.now(),
    });
  }, [canvasSync, store, canvasId]);

  // 设置本地光标/视口(节流到 CURSOR_THROTTLE_MS 合并发送,尾部补发最新位置)
  const setLocalCursor = useCallback((
    cursor: { x: number; y: number } | null,
    viewport?: AwarenessState['viewport'],
    selectedNodeIds?: string[],
  ) => {
    if (!canvasSync) return;
    const state: Record<string, unknown> = {
      userId: user?.id ?? '',
      sessionIndex: store.getState().localAwareness?.sessionIndex ?? 0,
      deviceType: store.getState().localAwareness?.deviceType ?? deviceTypeFromUA(),
      online: true,
      lastUpdated: Date.now(),
    };
    if (cursor) state.cursor = cursor;
    if (viewport) state.viewport = viewport;
    if (selectedNodeIds) state.selectedNodeIds = selectedNodeIds;

    const clientId = canvasSync.getAwarenessClientId();
    if (clientId === null) return;

    // 即时光标通道:不经过节流直接写入,供本地 canvas overlay 逐帧渲染(与 OS 鼠标同步)
    if (cursor) fastLocalCursor.set(cursor.x, cursor.y);

    const now = Date.now();
    if (now - lastCursorSentAtRef.current >= CURSOR_THROTTLE_MS) {
      lastCursorSentAtRef.current = now;
      applyLocalCursor(state, clientId);
    } else {
      // 节流窗口内:记录最新位置,由定时器补发(保证停止移动前的最终位置被广播)
      if (import.meta.env.DEV) collabDebug.recordThrottled();
      cursorPendingRef.current = { ...state, lastUpdated: now };
      if (cursorSendTimerRef.current === null) {
        cursorSendTimerRef.current = window.setTimeout(() => {
          cursorSendTimerRef.current = null;
          const pending = cursorPendingRef.current;
          cursorPendingRef.current = undefined;
          if (pending) {
            lastCursorSentAtRef.current = Date.now();
            applyLocalCursor(pending, canvasSync.getAwarenessClientId() ?? clientId);
          }
        }, CURSOR_THROTTLE_MS);
      }
    }
  }, [canvasSync, user?.id, store, applyLocalCursor]);

  // 订阅远端 Awareness 变化
  const subscribeRemoteAwareness = useCallback((sync: CanvasSyncResult | null): (() => void) => {
    if (!sync) return () => {};

    const unsub = sync.subscribeAwareness((states: AwarenessStateInfo[]) => {
      if (import.meta.env.DEV) collabDebug.recordWsAwareness(states.length);
      const awarenessStates = store.getState().awarenessStates;
      const localClientId = sync.getAwarenessClientId() ?? store.getState().localAwareness?.clientId ?? -1;
      const next = new Map(awarenessStates);

      for (const s of states) {
        if (s.clientId === localClientId) continue;

        const cursorData = s.state?.['cursor-data'] as Record<string, unknown> | undefined;
        const awareness: AwarenessState = {
          clientId: s.clientId,
          userId: (cursorData?.userId as string) ?? '',
          sessionIndex: (cursorData?.sessionIndex as number) ?? 0,
          deviceType: (cursorData?.deviceType as DeviceType) ?? 'desktop',
          cursor: (cursorData?.cursor as { x: number; y: number }) ?? null,
          viewport: cursorData?.viewport as AwarenessState['viewport'] | undefined,
          selectedNodeIds: (cursorData?.selectedNodeIds as string[]) ?? [],
          online: (cursorData?.online as boolean) ?? true,
          lastUpdated: (cursorData?.lastUpdated as number) ?? Date.now(),
        };

        // 超时移除（30 秒无更新视为离线）
        if (Date.now() - awareness.lastUpdated > 30000) {
          next.delete(s.clientId);
        } else {
          next.set(s.clientId, awareness);
        }
      }

      // 清理已离线的
      for (const [clientId, state] of next) {
        if (Date.now() - state.lastUpdated > 30000) {
          next.delete(clientId);
        }
      }

      // 强制转换为新 Map 触发 React 重新渲染
      store.setState({ awarenessStates: new Map(next) });
    });

    unsubscribeRef.current = unsub;
    return unsub;
  }, [store]);

  // 加入房间（通过邀请码）
  const joinWithInvite = useCallback(async (id: string, inviteCode: string, nickname?: string) => {
    const deviceType = deviceTypeFromUA();
    const result = await joinRoom(id, inviteCode, nickname, deviceType);
    store.getState().setRoom(result);

    try {
      const members = await listMembers(id);
      store.getState().setMembers(members);
    } catch { /* ignore */ }
  }, [store]);

  // 离开
  const leave = useCallback(async () => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return;
    await leaveRoom(currentCanvasId);
    cleanup();
  }, [store, cleanup]);

  // 踢出
  const kick = useCallback(async (userId: string) => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return;
    await kickMember(currentCanvasId, userId);
    const members = await listMembers(currentCanvasId);
    store.getState().setMembers(members);
  }, [store]);

  // 封禁
  const ban = useCallback(async (userId: string) => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return;
    await banMember(currentCanvasId, userId);
    const members = await listMembers(currentCanvasId);
    store.getState().setMembers(members);
  }, [store]);

  // 禁言
  const mute = useCallback(async (userId: string) => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return;
    await muteMember(currentCanvasId, userId);
    const members = await listMembers(currentCanvasId);
    store.getState().setMembers(members);
  }, [store]);

  // 解除禁言
  const unmute = useCallback(async (userId: string) => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return;
    await unmuteMember(currentCanvasId, userId);
    const members = await listMembers(currentCanvasId);
    store.getState().setMembers(members);
  }, [store]);

  // 发送消息
  const sendChatMessage = useCallback(async (content: string, mentions: string[] = []) => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return null;
    const message = await sendMessageApi(currentCanvasId, { content, mentions });
    store.getState().addMessage(message);
    return message;
  }, [store]);

  /**
   * @deprecated 协作聊天 @AI 派发路径已废弃（Plan#8 T6），Agent 交互迁移至 AgentDock。
   * 保留仅作历史引用。
   */
  // 执行协作 Agent（@AI 触发）
  const executeAgent = useCallback(async (content: string, mentions: string[] = [], replyToId?: string) => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return null;
    const dto: AgentExecuteRequest = { content, mentions };
    if (replyToId) dto.replyToId = replyToId;
    const result = await executeAgentApi(currentCanvasId, dto);
    // 结果消息已通过 SSE agent_result / message 事件追加到 store
    return result;
  }, [store]);

  // 加载消息
  const loadMessages = useCallback(async (limit: number = 50) => {
    const currentCanvasId = store.getState().canvasId;
    if (!currentCanvasId) return;
    const messages = await listMessages(currentCanvasId, limit);
    store.getState().setMessages(messages);
  }, [store]);

  // 订阅 awareness
  useEffect(() => {
    if (!canvasSync || !canvasId) return;
    const unsub = subscribeRemoteAwareness(canvasSync);
    return () => {
      unsub();
    };
  }, [canvasSync, canvasId, subscribeRemoteAwareness]);

  // 从 store 读取当前状态
  const state = store();

  return {
    room: state.room,
    members: state.members,
    awarenessStates: state.awarenessStates,
    active: state.active,
    initialized: state.initialized,
    joining: state.joining,
    error: state.error,
    initCollaboration,
    cleanup,
    setLocalCursor,
    joinWithInvite,
    leave,
    kick,
    ban,
    mute,
    unmute,
    sendChatMessage,
    executeAgent,
    agentStatus: state.agentStatus,
    loadMessages,
    subscribeRemoteAwareness,
  };
}
