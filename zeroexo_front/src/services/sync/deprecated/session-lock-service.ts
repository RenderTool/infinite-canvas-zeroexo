/**
 * session-lock-service - 会话锁(通用)
 *
 * 简化多标签页同步:同一用户只能在一个标签页编辑同一资源。
 * 支持资源路径前缀参数(如 '/projects/' / '/creation/')。
 * 当另一标签页/设备打开同一资源时:
 *   1. 抢占会话锁(claim)
 *   2. 后端通过 SSE 通知旧会话(session_taken_over)
 *   3. 旧标签页提示"此画布已在其他窗口打开,请刷新"
 *   4. 新标签页正常编辑
 *
 * 崩溃/断网兜底:后端每30s检查 heartbeat TTL(90s=3次容错),超时自动释放锁。
 *
 * TTL/3 原则(业界标准,Redis RedLock/DynamoDB Lock 等均采用):
 *   TTL=90s, 心跳=30s — 最多允许 3 次心跳失败(约 90s)才释放锁
 */

import { apiPost, apiPut, apiDelete } from '../../api-client.js';

const HEARTBEAT_INTERVAL_MS = 10_000; // 10s:跨端口/跨源标签页仅能靠心跳检测会话被抢占,缩短间隔以更快弹出接管提示

let currentSessionId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let resourceId: string | null = null;
/** 资源路径前缀(如 '/projects/' 或 '/creation/'),末尾带/ */
let pathPrefix = '/projects/';
/** 正在抢占会话的资源 ID(API 调用前设置,用于 SSE 事件处理中的自身识别) */
let pendingClaimProjectId: string | null = null;

/** 是否正在为指定资源抢占会话 */
export function isClaimingProject(id: string): boolean {
  return pendingClaimProjectId === id;
}

/**
 * 抢占会话锁(返回成功/失败)
 * @param id 资源 ID
 * @param prefix 资源路径前缀(默认 '/projects/'),末尾带/
 */
export async function claimSession(id: string, prefix = '/projects/'): Promise<boolean> {
  try {
    pathPrefix = prefix;
    pendingClaimProjectId = id;
    const res = await apiPost<{ sessionId: string }>(`${prefix}${id}/session`);
    currentSessionId = res.sessionId;
    resourceId = id;
    pendingClaimProjectId = null;
    startHeartbeat();
    return true;
  } catch {
    pendingClaimProjectId = null;
    return false;
  }
}

/** 启动心跳 */
function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (currentSessionId && resourceId) {
      try {
        await apiPut(`${pathPrefix}${resourceId}/session/${currentSessionId}/heartbeat`, {});
      } catch (err) {
        // 409 Conflict → 会话已被其他标签页/设备抢占或后端重启导致会话丢失
        // 需要停止心跳并通知用户刷新,避免永久发送无效请求
        if (err instanceof Error && err.message?.includes('409')) {
          stopHeartbeat();
          console.warn('[session-lock-service] session expired, dispatching taken-over event');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('zeroexo:session-taken-over', {
                detail: { projectId: resourceId, meta: { sessionId: currentSessionId, newSessionId: '' } },
              }),
            );
          }
        }
        // 其他网络错误静默忽略(断网/后端不可用时自动释放)
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/** 停止心跳 */
function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** 释放会话锁(编辑器卸载时调用) */
export async function releaseSession(): Promise<void> {
  stopHeartbeat();
  if (currentSessionId && resourceId) {
    try {
      await apiDelete(`${pathPrefix}${resourceId}/session/${currentSessionId}`);
    } catch {
      // 静默
    }
    currentSessionId = null;
    resourceId = null;
  }
}

/** 当前会话ID(供SSE handler判断 session_taken_over 是否匹配当前会话) */
export function getSessionId(): string | null {
  return currentSessionId;
}

/**
 * 验证当前会话是否仍然有效
 * 通过发送一次心跳请求检测,若失败则说明会话已被其他标签页/设备抢占或过期。
 * 在 visibilitychange 恢复时调用,替代原有的全量同步推送逻辑。
 * @returns true=会话有效, false=会话已失效
 */
export async function validateCurrentSession(): Promise<boolean> {
  if (!currentSessionId || !resourceId) return true; // 无会话连接时不做检测
  try {
    await apiPut(`${pathPrefix}${resourceId}/session/${currentSessionId}/heartbeat`, {});
    return true;
  } catch {
    // 心跳失败 → 会话已过期/被其他标签页抢占
    // 通知编辑器显示"会话已过期"提示
    console.warn('[session-lock-service] session heartbeat failed, session may have been taken over');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('zeroexo:session-taken-over', {
          detail: { projectId: resourceId, meta: { sessionId: currentSessionId, newSessionId: '' } },
        }),
      );
    }
    return false;
  }
}
