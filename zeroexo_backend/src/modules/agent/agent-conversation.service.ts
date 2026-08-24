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
import type { ChatMessage } from './agent-executor';

/** 历史注入保留的最近文本轮数（Plan#36 R2-1，与 MemoryCompactor 预算对齐） */
const HISTORY_MAX_TURNS = 20;

/** 空会话保留窗口（分钟）：刚懒创建的会话尚无消息，窗口内不过滤/不清理，避免竞态误删 */
const EMPTY_SESSION_GRACE_MINUTES = 5;

@Injectable()
export class AgentConversationService {
  private readonly logger = new Logger(AgentConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly compactor: MemoryCompactorService,
  ) {}

  /** 创建会话（创建前先清理该用户名下无消息无任务的空会话，防空会话堆积；
   * 前端新建按钮已改懒创建，此处为存量/异常残留的兜底清理） */
  async createConversation(userId: string, opts: { title?: string; projectId?: string }) {
    try {
      const graceBefore = new Date(Date.now() - EMPTY_SESSION_GRACE_MINUTES * 60_000);
      const cleaned = await this.prisma.agentConversation.deleteMany({
        where: {
          userId,
          createdAt: { lt: graceBefore },
          messages: { none: {} },
          tasks: { none: {} },
        },
      });
      if (cleaned.count > 0) {
        this.logger.log(`清理空 Agent 会话 ${cleaned.count} 条, userId=${userId}`);
      }
    } catch (err) {
      this.logger.warn('清理空会话失败（不阻断创建）', (err as Error).message);
    }
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

  /** 分页参数强转钳制：URL query 以字符串传入，Prisma take/skip 要求 Int（另防恶意大数） */
  private pagingOf(filters: { limit?: number; offset?: number }, defaultLimit: number, maxLimit: number) {
    const limit = Math.min(maxLimit, Math.max(1, Math.trunc(Number(filters.limit)) || defaultLimit));
    const offset = Math.max(0, Math.trunc(Number(filters.offset)) || 0);
    return { limit, offset };
  }

  /** 会话列表（含消息数与最后一条消息预览，按最近活动排序）。
   * 过滤空会话（无消息且超出懒创建宽限期），避免空对话污染列表 */
  async listConversations(userId: string, filters: { limit?: number; offset?: number } = {}) {
    const { limit, offset } = this.pagingOf(filters, 20, 100);
    const graceBefore = new Date(Date.now() - EMPTY_SESSION_GRACE_MINUTES * 60_000);
    const where = {
      userId,
      OR: [
        { messages: { some: {} } },
        { createdAt: { gte: graceBefore } },
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.agentConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: { select: { messages: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
        },
      }),
      this.prisma.agentConversation.count({ where }),
    ]);
    return { items, total, limit, offset };
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
    const { limit, offset } = this.pagingOf(filters, 50, 200);
    const [items, total] = await Promise.all([
      this.prisma.agentMessage.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.agentMessage.count({ where: { conversationId: id } }),
    ]);
    return { items, total, limit, offset };
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

  /**
   * 构建 LLM 会话历史（Plan#36 R2-1 记忆链路，根治上下文遗忘）：
   * - memory_compact 摘要（role=system）→ 转为带标注的 user 消息，裁剪时始终保留（靠旧历史换取）
   * - 带 toolName 的工具调用通知消息跳过（避免 tool_calls/tool 消息对断裂触发严格渠道校验）
   * - 排除当前任务自身已落库的用户消息（excludeTaskId），避免与 execute 输入重复
   * - 最近 HISTORY_MAX_TURNS 条文本轮 + 全部摘要；失败不阻断任务（返回空历史）
   */
  async buildLlmHistory(
    conversationId: string | null | undefined,
    excludeTaskId?: string,
  ): Promise<ChatMessage[]> {
    if (!conversationId) return [];
    try {
      const rows = await this.prisma.agentMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true, toolName: true, taskId: true },
      });
      const summaries: ChatMessage[] = [];
      const turns: ChatMessage[] = [];
      // 交互协议工具名（需保留在历史中，供回执时 LLM 理解上下文）
      const INTERACTION_TOOLS = new Set([
        'request_question',
        'request_step',
        'request_params',
        'request_upload',
        'plan_present',
        'emit_brief',
      ]);
      for (const row of rows) {
        if (excludeTaskId && row.taskId === excludeTaskId) continue;
        if (row.role === 'system' && row.toolName === 'memory_compact') {
          summaries.push({
            role: 'user',
            content: `[系统备注：以下是更早对话历史的摘要，作为既有上下文参考]\n${row.content}`,
          });
          continue;
        }
        // 交互协议消息保留在历史中（LLM 需要理解之前的交互上下文）
        if (row.toolName && INTERACTION_TOOLS.has(row.toolName)) {
          if (row.role === 'assistant' && row.content) {
            turns.push({ role: 'assistant', content: row.content });
          }
          continue;
        }
        if (row.toolName) continue; // 普通工具调用通知不入历史（防 OpenAI 严格校验断裂）
        if (row.role === 'user') {
          turns.push({ role: 'user', content: row.content });
        } else if (row.role === 'assistant' && row.content) {
          turns.push({ role: 'assistant', content: row.content });
        }
      }
      return [...summaries, ...turns.slice(-HISTORY_MAX_TURNS)];
    } catch (err) {
      this.logger.warn(`会话历史加载失败: ${conversationId}`, (err as Error).message);
      return [];
    }
  }
}
