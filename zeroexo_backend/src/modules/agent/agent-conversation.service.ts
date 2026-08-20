/**
 * agent-conversation.service - Agent 对话管理服务
 *
 * 提供 AgentConversation/AgentMessage 的 CRUD 与消息写入：
 * - 会话创建 / 列表（含最后消息预览）/ 详情 / 删除（级联消息）
 * - 历史消息分页查询
 * - 任务执行时写入消息（user/assistant/tool）
 * - 任务完成后触发记忆压缩（MemoryCompactor）
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound } from '../../common/errors/app-exception.js';
import { MemoryCompactorService } from './memory-compactor.service';

@Injectable()
export class AgentConversationService {
  private readonly logger = new Logger(AgentConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly compactor: MemoryCompactorService,
  ) {}

  /** 创建会话 */
  async createConversation(userId: string, opts: { title?: string; projectId?: string }) {
    const conv = await this.prisma.agentConversation.create({
      data: {
        userId,
        title: opts.title ?? null,
        projectId: opts.projectId ?? null,
      },
    });
    this.logger.log(`创建 Agent 会话: ${conv.id}, userId=${userId}`);
    return conv;
  }

  /** 会话列表（含消息数与最后一条消息预览，按最近活动排序） */
  async listConversations(userId: string, filters: { limit?: number; offset?: number } = {}) {
    const [items, total] = await Promise.all([
      this.prisma.agentConversation.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: filters.limit ?? 20,
        skip: filters.offset ?? 0,
        include: {
          _count: { select: { messages: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
        },
      }),
      this.prisma.agentConversation.count({ where: { userId } }),
    ]);
    return { items, total, limit: filters.limit ?? 20, offset: filters.offset ?? 0 };
  }

  /** 会话详情（权限：仅本人） */
  async getConversation(id: string, userId: string) {
    const conv = await this.prisma.agentConversation.findFirst({ where: { id, userId } });
    if (!conv) throw notFound('NOT_FOUND', `AgentConversation ${id} does not exist`);
    return conv;
  }

  /** 删除会话（AgentMessage 级联删除） */
  async deleteConversation(id: string, userId: string) {
    const conv = await this.prisma.agentConversation.findFirst({ where: { id, userId } });
    if (!conv) throw notFound('NOT_FOUND', `AgentConversation ${id} does not exist`);
    await this.prisma.agentConversation.delete({ where: { id } });
    this.logger.log(`删除 Agent 会话: ${id}, userId=${userId}`);
    return { message: '会话已删除' };
  }

  /** 历史消息分页（正序，旧 → 新） */
  async listMessages(id: string, userId: string, filters: { limit?: number; offset?: number } = {}) {
    await this.getConversation(id, userId);
    const [items, total] = await Promise.all([
      this.prisma.agentMessage.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.prisma.agentMessage.count({ where: { conversationId: id } }),
    ]);
    return { items, total, limit: filters.limit ?? 50, offset: filters.offset ?? 0 };
  }

  /** 写入消息（任务执行时由 worker / execute 入口调用），并刷新会话活动时间 */
  async addMessage(input: {
    conversationId: string;
    role: string;
    content: string;
    taskId?: string;
    toolName?: string;
    toolArguments?: string;
  }) {
    const msg = await this.prisma.agentMessage.create({ data: input });
    await this.prisma.agentConversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    });
    return msg;
  }

  /** 会话内任务收尾时触发记忆压缩（失败不抛出，仅告警） */
  async maybeCompact(conversationId?: string | null): Promise<void> {
    if (!conversationId) return;
    try {
      await this.compactor.compactConversation(conversationId);
    } catch (err) {
      this.logger.warn(`记忆压缩失败: ${conversationId}`, (err as Error).message);
    }
  }
}
