/**
 * broadcast-channel-service - 同浏览器跨标签页同步服务
 *
 * 替代 SSE 作为事件通知层,通过 BroadcastChannel 在同源标签页间通信。
 * 同时引入 Leader 选举机制:一个标签页作为 Leader 负责定时轮询云端,
 * 其他 Follower 标签页通过 BroadcastChannel 接收变更通知。
 *
 * 角色:
 *   Leader:   负责 30s 轮询 + 处理 session_taken_over 弹窗
 *   Follower: 不轮询,通过 BC 接收 Leader 广播的事件
 *
 * 事件流程(与 sse-service 一致,保持 window event 名称不变):
 *   Leader 轮询到云端有更新 → BC 广播 PROJECT_RELOAD_EVENT →
 *   Follower 通过 window event 接收到 → 触发 syncProjectFromCloud
 *
 * Leader 选举原则:leaderId 较小的标签页胜出,避免频繁切换
 */

import {
  debouncedFullSync,
  onProjectCreated,
} from './sync-service.js';
import type { ProjectConflict } from './sync-service.js';
import { setSyncStatus } from './sync-store.js';

// ─── Re-export window event names (same as sse-service, for backward compat) ───

export const PROJECT_RELOAD_EVENT = 'zeroexo:project-reload';
export const PROJECT_CONFLICT_EVENT = 'zeroexo:project-conflict';
export const PROJECT_DIFF_EVENT = 'zeroexo:project-diff';
export const PROJECT_DELETED_EVENT = 'zeroexo:project-deleted';
export const BROADCAST_LOGOUT_EVENT = 'zeroexo:bc-logout';

// ─── BroadcastChannel message types ───

const BC_CHANNEL_NAME = 'zeroexo:sync';

type BcEventType =
  | 'leader_heartbeat'
  | 'leader_elected'
  | 'project_created'
  | 'project_updated'
  | 'project_deleted'
  | 'project_conflict'
  | 'project_diff'
  | 'logout';

interface BcMessage {
  type: BcEventType;
  fromTabId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

// ─── Leader election constants ───

const HEARTBEAT_INTERVAL = 3000;       // Leader 每 3s 发一次心跳
const LEADER_TIMEOUT = 10000;          // 10s 没收到心跳 → 重新选举
const ELECTION_DELAY = 500 + Math.random() * 1000; // 0.5~1.5s 随机延迟选举

// ─── State ───

let tabId = '';
let channel: BroadcastChannel | null = null;
let isLeader = false;
let leaderId = '';
let lastHeartbeatTime = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let leaderCheckTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ─── Init ───

function initTabId(): void {
  if (!tabId) {
    tabId = crypto.randomUUID?.() ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 尝试从 sessionStorage 读取已有 ID(同一页面刷新时保持)
    try {
      const stored = sessionStorage.getItem('zeroexo:tab-id');
      if (stored) tabId = stored;
      sessionStorage.setItem('zeroexo:tab-id', tabId);
    } catch { /* sessionStorage not available */ }
  }
}

// ─── Message handling ───

function postMessage(type: BcEventType, payload: Record<string, unknown>): void {
  if (!channel) return;
  try {
    channel.postMessage({ type, fromTabId: tabId, timestamp: Date.now(), payload } satisfies BcMessage);
  } catch (err) {
    console.error('[bc-service] failed to post message:', err);
  }
}

function handleMessage(msg: MessageEvent<BcMessage>): void {
  const data = msg.data;
  if (data.fromTabId === tabId) return; // 忽略自己的消息

  switch (data.type) {
    case 'leader_heartbeat':
      lastHeartbeatTime = Date.now();
      if (!isLeader && data.fromTabId !== tabId) {
        leaderId = data.fromTabId;
      }
      break;

    case 'leader_elected': {
      const electedId = data.payload.leaderId as string;
      // 如果新 leader 的 ID 比我小,或者我没有初始化,接受它
      if (!isLeader && electedId !== tabId) {
        leaderId = electedId;
        lastHeartbeatTime = Date.now();
      }
      break;
    }

    case 'project_created': {
      const pid = data.payload.projectId as string;
      void onProjectCreated(pid);
      break;
    }

    case 'project_updated': {
      const updPid = data.payload.projectId as string;
      if (data.payload.hasConflict) {
        notifyProjectConflict({
          projectId: updPid,
          title: '',
          localVersion: 0,
          cloudVersion: 0,
          localUpdatedAt: '',
          cloudUpdatedAt: '',
          localNodeCount: 0,
          cloudNodeCount: 0,
          hasLocalChanges: true,
          cloudDeleted: data.payload.cloudDeleted as boolean,
        });
      } else {
        notifyProjectReload(updPid, data.payload.changedNodeIds as string[] | undefined);
      }
      break;
    }

    case 'project_deleted':
      notifyProjectDeleted(data.payload.projectId as string);
      break;

    case 'project_conflict':
      notifyProjectConflict(data.payload as unknown as ProjectConflict);
      break;

    case 'project_diff':
      notifyProjectDiff(data.payload.projectId as string);
      break;

    case 'logout':
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(BROADCAST_LOGOUT_EVENT));
      }
      break;
  }
}

// ─── Leader Election ───

async function becomeLeader(): Promise<void> {
  if (isLeader) return;
  isLeader = true;
  leaderId = tabId;
  stopBcPolling();

  // 广播选举结果
  postMessage('leader_elected', { leaderId: tabId });

  // 启动心跳
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    postMessage('leader_heartbeat', {});
  }, HEARTBEAT_INTERVAL);

  // 启动轮询(仅 Leader 执行)
  const POLL_INTERVAL = 30000;
  pollTimer = setInterval(() => {
    void debouncedFullSync();
  }, POLL_INTERVAL);

  console.log('[bc-service] became leader, polling every 30s');
}

function tryElectLeader(): void {
  if (leaderId) return; // 已有 leader

  postMessage('leader_elected', { leaderId: tabId });

  // 延迟后确认:如果没收到别的 leader 声明,就成为 leader
  setTimeout(() => {
    if (!leaderId || leaderId === tabId) {
      void becomeLeader();
    }
  }, ELECTION_DELAY);
}

function checkLeaderHealth(): void {
  if (isLeader) return; // 自己是 leader,不检查
  if (!leaderId) {
    // 没有 leader → 尝试选举
    tryElectLeader();
    return;
  }
  const elapsed = Date.now() - lastHeartbeatTime;
  if (elapsed > LEADER_TIMEOUT) {
    console.log('[bc-service] leader heartbeat timeout, re-electing');
    leaderId = '';
    tryElectLeader();
  }
}

// ─── Polling (fallback for non-leader tabs or leader timeout) ───

function startBcPolling(): void {
  if (pollTimer) return;
  const POLL_INTERVAL = 30000;
  pollTimer = setInterval(() => {
    void debouncedFullSync();
  }, POLL_INTERVAL);
}

function stopBcPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ─── Notification dispatchers (same window events as sse-service) ───

function notifyProjectConflict(conflict: ProjectConflict): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROJECT_CONFLICT_EVENT, { detail: conflict }));
}

function notifyProjectReload(projectId: string, changedNodeIds?: string[]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PROJECT_RELOAD_EVENT, { detail: { projectId, changedNodeIds } }),
  );
}

function notifyProjectDeleted(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PROJECT_DELETED_EVENT, { detail: { projectId } }),
  );
}

function notifyProjectDiff(projectId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PROJECT_DIFF_EVENT, { detail: { projectId } }),
  );
}

// ─── Public API ───

/**
 * 广播项目已更新(Leader 轮询到云端变更时调用)
 */
export function broadcastProjectUpdated(projectId: string, changedNodeIds?: string[]): void {
  postMessage('project_updated', { projectId, changedNodeIds });
}

/**
 * 广播项目冲突
 */
export function broadcastProjectConflict(conflict: ProjectConflict): void {
  postMessage('project_conflict', conflict as unknown as Record<string, unknown>);
}

/**
 * 广播登出事件（通知其他标签页同步登出）
 */
export function broadcastLogout(): void {
  postMessage('logout', {});
}

// ─── Start / Stop ───

export function startBcSync(): void {
  stopBcSync();

  initTabId();

  try {
    channel = new BroadcastChannel(BC_CHANNEL_NAME);
    channel.onmessage = handleMessage;
  } catch (err) {
    console.warn('[bc-service] BroadcastChannel not supported, falling back to independent polling');
    startBcPolling();
    return;
  }

  // Leader 健康检查
  leaderCheckTimer = setInterval(checkLeaderHealth, LEADER_TIMEOUT / 2);

  // 尝试成为 leader
  tryElectLeader();

  // 启动独立 polling 兜底(当 leader 选举失败时,每个 tab 仍有 polling 能力)
  // 但延迟 5s 执行,给 leader 选举充足时间
  setTimeout(() => {
    if (!isLeader && !pollTimer) {
      startBcPolling();
    }
  }, 5000);

  setSyncStatus('idle');
}

export function stopBcSync(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (leaderCheckTimer) { clearInterval(leaderCheckTimer); leaderCheckTimer = null; }
  stopBcPolling();

  if (channel) {
    try { channel.close(); } catch { /* ignore */ }
    channel = null;
  }

  isLeader = false;
  leaderId = '';
}
