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
  | 'agent:progress';

export interface AgentSSEEvent {
  type: AgentSSEEventType;
  taskId: string;
  data: unknown;
  timestamp: number;
}

export interface AgentClientCallbacks {
  onThinking?: (message: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onResult?: (result: unknown) => void;
  onCanvasOp?: (op: string, args: unknown) => void;
  onProgress?: (progress: number, message?: string) => void;
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

export class AgentClient {
  private abortController: AbortController | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTaskId: string | null = null;
  private currentCallbacks: AgentClientCallbacks = {};

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

    return (await res.json()) as AgentExecuteResponse;
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
   * 订阅指定 taskId 的 SSE 事件流
   * 自动处理重连（最多 MAX_RECONNECT_ATTEMPTS 次）
   */
  subscribe(taskId: string, callbacks: AgentClientCallbacks): void {
    this.unsubscribe();
    this.currentTaskId = taskId;
    this.currentCallbacks = callbacks;
    this.reconnectAttempts = 0;
    void this.connectSSE(taskId, callbacks);
  }

  /**
   * 取消订阅，断开 SSE 连接
   */
  unsubscribe(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    this.currentTaskId = null;
    this.currentCallbacks = {};
    this.reconnectAttempts = 0;
  }

  /**
   * 获取当前订阅的 taskId
   */
  get currentTask(): string | null {
    return this.currentTaskId;
  }

  /**
   * 是否已连接
   */
  get connected(): boolean {
    return this.abortController !== null;
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
      case 'agent:error': {
        const err = (event.data as { error?: string } | null)?.error ?? '未知错误';
        callbacks.onError?.(err);
        break;
      }
      case 'agent:done': {
        const d = event.data as { output?: unknown } | null;
        callbacks.onDone?.(d?.output);
        this.abortController?.abort();
        this.abortController = null;
        callbacks.onClose?.();
        break;
      }
      default:
        break;
    }
  }

  private async connectSSE(taskId: string, callbacks: AgentClientCallbacks): Promise<void> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

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

      // 流正常结束(未收到 done 事件)时视为完成
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    } catch (err) {
      if (this.abortController !== abortController) return;
      this.abortController = null;
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户主动取消,不报错
        return;
      }

      // 自动重连
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && this.currentTaskId) {
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
          if (this.currentTaskId) {
            void this.connectSSE(this.currentTaskId, this.currentCallbacks);
          }
        }, RECONNECT_DELAY_MS * this.reconnectAttempts);
      } else {
        callbacks.onError?.('SSE 连接已断开');
        callbacks.onClose?.();
      }
    }
  }
}

/** 单例实例 */
export const agentClient = new AgentClient();
