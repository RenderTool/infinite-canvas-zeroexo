/**
 * agent-sse.service - Agent SSE 连接管理服务
 *
 * 为每个 taskId 管理一个独立的 SSE 连接（RxJS Subject）。
 * 支持事件类型: agent:thinking / agent:tool_call / agent:result / agent:canvas_op / agent:error / agent:done
 * 契约交互事件(Plan#33 D1): agent:step_request / agent:question_request / agent:md
 * 前端通过 EventSource 连接 /api/agents/stream/:taskId 消费事件流。
 */

import { Injectable, Logger } from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import {
  StepRequestData,
  QuestionRequestData,
  AgentPhase,
  PlanData,
  UploadRequestData,
  BriefData,
} from './dto/agent.dto';

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
  | 'agent:md'
  // Plan#36 P0-1: 增量渲染事件
  | 'agent:message_delta'
  | 'agent:thinking_delta'
  // Plan#36 R2-5: 执行流程引擎事件（Codex 式 phase）
  | 'agent:phase'
  | 'agent:plan'
  | 'agent:upload_request'
  | 'agent:brief';

export interface AgentSSEEvent {
  type: AgentSSEEventType;
  taskId: string;
  data: unknown;
  timestamp: number;
}

@Injectable()
export class AgentSSEService {
  private readonly logger = new Logger(AgentSSEService.name);
  /**
   * taskId -> ReplaySubject 映射(Plan#20 P0 修复: Subject→ReplaySubject)
   * 旧实现用热 Subject: 前端订阅前 emit 的事件(含快速失败/完成)永久丢失 → 前端永远等待。
   * ReplaySubject(500) 缓冲早于订阅的事件,订阅时回放;防内存膨胀上限 500 条。
   */
  private connections = new Map<string, ReplaySubject<AgentSSEEvent>>();

  /**
   * 为指定 taskId 创建 SSE 订阅
   * 返回 Observable，前端可通过 EventSource 消费;订阅前已 emit 的事件会被回放
   */
  subscribe(taskId: string): Observable<AgentSSEEvent> {
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new ReplaySubject<AgentSSEEvent>(500));
    }

    const subject = this.connections.get(taskId)!;

    return subject.asObservable();
  }

  /**
   * 向指定 taskId 推送事件(连接未建立时先缓冲,订阅后回放——不再丢失)
   */
  emit(taskId: string, event: Omit<AgentSSEEvent, 'taskId' | 'timestamp'>): void {
    let subject = this.connections.get(taskId);
    if (!subject) {
      subject = new ReplaySubject<AgentSSEEvent>(500);
      this.connections.set(taskId, subject);
      this.logger.debug(`SSE 连接未建立,事件已缓冲待回放: taskId=${taskId}, type=${event.type}`);
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
   * toolCallId 必须透传：前端据此把 tool_result 关联到对应步骤胶囊（缺失会导致 Result 永不渲染）
   */
  emitToolCall(taskId: string, toolName: string, args: unknown, toolCallId?: string): void {
    this.emit(taskId, {
      type: 'agent:tool_call',
      data: { toolName, arguments: args, ...(toolCallId ? { toolCallId } : {}) },
    });
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
   * 便捷方法：推送 step_request 事件（StepBlock 契约 UI，Plan#33 D1）
   */
  emitStepRequest(taskId: string, step: StepRequestData): void {
    this.emit(taskId, { type: 'agent:step_request', data: { step } });
  }

  /**
   * 便捷方法：推送 question_request 事件（QuestionBlock 契约 UI，Plan#33 D1）
   */
  emitQuestionRequest(taskId: string, question: QuestionRequestData): void {
    this.emit(taskId, { type: 'agent:question_request', data: { question } });
  }

  /**
   * 便捷方法：推送 md 事件（MarkdownBlock 契约 UI，Plan#33 D1）
   */
  emitMd(taskId: string, md: string): void {
    this.emit(taskId, { type: 'agent:md', data: { md } });
  }

  /**
   * 便捷方法：推送 message_delta 事件（正文增量，Plan#36 P0-1 流式渲染）
   */
  emitMessageDelta(taskId: string, delta: string): void {
    this.emit(taskId, { type: 'agent:message_delta', data: { delta } });
  }

  /**
   * 便捷方法：推送 thinking_delta 事件（思考增量，Plan#36 P0-1 流式渲染）
   */
  emitThinkingDelta(taskId: string, delta: string): void {
    this.emit(taskId, { type: 'agent:thinking_delta', data: { delta } });
  }

  /**
   * 便捷方法：推送 phase 事件（执行阶段转换，Plan#36 R2-5）
   */
  emitPhase(taskId: string, phase: AgentPhase, label?: string): void {
    this.emit(taskId, { type: 'agent:phase', data: { phase, label } });
  }

  /**
   * 便捷方法：推送 plan 事件（结构化执行计划，PlanBlock 消费）
   */
  emitPlan(taskId: string, plan: PlanData): void {
    this.emit(taskId, { type: 'agent:plan', data: { plan } });
  }

  /**
   * 便捷方法：推送 upload_request 事件（对话内上传卡，UploadBlock 消费）
   */
  emitUploadRequest(taskId: string, upload: UploadRequestData): void {
    this.emit(taskId, { type: 'agent:upload_request', data: { upload } });
  }

  /**
   * 便捷方法：推送 brief 事件（任务简报，BriefBlock 消费）
   */
  emitBrief(taskId: string, brief: BriefData): void {
    this.emit(taskId, { type: 'agent:brief', data: { brief } });
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