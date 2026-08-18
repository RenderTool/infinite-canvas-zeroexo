/**
 * agent-task.service - AgentTask 管理服务
 *
 * 提供 AgentTask 的 CRUD 操作,作为统一 Agent 任务的后端数据层。
 * 所有 Agent 执行任务统一通过 AgentTask 表记录和管理。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound } from '../../common/errors/app-exception.js';

export interface CreateTaskInput {
  userId: string;
  taskType: string;
  input?: any;
  projectId?: string;
  conversationId?: string;
  messageId?: string;
}

export interface TaskPatch {
  status?: string;
  output?: any;
  progress?: number;
  error?: string;
  completedAt?: Date | null;
  conversationId?: string;
  messageId?: string;
}

export interface TaskFilter {
  status?: string;
  taskType?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AgentTaskService {
  private readonly logger = new Logger(AgentTaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建 AgentTask
   */
  async createTask(input: CreateTaskInput) {
    this.logger.log(`创建 AgentTask: type=${input.taskType}, userId=${input.userId}`);

    return this.prisma.agentTask.create({
      data: {
        userId: input.userId,
        taskType: input.taskType,
        input: input.input ?? {},
        projectId: input.projectId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        status: 'pending',
        progress: 0,
      },
    });
  }

  /**
   * 更新 AgentTask（部分更新）
   */
  async updateTask(id: string, patch: TaskPatch) {
    this.logger.debug(`更新 AgentTask: ${id}, patch=${JSON.stringify(patch)}`);

    const existing = await this.prisma.agentTask.findUnique({ where: { id } });
    if (!existing) {
      throw notFound('NOT_FOUND', `AgentTask ${id} does not exist`);
    }

    return this.prisma.agentTask.update({
      where: { id },
      data: {
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.output !== undefined && { output: patch.output }),
        ...(patch.progress !== undefined && { progress: patch.progress }),
        ...(patch.error !== undefined && { error: patch.error }),
        ...(patch.completedAt !== undefined && { completedAt: patch.completedAt }),
        ...(patch.conversationId !== undefined && { conversationId: patch.conversationId }),
        ...(patch.messageId !== undefined && { messageId: patch.messageId }),
      },
    });
  }

  /**
   * 获取单个 AgentTask
   */
  async getTask(id: string) {
    const task = await this.prisma.agentTask.findUnique({ where: { id } });
    if (!task) {
      throw notFound('NOT_FOUND', `AgentTask ${id} does not exist`);
    }
    return task;
  }

  /**
   * 列出用户的 AgentTask（支持过滤）
   */
  async listTasks(userId: string, filters: TaskFilter = {}) {
    const where: any = { userId };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.taskType) {
      where.taskType = filters.taskType;
    }
    if (filters.projectId) {
      where.projectId = filters.projectId;
    }

    const [items, total] = await Promise.all([
      this.prisma.agentTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 20,
        skip: filters.offset ?? 0,
      }),
      this.prisma.agentTask.count({ where }),
    ]);

    return { items, total, limit: filters.limit ?? 20, offset: filters.offset ?? 0 };
  }

  /**
   * 取消 AgentTask
   */
  async cancelTask(id: string) {
    const task = await this.prisma.agentTask.findUnique({ where: { id } });
    if (!task) {
      throw notFound('NOT_FOUND', `AgentTask ${id} does not exist`);
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new Error(`AgentTask ${id} 已经是 ${task.status} 状态，无法取消`);
    }

    return this.prisma.agentTask.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });
  }
}