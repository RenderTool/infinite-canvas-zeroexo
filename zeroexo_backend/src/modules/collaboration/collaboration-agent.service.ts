/**
 * collaboration-agent.service - 协作模式 Agent 服务（共享记忆群聊）
 *
 * @deprecated 协作聊天 @AI 派发路径已废弃（Plan#8 T6）：
 * Agent 交互统一迁移至 AgentDock（/api/agents/execute + SSE + AgentConversation）。
 * 保留仅作历史参考，不再被前端调用。
 *
 * 提供协作房间维度的 Agent 会话管理：
 * - 获取/创建 AgentSession（共享记忆）
 * - Agent 会话消息历史
 * - 更新共享记忆
 * - 执行 Agent：注入协作上下文（项目/成员/对话历史/统计）→ 调用画布 Agent →
 *   结果写入协作消息(type=agent)并通过 SSE 广播给房间所有成员
 *
 * Agent 复用 AgentFactory('canvas_agent')，具备画布工具能力；
 * 共享记忆通过 system 上下文块注入，Agent 回复后自动更新记忆。
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AgentFactory } from '../agent/agent-factory';
import { CollaborationEventsService } from './collaboration-events.service';
import { AgentExecuteDto } from './dto/collaboration.dto';
import { notFound, forbidden } from '../../common/errors/app-exception.js';

/** 协作模式下使用的画布 Agent 类型（对应 skills/canvas_agent） */
const COLLAB_AGENT_TYPE = 'canvas_agent';

@Injectable()
export class CollaborationAgentService {
  private readonly logger = new Logger(CollaborationAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: CollaborationEventsService,
    private readonly agentFactory: AgentFactory,
  ) {}

  /**
   * 获取（必要时创建）房间的 Agent 会话与共享记忆
   */
  async getSession(canvasId: string, userId: string) {
    const room = await this.requireRoom(canvasId);
    await this.requireMember(room.id, userId);

    const session = await this.getOrCreateSession(room.id, canvasId);

    const memberCount = await this.prisma.collaborationMember.count({
      where: { roomId: room.id, status: 'online' },
    });

    return {
      id: session.id,
      agentType: session.agentType,
      status: session.status,
      memory: session.memory,
      memberCount,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * 获取 Agent 会话消息历史（共享对话记录）
   */
  async listMessages(canvasId: string, userId: string, limit: number = 50) {
    const room = await this.requireRoom(canvasId);
    await this.requireMember(room.id, userId);

    const session = await this.prisma.agentSession.findUnique({
      where: { roomId: room.id },
    });
    if (!session) return [];

    return this.prisma.agentSessionMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 更新共享记忆（所有成员可见的上下文）
   */
  async updateMemory(canvasId: string, userId: string, memory: Record<string, unknown>) {
    const room = await this.requireRoom(canvasId);
    await this.requireMember(room.id, userId);

    const session = await this.getOrCreateSession(room.id, canvasId);
    await this.prisma.agentSession.update({
      where: { id: session.id },
      data: { memory: memory as any },
    });

    this.logger.log(`共享记忆已更新: session=${session.id}, userId=${userId}`);
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'room_updated',
      userId,
      meta: { memory: true },
    });
    return { message: '共享记忆已更新' };
  }

  /**
   * 执行协作 Agent
   *
   * 流程：
   * 1. 校验房间/成员/权限（agent 权限 + allowAgentChat）
   * 2. 持久化用户消息到 AgentSessionMessage
   * 3. 广播 agent_thinking 事件
   * 4. 注入共享上下文（项目/成员/历史/统计）并调用 canvas_agent 执行
   * 5. 将 Agent 回复持久化 + 写入协作消息(type=agent)并广播
   */
  async execute(canvasId: string, userId: string, dto: AgentExecuteDto) {
    const room = await this.requireRoom(canvasId);
    if (!room.allowAgentChat) {
      throw forbidden('COLLAB_AGENT_DISABLED', 'Agent chat is disabled in this room');
    }
    const member = await this.requireMember(room.id, userId, { needAgent: true });

    // 获取/创建会话
    const session = await this.getOrCreateSession(room.id, canvasId);

    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nickname: true, username: true },
    });
    const senderName = member.nickname ?? sender?.nickname ?? sender?.username ?? '用户';

    // 持久化用户消息到会话（共享对话历史）
    await this.prisma.agentSessionMessage.create({
      data: {
        sessionId: session.id,
        senderId: userId,
        senderName,
        role: 'user',
        content: dto.content,
      },
    });

    // 广播 Agent 思考中
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'agent_thinking',
      userId,
      meta: { content: dto.content, senderName },
    });

    // 构建共享上下文 + 调用 Agent
    const contextBlock = await this.buildSharedContext(room.id, session.id, canvasId);
    const agentType = session.agentType === 'canvas-assistant' ? COLLAB_AGENT_TYPE : session.agentType;
    const input = `${contextBlock}\n\n## 用户消息\n${dto.content}`;

    let finalOutput = '';
    let errorMessage: string | null = null;

    const agent = await this.agentFactory.create(agentType, canvasId, userId);
    try {
      for await (const event of agent.execute(input, canvasId, userId)) {
        if (event.type === 'agent:tool_call') {
          const data = event.data as { toolName?: string; arguments?: string };
          this.eventsService.broadcastToRoom(canvasId, {
            type: 'agent_tool_call',
            userId,
            meta: { toolName: data?.toolName, arguments: data?.arguments },
          });
        } else if (event.type === 'agent:complete') {
          const data = event.data as { output?: string };
          finalOutput = (data?.output ?? '').trim();
        } else if (event.type === 'agent:error') {
          const data = event.data as { error?: string };
          errorMessage = data?.error ?? 'Agent 执行失败';
        }
      }
    } catch (err) {
      errorMessage = (err as Error).message;
      this.logger.error(`协作 Agent 执行异常: ${errorMessage}`);
    }

    if (errorMessage) {
      const content = `抱歉，处理时出现问题：${errorMessage}`;
      const agentReply = await this.prisma.agentSessionMessage.create({
        data: { sessionId: session.id, senderId: 'agent', senderName: 'AI 助手', role: 'agent', content },
      });
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'agent_result',
        userId,
        meta: { error: errorMessage },
      });
      return { sessionId: session.id, message: null, agentSessionMessage: agentReply, error: errorMessage };
    }

    // 持久化 Agent 回复到会话
    const agentReply = await this.prisma.agentSessionMessage.create({
      data: { sessionId: session.id, senderId: 'agent', senderName: 'AI 助手', role: 'agent', content: finalOutput },
    });

    // 更新共享记忆（追加历史、刷新统计）
    await this.updateSessionMemory(session.id, {
      senderName,
      content: dto.content,
      reply: finalOutput,
    });

    // 写入协作消息(type=agent)并广播给所有成员
    const collabMessage = await this.prisma.collaborationMessage.create({
      data: {
        roomId: room.id,
        senderId: 'agent',
        senderName: 'AI 助手',
        senderRole: 'editor',
        type: 'agent',
        content: finalOutput,
        mentions: dto.mentions ?? [],
        agentMentioned: true,
        replyToId: dto.replyToId ?? null,
      },
    });

    this.eventsService.broadcastToRoom(canvasId, {
      type: 'message',
      userId: 'agent',
      meta: { message: collabMessage },
    });
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'agent_result',
      userId,
      meta: { message: collabMessage },
    });

    this.logger.log(`协作 Agent 执行完成: session=${session.id}, userId=${userId}`);
    return { sessionId: session.id, message: collabMessage, agentSessionMessage: agentReply };
  }

  // ==================== 内部方法 ====================

  /** 校验房间存在且活跃 */
  private async requireRoom(canvasId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    return room;
  }

  /** 校验用户是房间成员（可选要求 agent 权限） */
  private async requireMember(roomId: string, userId: string, opts: { needAgent?: boolean } = {}) {
    const member = await this.prisma.collaborationMember.findFirst({
      where: { roomId, userId, status: 'online' },
    });
    if (!member) throw forbidden('FORBIDDEN', 'You are not a member of this room');
    if (opts.needAgent && !member.permissions.split(',').includes('agent')) {
      throw forbidden('COLLAB_NO_AGENT_PERMISSION', 'You do not have permission to use the agent');
    }
    return member;
  }

  /** 获取或创建房间的 Agent 会话 */
  private async getOrCreateSession(roomId: string, canvasId: string) {
    const existing = await this.prisma.agentSession.findUnique({
      where: { roomId },
    });
    if (existing) return existing;
    return this.prisma.agentSession.create({
      data: {
        roomId,
        canvasId,
        agentType: COLLAB_AGENT_TYPE,
        memory: { context: [], history: [], stats: {} },
      },
    });
  }

  /** 构建注入 Agent 的共享上下文（项目/成员/对话历史/统计） */
  private async buildSharedContext(roomId: string, sessionId: string, canvasId: string): Promise<string> {
    const [members, history, project, session] = await Promise.all([
      this.prisma.collaborationMember.findMany({
        where: { roomId, status: { not: 'banned' } },
        include: { user: { select: { nickname: true, username: true } } },
        orderBy: [{ role: 'desc' }, { sessionIndex: 'asc' }],
        take: 20,
      }),
      this.prisma.agentSessionMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        take: 30,
      }),
      this.prisma.project.findUnique({
        where: { id: canvasId },
        select: { config: true },
      }),
      this.prisma.agentSession.findUnique({ where: { id: sessionId } }),
    ]);

    const memory = (session?.memory as Record<string, any>) ?? {};
    const parts: string[] = [];

    // 项目上下文
    const cfg = (project?.config as Record<string, any>) ?? {};
    const projectLines = [
      cfg.name ? `名称：${cfg.name}` : '',
      cfg.genre ? `类型：${cfg.genre}` : '',
      cfg.resolution ? `分辨率：${cfg.resolution}` : '',
      cfg.aspectRatio ? `画幅比例：${cfg.aspectRatio}` : '',
    ].filter(Boolean);
    if (projectLines.length) parts.push(`### 当前项目\n${projectLines.join('\n')}`);

    // 协作成员
    const memberLines = members.map((m) => {
      const name = m.nickname ?? m.user?.nickname ?? m.user?.username ?? '用户';
      const online = m.status === 'online' ? ' 在线' : '';
      return `- ${name} (${m.role})${online}`;
    });
    parts.push(`### 协作成员 (${members.length})\n${memberLines.join('\n')}`);

    // 共享对话历史
    if (history.length) {
      const historyLines = history.map((h) => {
        const who = h.role === 'agent' ? 'AI 助手' : h.senderName;
        return `${who}: ${h.content.slice(0, 500)}`;
      });
      parts.push(`### 共享对话历史\n${historyLines.join('\n')}`);
    }

    // 协作统计
    const stats = memory.stats ?? {};
    const statsLines = [
      `成员数：${members.length}`,
      stats.activeMinutes ? `协作时长：${stats.activeMinutes} 分钟` : '',
    ].filter(Boolean);
    parts.push(`### 协作统计\n${statsLines.join('\n')}`);

    return `## 协作共享上下文\n${parts.join('\n\n')}`;
  }

  /** 更新共享记忆（追加历史、刷新统计） */
  private async updateSessionMemory(
    sessionId: string,
    opts: { senderName: string; content: string; reply: string },
  ) {
    const session = await this.prisma.agentSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    const memory = (session.memory as Record<string, any>) ?? {};
    const history = Array.isArray(memory.history) ? memory.history : [];
    history.push(
      { sender: opts.senderName, content: opts.content, timestamp: Date.now(), isAgentMentioned: true },
      { sender: 'AI 助手', content: opts.reply, timestamp: Date.now(), isAgentMentioned: false },
    );
    const trimmed = history.slice(-100);
    const stats = {
      ...(memory.stats ?? {}),
      lastActivity: Date.now(),
      activeMinutes: Math.max(Number(memory.stats?.activeMinutes ?? 0), 1),
    };

    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: { memory: { context: memory.context ?? [], history: trimmed, stats } },
    });
  }
}
