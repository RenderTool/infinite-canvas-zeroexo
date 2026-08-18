/**
 * useAiGenerationSse - AI 生成结果 SSE 订阅
 *
 * 替代 500ms 轮询 GET /ai/generations/:id 的方案，改用 Server-Sent Events
 * 接收后端 AiEventsService 广播的 `ai_generation_completed` 事件。
 *
 * 优势：
 *   1. 零轮询：长任务不再累积 HTTP 请求
 *   2. 实时性：生成完成立即推送，无 500ms 延迟
 *   3. 统一事件：success / failed / cancelled 三种终态均通过同一通道下发
 *
 * 后端事件结构（sync-events.service.ts + ai-generate.worker.ts）：
 *   {
 *     type: 'ai_generation_completed' | 'ai_generation_submitted',
 *     userId: string,
 *     resourceId: string,        // ← generationId
 *     timestamp: number,
 *     meta: {
 *       status: 'success' | 'failed' | 'cancelled' | 'submitted',
 *       generationId: string,
 *       url?: string,            // 成功时的结果图片 URL
 *       errorMessage?: string,   // 失败时的错误信息
 *       stage?: 'queued' | 'processing', // 取消时的任务阶段（成本透明提示）
 *       kind?: string,           // submitted 事件携带的生成类型
 *       model?: string,          // submitted 事件携带的模型
 *       providerName?: string,   // submitted 事件携带的渠道名
 *     }
 *   }
 *
 * 多端同步说明：
 *   - ai_generation_submitted：A 端发起生成时广播，B/C 端收到后刷新历史，
 *     让其他端立即看到"生成中"任务
 *   - ai_generation_completed：任务终态广播。本端未追踪的 completed 事件
 *     （其他端发起的）也触发历史刷新，让所有端看到最终状态
 *
 * 连接管理：
 *   - enabled=false 时不建立连接
 *   - 组件卸载时主动关闭连接（close()）
 *   - 非主动关闭时自动重连（fetchEventSource 内置 retry）
 *   - 401 时清空 token 并跳转登录（与 api-client 行为一致）
 */
import { useEffect, useRef } from 'react';
import { fetchEventSource, EventSourceMessage } from '@microsoft/fetch-event-source';
import { getApiBaseUrl, getAccessToken } from '@/services/api-client';

/** SSE 推送的 AI 生成完成事件（解析后） */
export interface AiGenerationSseEvent {
  /** 生成任务 ID（对应 AiGeneration.id） */
  generationId: string;
  /** 终态：成功 / 失败 / 已取消；或 submitted（其他端刚提交的"生成中"任务） */
  status: 'success' | 'failed' | 'cancelled' | 'submitted';
  /** 成功时的结果图片 URL（来自 meta.url） */
  url?: string;
  /** 失败/取消时的错误信息（来自 meta.errorMessage） */
  errorMessage?: string;
  /**
   * 取消时的任务阶段（来自 meta.stage，仅 cancelled 事件携带）
   * - 'queued': 排队中取消，未产生费用
   * - 'processing': 处理中取消，已提交运营商可能产生部分费用
   * - undefined: 轮询兜底或非取消事件
   */
  stage?: 'queued' | 'processing';
  /** 原始事件时间戳 */
  timestamp: number;
}

export interface UseAiGenerationSseOptions {
  /** 收到匹配的 ai_generation_completed 事件时触发 */
  onEvent: (event: AiGenerationSseEvent) => void;
  /** 是否启用 SSE 连接（默认 true）。生成中或存在 running 历史任务时应启用 */
  enabled?: boolean;
}

export interface UseAiGenerationSseResult {
  /** 主动关闭 SSE 连接（通常不需要手动调用，组件卸载会自动关闭） */
  close: () => void;
}

/**
 * 订阅 AI 生成完成的 SSE 事件
 *
 * 使用 @microsoft/fetch-event-source 而非原生 EventSource，原因：
 *   1. 支持自定义 Header（Authorization: Bearer {token}）
 *   2. 支持可配置的重连策略
 *   3. POST/GET 均可（这里用 GET 与后端 @Sse() 一致）
 */
export function useAiGenerationSse(
  options: UseAiGenerationSseOptions,
): UseAiGenerationSseResult {
  const { onEvent, enabled = true } = options;

  // ref 持有最新回调，避免重连时闭包过期
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // 主动关闭标志，用于区分「主动关闭」与「连接异常断开」
  const intentionalCloseRef = useRef(false);
  // 当前 fetchEventSource 的 AbortController
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;

    intentionalCloseRef.current = false;

    // 延迟一帧建立连接，避免 Strict Mode 双挂载时 cleanup abort 产生 ERR_ABORTED
    // 如果组件在延迟期间卸载，AbortController 被 abort() 时尚未发起网络请求，不会记录 ERR_ABORTED
    const abort = new AbortController();
    abortRef.current = abort;

    const timer = setTimeout(() => {
      const token = getAccessToken() || '';
      const url = `${getApiBaseUrl()}/ai-events`;

      fetchEventSource(url, {
        method: 'GET',
        headers: token
          ? { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }
          : { Accept: 'text/event-stream' },
        signal: abort.signal,
        async onopen(response) {
          if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
            return;
          }
          if (response.status === 401) {
            intentionalCloseRef.current = true;
            // 清除内存态与 refreshToken；并兼容清理旧版 localStorage 遗留凭据
            sessionStorage.removeItem('admin-refresh-token');
            localStorage.removeItem('admin-token');
            localStorage.removeItem('admin-user');
            setTimeout(() => {
              window.location.href = '/admin/login';
            }, 300);
            throw new Error('SSE auth failed');
          }
          throw new Error(`SSE 连接异常: ${response.status}`);
        },
        onmessage(ev: EventSourceMessage) {
          if (!ev.data) return;
          let payload: any;
          try {
            payload = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (
            payload?.type !== 'ai_generation_completed' &&
            payload?.type !== 'ai_generation_submitted'
          )
            return;
          const meta = (payload.meta ?? {}) as Record<string, any>;
          const event: AiGenerationSseEvent = {
            generationId: meta.generationId ?? payload.resourceId ?? '',
            status: meta.status ?? (payload.type === 'ai_generation_submitted' ? 'submitted' : 'success'),
            url: meta.url,
            errorMessage: meta.errorMessage,
            stage: meta.stage,
            timestamp: payload.timestamp ?? Date.now(),
          };
          if (!event.generationId) return;
          onEventRef.current(event);
        },
        onclose() {
          if (intentionalCloseRef.current) {
            throw new Error('SSE 主动关闭');
          }
        },
        onerror(err) {
          if (intentionalCloseRef.current) throw err;
        },
      }).catch(() => {
        // fetchEventSource 重试耗尽或主动关闭时进入此处，静默处理
      });
    }, 0);

    return () => {
      intentionalCloseRef.current = true;
      clearTimeout(timer);
      // 如果 timer 还未触发，abort() 不会产生 ERR_ABORTED（尚未发起网络请求）
      // 如果 timer 已触发，abort() 中断已建立的 SSE 连接（浏览器记录 ERR_ABORTED，仅在开发环境发生）
      abort.abort();
      abortRef.current = null;
    };
  }, [enabled]);

  const close = () => {
    intentionalCloseRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
  };

  return { close };
}
