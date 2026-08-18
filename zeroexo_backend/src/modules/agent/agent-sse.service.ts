/**
 * agent-sse.service - Agent SSE 连接管理服务
 *
 * 为每个 taskId 管理一个独立的 SSE 连接（RxJS Subject）。
 * 支持事件类型: agent:thinking / agent:tool_call / agent:result / agent:canvas_op / agent:error / agent:done
 * 前端通过 EventSource 连接 /api/agents/stream/:taskId 消费事件流。
 */

import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

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

@Injectable()
export class AgentSSEService {
  private readonly logger = new Logger(AgentSSEService.name);
  /** taskId -> Subject 映射 */
  private connections = new Map<string, Subject<AgentSSEEvent>>();

  /**
   * 为指定 taskId 创建 SSE 订阅
   * 返回 Observable，前端可通过 EventSource 消费
   */
  subscribe(taskId: string): Observable<AgentSSEEvent> {
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new Subject<AgentSSEEvent>());
    }

    const subject = this.connections.get(taskId)!;

    return subject.asObservable();
  }

  /**
   * 向指定 taskId 推送事件
   */
  emit(taskId: string, event: Omit<AgentSSEEvent, 'taskId' | 'timestamp'>): void {
    const subject = this.connections.get(taskId);
    if (!subject) {
      this.logger.warn(`SSE 连接不存在: taskId=${taskId}`);
      return;
    }

    const fullEvent: AgentSSEEvent = {
      ...event,
      taskId,
      timestamp: Date.now(),
    };

    subject.next(fullEvent);
  }

  /**
   * 便捷方法：推送 thinking 事件
   */
  emitThinking(taskId: string, message: string): void {
    this.emit(taskId, { type: 'agent:thinking', data: { message } });
  }

  /**
   * 便捷方法：推送 tool_call 事件
   */
  emitToolCall(taskId: string, toolName: string, args: unknown): void {
    this.emit(taskId, { type: 'agent:tool_call', data: { toolName, arguments: args } });
  }

  /**
   * 便捷方法：推送 result 事件
   */
  emitResult(taskId: string, result: unknown): void {
    this.emit(taskId, { type: 'agent:result', data: result });
  }

  /**
   * 便捷方法：推送 canvas_op 事件
   */
  emitCanvasOp(taskId: string, op: string, args: unknown): void {
    this.emit(taskId, { type: 'agent:canvas_op', data: { op, args } });
  }

  /**
   * 便捷方法：推送 error 事件
   */
  emitError(taskId: string, error: string): void {
    this.emit(taskId, { type: 'agent:error', data: { error } });
  }

  /**
   * 便捷方法：推送 done 事件
   */
  emitDone(taskId: string, output: unknown): void {
    this.emit(taskId, { type: 'agent:done', data: { output } });
  }

  /**
   * 便捷方法：推送 progress 事件
   */
  emitProgress(taskId: string, progress: number, message?: string): void {
    this.emit(taskId, { type: 'agent:progress', data: { progress, message } });
  }

  /**
   * 关闭指定 taskId 的 SSE 连接
   */
  close(taskId: string): void {
    const subject = this.connections.get(taskId);
    if (subject) {
      subject.complete();
      this.connections.delete(taskId);
      this.logger.debug(`SSE 连接已关闭: taskId=${taskId}`);
    }
  }

  /**
   * 检查 taskId 是否有活跃连接
   */
  hasConnection(taskId: string): boolean {
    return this.connections.has(taskId);
  }

  /**
   * 获取所有活跃连接数
   */
  get connectionCount(): number {
    return this.connections.size;
  }
}