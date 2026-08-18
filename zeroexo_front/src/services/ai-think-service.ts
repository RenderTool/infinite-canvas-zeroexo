/**
 * ai-think-service - AI 深度思考服务层
 *
 * 提供两种模式：
 * 1. 异步轮询模式：createAiThinkService() → POST /api/ai/think + 轮询 GET /api/ai/think/:taskId
 * 2. 流式 SSE 模式：createAiThinkStreamService() → POST /api/ai/think/stream（打字机效果）
 *
 * 流式模式用于首次触发（实时展示），轮询模式用于历史记录恢复和持久化保存。
 */

import { apiFetch, apiGet, getToken } from './api-client.js';
import i18n from '@/i18n/config';
import { translateApiError } from '@/shared/utils/api-error.js';

// ===== 类型 =====

export interface ThinkingSuggestion {
  label: string;
  value: string;
}

export interface ThinkingStep {
  text: string;
  suggestions?: ThinkingSuggestion[];
}

/** Think 请求参数 */
export interface ThinkRequest {
  providerId: string;
  model: string;
  kind: 'inspire' | 'genre' | 'script_import';
  projectId?: string;
  locale?: string;
  projectData: {
    name?: string;
    genre?: string;
    resolution?: string;
    aspectRatio?: string;
    duration?: string;
    /** 剧本内容（用于 script_import 模式） */
    content?: string;
    /** 分集模式 */
    episodeMode?: 'auto' | 'manual' | 'none';
    /** 集数 */
    episodeCount?: number;
    /** 立项上下文（用于 script_import 模式时参考 setup） */
    setupContext?: unknown;
  };
}

/** Think 回调 */
export interface ThinkCallbacks {
  /** 增量步骤（每出现一个新步骤调用一次） */
  onStep: (step: ThinkingStep) => void;
  /** 全部完成 */
  onDone: () => void;
  /** 出错 */
  onError: (error: Error) => void;
  /** 任务创建成功后回调 taskId（用于持久化断点，供刷新后恢复） */
  onTaskId?: (taskId: string) => void;
  /** 分批拆分进度回调（长剧本分批处理时每完成一块调用一次；无分批时传 null） */
  onChunkProgress?: (progress: { done: number; total: number } | null) => void;
}

/** 轮询服务可选配置 */
export interface ThinkServiceOptions {
  /** 轮询超时（毫秒），超时后自动停止并报错。长剧本分批拆分耗时长，需传大值。默认 120s */
  timeoutMs?: number;
  /** 轮询间隔（毫秒），默认 500 */
  pollInterval?: number;
}

/** 任务状态响应 */
interface ThinkTaskStatus {
  id: string;
  status: string;
  steps: ThinkingStep[];
  thinkKind: string | null;
  /** 分批拆分进度（断点恢复用）：{ done, total } */
  chunkProgress: { done: number; total: number } | null;
  errorMessage: string | null;
  /** 后端错误码（失败时存在，用于按用户语言翻译） */
  errorCode: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 组装思考错误：有错误码则按码翻译，否则回退英文 message 或默认文案 */
function buildThinkError(code: string | null | undefined, message: string | null | undefined): Error {
  if (code) {
    return new Error(translateApiError({ code, message: message ?? '' }));
  }
  return new Error(message || i18n.t('errors.THINK_TASK_FAILED'));
}

// ===== Service =====

export interface AiThinkService {
  start(req: ThinkRequest, callbacks: ThinkCallbacks): Promise<void>;
  cancel(): void;
  /** 异步取消：await 确保后端处理完毕再返回 */
  cancelAsync(): Promise<void>;
  resume(taskId: string, callbacks: ThinkCallbacks): Promise<void>;
}

/** 轮询间隔（毫秒） */
const DEFAULT_POLL_INTERVAL = 500;
/** 默认轮询超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 120_000;

export function createAiThinkService(options?: ThinkServiceOptions): AiThinkService {
  let taskId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;
  const pollInterval = options?.pollInterval ?? DEFAULT_POLL_INTERVAL;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const start = async (req: ThinkRequest, callbacks: ThinkCallbacks): Promise<void> => {
    cancelled = false;

    try {
      // 1. 创建异步任务
      const { taskId: id } = await apiFetch<{ taskId: string }>('/ai/think', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      taskId = id;
      callbacks.onTaskId?.(id);

      // 2. 开始轮询
      let lastStepsCount = 0;
      let done = false;

      await new Promise<void>((resolve) => {
        pollTimer = setInterval(async () => {
          if (cancelled) {
            clearInterval(pollTimer!);
            pollTimer = null;
            resolve();
            return;
          }
          if (!taskId) return;

          try {
            const result = await apiGet<ThinkTaskStatus>(`/ai/think/${taskId}`);
            const steps = result.steps ?? [];

            // 分批拆分进度（长剧本）
            callbacks.onChunkProgress?.(result.chunkProgress ?? null);

            // 增量推送新步骤
            for (let i = lastStepsCount; i < steps.length; i++) {
              if (cancelled) break;
              callbacks.onStep(steps[i]!);
            }
            lastStepsCount = steps.length;

            if (result.status === 'success') {
              clearInterval(pollTimer!);
              pollTimer = null;
              done = true;
              if (!cancelled) callbacks.onDone();
              resolve();
            } else if (result.status === 'failed') {
              clearInterval(pollTimer!);
              pollTimer = null;
              done = true;
              if (!cancelled) {
                callbacks.onError(buildThinkError(result.errorCode, result.errorMessage));
              }
              resolve();
            }
            // 'pending' / 'running' → 继续轮询
          } catch (err) {
            // 网络抖动时忽略，继续轮询
          }
        }, pollInterval);

        // 超时保护
        setTimeout(() => {
          if (!done && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
            if (!cancelled) {
              callbacks.onError(new Error(i18n.t('errors.THINK_TIMEOUT')));
            }
            resolve();
          }
        }, timeoutMs);
      });
    } catch (err) {
      if (!cancelled) {
        callbacks.onError(new Error(`${i18n.t('errors.AI_CALL_FAILED')}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  };

  const cancel = (): void => {
    cancelled = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // 通知后端取消任务，防止刷新后仍显示"思考中"
    const currentTaskId = taskId;
    if (currentTaskId) {
      apiFetch<{ message: string }>(`/ai/think/${currentTaskId}/cancel`, { method: 'POST' }).catch((err) => {
        console.error('[ai-think] 取消任务失败:', err);
      });
    }
    taskId = null;
  };

  /** 异步取消，await 确保后端已处理完毕 */
  const cancelAsync = async (): Promise<void> => {
    cancelled = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    const currentTaskId = taskId;
    taskId = null;
    if (currentTaskId) {
      try {
        await apiFetch<{ message: string }>(`/ai/think/${currentTaskId}/cancel`, { method: 'POST' });
      } catch (err) {
        console.error('[ai-think] 取消任务失败:', err);
      }
    }
  };

  const resume = async (existingTaskId: string, callbacks: ThinkCallbacks): Promise<void> => {
    cancelled = false;
    taskId = existingTaskId;
    let lastStepsCount = 0;
    let done = false;

    await new Promise<void>((resolve) => {
      pollTimer = setInterval(async () => {
        if (cancelled) {
          clearInterval(pollTimer!);
          pollTimer = null;
          resolve();
          return;
        }
        if (!taskId) return;

        try {
          const result = await apiGet<ThinkTaskStatus>(`/ai/think/${taskId}`);
          const steps = result.steps ?? [];

          // 分批拆分进度（长剧本）
          callbacks.onChunkProgress?.(result.chunkProgress ?? null);

          for (let i = lastStepsCount; i < steps.length; i++) {
            if (cancelled) break;
            callbacks.onStep(steps[i]!);
          }
          lastStepsCount = steps.length;

          if (result.status === 'success') {
            clearInterval(pollTimer!);
            pollTimer = null;
            done = true;
            if (!cancelled) callbacks.onDone();
            resolve();
          } else if (result.status === 'failed') {
            clearInterval(pollTimer!);
            pollTimer = null;
            done = true;
            if (!cancelled) {
              callbacks.onError(buildThinkError(result.errorCode, result.errorMessage));
            }
            resolve();
          }
        } catch {
          // 网络抖动忽略
        }
      }, pollInterval);

      setTimeout(() => {
        if (!done && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
          if (!cancelled) {
            callbacks.onError(new Error(i18n.t('errors.THINK_TIMEOUT')));
          }
          resolve();
        }
      }, timeoutMs);
    });
  };

  return { start, cancel, cancelAsync, resume };
}

/**
 * 查找项目中活跃的思考任务（用于页面恢复）
 */
export async function findActiveThinkTask(
  projectId: string,
  thinkKind: 'inspire' | 'genre',
): Promise<{ id: string; status: string; steps: ThinkingStep[] } | null> {
  try {
    return await apiGet<{ id: string; status: string; steps: ThinkingStep[] } | null>(
      `/ai/think/active/${projectId}/${thinkKind}`,
    );
  } catch {
    return null;
  }
}

/**
 * 通过 taskId 直接获取任务状态（用于恢复轮询）
 */
export async function getThinkTaskById(taskId: string): Promise<ThinkTaskStatus | null> {
  try {
    return await apiGet<ThinkTaskStatus>(`/ai/think/${taskId}`);
  } catch {
    return null;
  }
}

/**
 * 页面恢复前批量取消所有活跃思考任务（防止残留任务被恢复）
 */
export async function cancelAllActiveThinkTasks(
  projectId: string,
  thinkKind: string,
): Promise<void> {
  try {
    await apiFetch('/ai/think/cancel-all-active', {
      method: 'POST',
      body: JSON.stringify({ projectId, thinkKind }),
    });
  } catch {
    // 忽略错误，取消操作本身是幂等的
  }
}

// ===== 通用 SSE 流式请求工具 =====

/** SSE 事件处理函数映射 */
export interface SseEventHandlers {
  [eventType: string]: (payload: Record<string, unknown>) => void;
}

/** SSE 流式请求配置 */
export interface SseStreamOptions {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  handlers: SseEventHandlers;
  onDone?: () => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

/**
 * 通用 SSE 流式请求函数
 *
 * 统一处理：
 * - NestJS @Sse 包装解包 ({ data: {...} } → {...})
 * - data: {json}\n\n 格式分割
 * - AbortController 取消
 * - 残留数据处理
 *
 * 所有需要 SSE 流式 POST 的前端服务都应使用此函数。
 */
export async function createSseStream(options: SseStreamOptions): Promise<void> {
  const {
    url,
    method = 'POST',
    body,
    headers = {},
    handlers,
    onDone,
    onError,
    signal,
  } = options;

  const token = getToken();
  const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || '';
  const fullUrl = url.startsWith('http') ? url : `${apiBase}${url.startsWith('/') ? url : `/${url}`}`;

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (token) {
    fetchHeaders['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(fullUrl, {
      method,
      headers: fetchHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`请求失败 (${response.status}): ${errText.slice(0, 200)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取流式响应');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 格式：每个事件由 "\n\n" 分隔，"data: {json}\n"
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const chunk of chunks) {
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            // NestJS @Sse 将 subscriber.next({ data }) 的 data 直接序列化为 SSE 数据行。
            // 当事件本身有 type 字段（如 AgentEvent: { type, data, timestamp }）时，直接使用 event；
            // 当事件由 { data: { type, ... } } 包装时（旧格式兼容），提取内层 event.data。
            // 判断依据：顶层有 type 字段说明是直接事件（AgentEvent），否则尝试解包。
            const payload = (event.type !== undefined ? event : event.data ?? event) as Record<string, unknown>;
            const type = payload.type as string;
            if (type && handlers[type]) {
              handlers[type](payload);
            }
            // 兼容旧格式：type='done' 视为流结束
            if (type === 'done' && onDone) {
              onDone();
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }
    }

    // 处理残留数据
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        try {
          const event = JSON.parse(jsonStr);
          const payload = (event.type !== undefined ? event : event.data ?? event) as Record<string, unknown>;
          const type = payload.type as string;
          if (type === 'done' && onDone) {
            onDone();
          } else if (type && handlers[type]) {
            handlers[type](payload);
          }
        } catch {
          // 忽略
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // 用户主动取消，不报错
      return;
    }
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

// ===== 流式 SSE 服务（基于通用工具） =====

/** 流式思考回调 */
export interface ThinkStreamCallbacks {
  /** 当前步骤文本增量更新（打字机效果 — 同一步骤内逐字追加） */
  onStepDelta: (stepIndex: number, text: string) => void;
  /** 一个步骤完整输出（包含建议标签） */
  onStepComplete: (step: ThinkingStep) => void;
  /** 全部思考完成 */
  onDone: () => void;
  /** 发生错误 */
  onError: (error: Error) => void;
}

export interface AiThinkStreamService {
  start(req: ThinkRequest, callbacks: ThinkStreamCallbacks): Promise<void>;
  cancel(): void;
}

/**
 * 创建流式 AI 思考服务（SSE 打字机模式）
 *
 * 基于通用 createSseStream 实现。
 * 用法：
 *   const service = createAiThinkStreamService();
 *   await service.start(req, {
 *     onStepDelta: (idx, text) => { ... },
 *     onStepComplete: (step) => { ... },
 *     onDone: () => { ... },
 *     onError: (err) => { ... },
 *   });
 */
export function createAiThinkStreamService(): AiThinkStreamService {
  let abortController: AbortController | null = null;

  const start = async (req: ThinkRequest, callbacks: ThinkStreamCallbacks): Promise<void> => {
    abortController = new AbortController();
    let errored = false;

    const wrappedOnError = (err: Error) => {
      errored = true;
      callbacks.onError(err);
    };

    await createSseStream({
      url: '/api/ai/think/stream',
      method: 'POST',
      body: req,
      signal: abortController.signal,
      handlers: {
        'step_delta': (payload) => {
          callbacks.onStepDelta(
            (payload.stepIndex as number) ?? 0,
            (payload.text as string) || '',
          );
        },
        'step_complete': (payload) => {
          callbacks.onStepComplete({
            text: (payload.text as string) || '',
            suggestions: (payload.suggestions as ThinkingSuggestion[]) || [],
          });
        },
        'error': (payload) => {
          const code = payload.code as string | undefined;
          const msg = code
            ? translateApiError(payload)
            : ((payload.message as string) || i18n.t('errors.AI_THINK_PROCESS_ERROR'));
          abortController?.abort();
          wrappedOnError(new Error(msg));
        },
      },
      onDone: () => {
        // 后端不发送 done 事件，此回调通常不会被调用
        // 为兼容性保留，防止未来后端添加 done 事件后重复触发
      },
      onError: (err) => wrappedOnError(err),
    });

    // 核心修复：流正常关闭（非 error/abort）时触发 onDone
    // 后端 streamThink 在 yield 完所有数据后 return，SSE 流正常关闭但不会发送 done 事件
    if (!errored && !abortController?.signal.aborted) {
      callbacks.onDone();
    }
  };

  const cancel = (): void => {
    abortController?.abort();
    abortController = null;
  };

  return { start, cancel };
}
