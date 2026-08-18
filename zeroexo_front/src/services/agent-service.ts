/**
 * agent-service - Agent 执行服务
 *
 * 通过 SSE 流式调用后端 POST /api/artifacts/:id/agents/execute 接口。
 * 基于通用 createSseStream 实现。
 * 支持 AbortController 取消正在执行的请求。
 */

import { getApiBaseUrl, getToken } from './api-client.js';
import { createSseStream } from './ai-think-service.js';
import { translateApiError } from '@/shared/utils/api-error.js';

/** Agent 类型 */
export type AgentType =
  | 'script_writer'
  | 'researcher'
  | 'entity_extractor'
  | 'storyboard_breaker'
  | 'grid_strategy'
  | 'cinematographer'
  | 'video_prompt_engineer'
  | 'asset_manager'
  | 'reviewer'
  | 'version_diff'
  | 'format'
  | 'script_format'
  | 'analyze'
  | 'continue'
  | 'expand'
  | 'rewrite'
  | 'storyboard';

/** Agent SSE 事件（匹配后端 AgentEvent 接口） */
export interface AgentEvent {
  type: 'agent:step' | 'agent:tool_call' | 'agent:tool_result' | 'agent:progress' | 'agent:complete' | 'agent:error';
  data: unknown;
  timestamp: number;
}

/** 简化的前端 Agent 事件（向后兼容） */
export interface SimpleAgentEvent {
  type: 'thinking' | 'partial' | 'complete' | 'error';
  data: string;
  metadata?: Record<string, unknown>;
}

/** Agent 状态 */
export type AgentStatus = 'idle' | 'running' | 'done' | 'error';

/** Agent 调度器 — 通过 SSE 流式调用后端 */
export class AgentOrchestrator {
  private abortController: AbortController | null = null;

  /**
   * 执行 Agent 调用
   * @param artifactId 项目 ID
   * @param agentType  Agent 类型
   * @param input      输入内容
   * @param onEvent    可选的回调，用于处理 SSE 事件
   * @returns Agent 执行完成的最终输出
   */
  async execute(
    artifactId: string,
    agentType: string,
    input: string,
    onEvent?: (event: AgentEvent | SimpleAgentEvent) => void,
  ): Promise<string> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    let result = '';

    await createSseStream({
      url: `/api/artifacts/${artifactId}/agents/execute`,
      method: 'POST',
      body: { agentType, input },
      signal,
      headers: { 'Content-Type': 'application/json' },
      handlers: {
        'agent:step': (payload) => {
          onEvent?.(payload as unknown as AgentEvent);
        },
        'agent:tool_call': (payload) => {
          onEvent?.(payload as unknown as AgentEvent);
        },
        'agent:tool_result': (payload) => {
          onEvent?.(payload as unknown as AgentEvent);
        },
        'agent:progress': (payload) => {
          onEvent?.(payload as unknown as AgentEvent);
        },
        'agent:complete': (payload) => {
          const eventData = payload.data as { output?: string } | null;
          result = eventData?.output ?? '';
          onEvent?.(payload as unknown as AgentEvent);
        },
        'agent:error': (payload) => {
          const eventData = payload.data as { error?: string; code?: string } | null;
          onEvent?.(payload as unknown as AgentEvent);
          const msg = eventData?.code
            ? translateApiError({ code: eventData.code, message: eventData.error ?? '' })
            : (eventData?.error ?? 'Agent execution error');
          throw new Error(msg);
        },
        // 兼容旧格式
        'thinking': (payload) => {
          onEvent?.({ type: 'thinking', data: payload.data as string });
        },
        'partial': (payload) => {
          onEvent?.({ type: 'partial', data: payload.data as string });
        },
        'complete': (payload) => {
          result = payload.data as string;
          onEvent?.({ type: 'complete', data: payload.data as string });
        },
        'error': (payload) => {
          const raw = payload.data;
          const data = (raw && typeof raw === 'object'
            ? raw
            : { error: String(raw ?? '') }) as { error?: string; code?: string };
          onEvent?.({ type: 'error', data: data.error ?? '' });
          const msg = data.code
            ? translateApiError({ code: data.code, message: data.error ?? '' })
            : (data.error ?? 'Agent execution error');
          throw new Error(msg);
        },
      },
      onError: (err) => {
        throw err;
      },
    });

    return result;
  }

  /** 取消当前正在执行的 Agent */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * 执行编排流水线（多个 Agent 按步骤执行）
   * 使用原生 fetch 直接调用（保持与 execute 一致的 SSE 解析模式）
   */
  async orchestrate(
    artifactId: string,
    steps: Array<{ agentType: string; input?: string }>,
    onEvent?: (event: AgentEvent | SimpleAgentEvent) => void,
  ): Promise<string> {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const apiBase = getApiBaseUrl();
    const response = await fetch(
      `${apiBase}/api/artifacts/${artifactId}/agents/orchestrate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ steps }),
        signal,
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = `Orchestrate failed: HTTP ${response.status}`;
      try {
        const json = JSON.parse(text);
        message = json.message ?? message;
      } catch {
        message = text.slice(0, 200) || message;
      }
      throw new Error(message);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let result = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as AgentEvent;
              onEvent?.(event);
              if (event.type === 'agent:complete') {
                const eventData = event.data as { output?: string } | null;
                result = eventData?.output ?? '';
              } else if (event.type === 'agent:error') {
                const eventData = event.data as { error?: string } | null;
                throw new Error(eventData?.error ?? 'Orchestrate error');
              }
            } catch (parseErr) {
              if (parseErr instanceof Error &&
                  parseErr.message !== 'Unexpected end of JSON input' &&
                  !parseErr.message.startsWith('Orchestrate error')) {
              }
              if (parseErr instanceof Error && parseErr.message.startsWith('Orchestrate error')) {
                throw parseErr;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return result;
  }
}
