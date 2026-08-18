/**
 * canvas-op-executor.service - Canvas 操作执行器
 *
 * 接收 CanvasOp 操作指令，验证操作合法性，执行操作并返回结果。
 * 错误时通过 SSE 推送 canvas:op_failed 事件。
 */

import { Injectable, Logger } from '@nestjs/common';
import { AgentSSEService } from './agent-sse.service';

export interface CanvasOp {
  op: 'add_node' | 'add_edge' | 'update_node' | 'remove_node' | 'set_selection' | 'focus' | 'update_data';
  args: Record<string, unknown>;
}

export interface CanvasOpResult {
  success: boolean;
  op: string;
  data?: unknown;
  error?: string;
}

@Injectable()
export class CanvasOpExecutorService {
  private readonly logger = new Logger(CanvasOpExecutorService.name);

  private readonly validOps = new Set([
    'add_node',
    'add_edge',
    'update_node',
    'remove_node',
    'set_selection',
    'focus',
    'update_data',
  ]);

  constructor(
    private readonly sseService: AgentSSEService,
  ) {}

  /**
   * 执行单个 CanvasOp 操作
   * 验证 -> 执行 -> 返回结果
   */
  async execute(
    taskId: string,
    op: CanvasOp,
    projectId?: string,
  ): Promise<CanvasOpResult> {
    // 1. 验证操作合法性
    const validation = this.validateOp(op);
    if (!validation.valid) {
      const error = `操作校验失败: ${validation.reason}`;
      this.sseService.emitError(taskId, error);
      return { success: false, op: op.op, error };
    }

    try {
      // 2. 执行操作
      const result = await this.executeOp(op, projectId);

      // 3. 推送 canvas_op 事件
      this.sseService.emitCanvasOp(taskId, op.op, op.args);

      return { success: true, op: op.op, data: result };
    } catch (err) {
      const error = `CanvasOp 执行失败: ${(err as Error).message}`;
      this.logger.error(`CanvasOp 执行错误: taskId=${taskId}, op=${op.op}`, (err as Error).stack);
      this.sseService.emitError(taskId, error);
      return { success: false, op: op.op, error };
    }
  }

  /**
   * 批量执行 CanvasOp 操作
   */
  async executeBatch(
    taskId: string,
    ops: CanvasOp[],
    projectId?: string,
  ): Promise<CanvasOpResult[]> {
    const results: CanvasOpResult[] = [];

    for (const op of ops) {
      const result = await this.execute(taskId, op, projectId);
      results.push(result);
    }

    return results;
  }

  /**
   * 验证操作合法性
   */
  private validateOp(op: CanvasOp): { valid: boolean; reason?: string } {
    if (!op || !op.op) {
      return { valid: false, reason: '缺少 op 字段' };
    }

    if (!this.validOps.has(op.op)) {
      return {
        valid: false,
        reason: `不支持的 op 类型: ${op.op}，合法值: ${Array.from(this.validOps).join(', ')}`,
      };
    }

    // 按 op 类型校验必填参数
    switch (op.op) {
      case 'add_node':
        if (!op.args?.id) return { valid: false, reason: 'add_node 缺少必填参数 id' };
        if (!op.args?.type) return { valid: false, reason: 'add_node 缺少必填参数 type' };
        break;
      case 'add_edge':
        if (!op.args?.source) return { valid: false, reason: 'add_edge 缺少必填参数 source' };
        if (!op.args?.target) return { valid: false, reason: 'add_edge 缺少必填参数 target' };
        break;
      case 'update_node':
        if (!op.args?.id) return { valid: false, reason: 'update_node 缺少必填参数 id' };
        if (!op.args?.patch) return { valid: false, reason: 'update_node 缺少必填参数 patch' };
        break;
      case 'remove_node':
        if (!op.args?.id) return { valid: false, reason: 'remove_node 缺少必填参数 id' };
        break;
      case 'set_selection':
        if (!op.args?.nodeIds) return { valid: false, reason: 'set_selection 缺少必填参数 nodeIds' };
        break;
      case 'focus':
        if (!op.args?.id) return { valid: false, reason: 'focus 缺少必填参数 id' };
        break;
    }

    return { valid: true };
  }

  /**
   * 执行具体操作
   * 目前记录操作日志，后续可对接 @zeroexo/core 命令系统
   */
  private async executeOp(
    op: CanvasOp,
    projectId?: string,
  ): Promise<unknown> {
    // 记录操作日志
    this.logger.debug(`执行 CanvasOp: ${op.op}, projectId=${projectId}`);

    // 对于需要持久化的操作，记录到 project 的 storyboard 或后续对接画布命令系统
    // 目前仅做合法性校验和日志记录，实际画布操作由前端响应 canvas_op 事件执行
    return {
      executed: true,
      op: op.op,
      args: op.args,
      note: 'CanvasOp 已记录，由前端 EventSource 消费后执行',
    };
  }
}