/**
 * AgentClient - Agent 任务客户端
 *
 * 封装 SSE 连接和消息处理，提供统一的任务提交和订阅接口。
 * send(taskType, input) → 返回 taskId
 * subscribe(taskId, callbacks) → 订阅 SSE 事件，支持自动重连
 *
 * 安全: SSE 连接使用 fetch + Authorization header 携带 JWT,
 * URL 中不拼接 token(避免 token 进入日志/浏览器历史/Referer)。
 */

import { getToken } from '@/services/api-client.js';

export type AgentSSEEventType =
  | 'agent:thinking'
  | 'agent:tool_call'
  | 'agent:result'
  | 'agent:canvas_op'
  | 'agent:error'
  | 'agent:done'
  | 'agent:progress'
  | 'agent:step_request'
  | 'agent:question_request'
  | 'agent:md';

export interface AgentSSEEvent {
  type: AgentSSEEventType;
  taskId: string;
  data: unknown;
  timestamp: number;
}

/** step 接口数据(与后端 StepRequestData 对齐, Plan#33 D1) */
export interface StepRequestData {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
  prompts?: string[];
  suggestions?: Array<{ value: string; label: string }>;
}

/** 提问接口数据(与后端 QuestionRequestData 对齐, Plan#33 D1) */
export interface QuestionRequestData {
  guideText?: string;
  multi?: boolean;
  items: Array<{
    value: string;
    label: string;
    desc?: string;
    ai?: boolean;
    checked?: boolean;
  }>;
}

export interface AgentClientCallbacks {
  onThinking?: (message: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onResult?: (result: unknown) => void;
  onCanvasOp?: (op: string, args: unknown) => void;
  onProgress?: (progress: number, message?: string) => void;
  onStepRequest?: (step: StepRequestData) => void;
  onQuestionRequest?: (question: QuestionRequestData) => void;
  onMd?: (md: string) => void;
  onError?: (error: string) => void;
  onDone?: (output: unknown) => void;
  onClose?: () => void;
}

export interface AgentExecuteResponse {
  taskId: string;
  streamUrl: string;
}

/** send() 方法的可选参数 */
export interface AgentSendOptions {
  conversationId?: string;
  projectId?: string;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 3;

/** 单路订阅状态(2026-08-20: 单例单路改为多路 Map, 支持批量选集生成时多任务并行订阅,
 *  旧实现 subscribe() 会 unsubscribe 顶掉前一任务 → 批量生成只有最后一个节点能收到产物) */
interface SubscriptionState {
  abortController: AbortController | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  callbacks: AgentClientCallbacks;
}

export class AgentClient {
  private subscriptions = new Map<string, SubscriptionState>();

  /**
   * 提交 Agent 任务
   * POST /api/agents/execute
   */
  async send(
    taskType: string,
    input: unknown,
    options?: AgentSendOptions,
  ): Promise<AgentExecuteResponse> {
    const { conversationId, projectId } = options ?? {};
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch('/api/agents/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify({ taskType, input, projectId, conversationId }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`提交任务失败 [${res.status}]: ${errText.slice(0, 200)}`);
    }

    // 全局响应拦截器统一 { data: T } 包装,此处解包(2026-08-20 P0: 未解包导致 taskId=undefined → stream/undefined 幽灵流永久等待)
    const json = (await res.json()) as { data?: AgentExecuteResponse };
    return (json?.data ?? (json as unknown as AgentExecuteResponse)) as AgentExecuteResponse;
  }

  /**
   * 取消任务
   * POST /api/agents/tasks/:id/cancel
   */
  async cancelTask(taskId: string): Promise<void> {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`/api/agents/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`取消任务失败 [${res.status}]: ${errText.slice(0, 200)}`);
    }
  }

  /**
   * 协议事件回执(Plan#33 D1)
   * POST /api/agents/tasks/:id/answer
   *
   * 将用户对 step/question 的回答(选项值/自定义文本/空串=跳过)提交到后端,
   * 恢复挂起的 Agent 执行循环。
   */
  async answer(taskId: string, answer: string): Promise<boolean> {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`/api/agents/tasks/${taskId}/answer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ answer }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`回执失败 [${res.status}]: ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: { ok?: boolean } };
    return json?.data?.ok ?? false;
  }

  /**
   * 订阅指定 taskId 的 SSE 事件流(多路: 不同 taskId 互不影响, 同 taskId 重复订阅先断开旧的)
   * 自动处理重连（最多 MAX_RECONNECT_ATTEMPTS 次）
   */
  subscribe(taskId: string, callbacks: AgentClientCallbacks): void {
    // 防御: taskId 无效(空/undefined)时直接失败,避免连上 /stream/undefined 幽灵流永久等待
    if (!taskId) {
      callbacks.onError?.('任务 ID 无效，无法连接事件流');
      callbacks.onClose?.();
      return;
    }
    this.disconnect(taskId);
    const state: SubscriptionState = {
      abortController: null,
      reconnectAttempts: 0,
      reconnectTimer: null,
      callbacks,
    };
    this.subscriptions.set(taskId, state);
    void this.connectSSE(taskId, state);
  }

  /**
   * 取消订阅。不传 taskId 断开全部(兼容旧用法); 传 taskId 仅断开该任务
   */
  unsubscribe(taskId?: string): void {
    if (taskId) {
      this.disconnect(taskId);
      return;
    }
    for (const id of [...this.subscriptions.keys()]) {
      this.disconnect(id);
    }
  }

  /** 断开单路订阅并清理状态 */
  private disconnect(taskId: string): void {
    const state = this.subscriptions.get(taskId);
    if (!state) return;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    state.abortController?.abort();
    state.abortController = null;
    this.subscriptions.delete(taskId);
  }

  /**
   * 获取当前订阅的 taskId 列表
   */
  get currentTask(): string | null {
    return [...this.subscriptions.keys()][0] ?? null;
  }

  /**
   * 是否已连接
   */
  get connected(): boolean {
    return this.subscriptions.size > 0;
  }

  /** 按事件类型分发(兼容 event: 命名事件与 JSON 内 type 字段两种格式) */
  private dispatchEvent(eventName: string, dataLine: string, callbacks: AgentClientCallbacks): void {
    let event: AgentSSEEvent;
    try {
      event = JSON.parse(dataLine) as AgentSSEEvent;
    } catch {
      return;
    }
    const type = eventName && eventName !== 'message' ? eventName : event.type;
    switch (type) {
      case 'agent:thinking': {
        const msg = (event.data as { message?: string } | null)?.message ?? '';
        callbacks.onThinking?.(msg);
        break;
      }
      case 'agent:tool_call': {
        const d = event.data as { toolName?: string; arguments?: unknown } | null;
        callbacks.onToolCall?.(d?.toolName ?? '', d?.arguments ?? {});
        break;
      }
      case 'agent:result':
        callbacks.onResult?.(event.data);
        break;
      case 'agent:canvas_op': {
        const d = event.data as { op?: string; args?: unknown } | null;
        callbacks.onCanvasOp?.(d?.op ?? '', d?.args ?? {});
        break;
      }
      case 'agent:progress': {
        const d = event.data as { progress?: number; message?: string } | null;
        callbacks.onProgress?.(d?.progress ?? 0, d?.message);
        break;
      }
      case 'agent:step_request': {
        const d = event.data as { step?: StepRequestData } | null;
        if (d?.step) callbacks.onStepRequest?.(d.step);
        break;
      }
      case 'agent:question_request': {
        const d = event.data as { question?: QuestionRequestData } | null;
        if (d?.question) callbacks.onQuestionRequest?.(d.question);
        break;
      }
      case 'agent:md': {
        const d = event.data as { md?: string } | null;
        if (d?.md) callbacks.onMd?.(d.md);
        break;
      }
      case 'agent:error': {
        const err = (event.data as { error?: string } | null)?.error ?? '未知错误';
        callbacks.onError?.(err);
        break;
      }
      case 'agent:done': {
        const d = event.data as { output?: unknown } | null;
        callbacks.onDone?.(d?.output);
        // 断开当前任务的连接并清理订阅(不误伤其他并行任务)
        const taskId = [...this.subscriptions.entries()]
          .find(([, s]) => s.callbacks === callbacks)?.[0];
        if (taskId) this.disconnect(taskId);
        callbacks.onClose?.();
        break;
      }
      default:
        break;
    }
  }

  private async connectSSE(taskId: string, state: SubscriptionState): Promise<void> {
    state.abortController?.abort();
    const abortController = new AbortController();
    state.abortController = abortController;
    const callbacks = state.callbacks;

    try {
      // token 经 Authorization header 传递(URL 不拼接 token)
      const token = getToken();
      const response = await fetch(`/api/agents/stream/${taskId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`SSE 连接失败 [${response.status}]`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取流式响应');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 格式: 每个事件由 "\n\n" 分隔, 含 event: 与 data: 行
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          let eventName = '';
          let dataLine = '';
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('event:')) {
              eventName = trimmed.slice(6).trim();
            } else if (trimmed.startsWith('data:')) {
              dataLine = trimmed.slice(5).trim();
            }
          }
          if (!dataLine) continue;
          this.dispatchEvent(eventName, dataLine, callbacks);
        }
      }

      // 流正常结束(未收到 done 事件)时清理当前任务订阅
      if (this.subscriptions.get(taskId)?.abortController === abortController) {
        this.disconnect(taskId);
      }
    } catch (err) {
      if (this.subscriptions.get(taskId)?.abortController !== abortController) return;
      state.abortController = null;
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户主动取消,不报错
        return;
      }

      // 自动重连(仅对仍活跃的订阅)
      if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && this.subscriptions.has(taskId)) {
        state.reconnectAttempts++;
        state.reconnectTimer = setTimeout(() => {
          if (this.subscriptions.has(taskId)) {
            void this.connectSSE(taskId, state);
          }
        }, RECONNECT_DELAY_MS * state.reconnectAttempts);
      } else {
        callbacks.onError?.('SSE 连接已断开');
        callbacks.onClose?.();
        this.disconnect(taskId);
      }
    }
  }
}

/** 单例实例 */
export const agentClient = new AgentClient();
