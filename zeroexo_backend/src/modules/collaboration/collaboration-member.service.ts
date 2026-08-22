import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateMemberDto, SendMessageDto } from './dto/collaboration.dto';
import { CollaborationEventsService } from './collaboration-events.service';
import { badRequest, notFound, forbidden } from '../../common/errors/app-exception.js';

/**
 * 协作成员服务 - 成员管理、消息管理。
 * 成员权限变更 / 消息发送删除时通过 SSE 向房间所有成员实时广播。
 */
@Injectable()
export class CollaborationMemberService implements OnModuleDestroy {
  private readonly logger = new Logger(CollaborationMemberService.name);

  // 聊天消息频率限制：每用户每秒最多 5 条
  private readonly chatRateLimit = new Map<string, { count: number; resetAt: number }>();
  private readonly chatRateCleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: CollaborationEventsService,
  ) {
    // 每 5 分钟清理过期记录
    this.chatRateCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of this.chatRateLimit) {
        if (now > record.resetAt + 60_000) {
          this.chatRateLimit.delete(key);
        }
      }
    }, 300_000);
  }

  /**
   * 获取房间成员列表
   * 仅房间成员(或房主)可查看,非成员抛 Forbidden
   */
  async listMembers(canvasId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');

    // 越权防护: 请求者必须是房间成员(未被封禁)
    const requesterMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId: requesterId, status: { not: 'banned' } },
      select: { id: true },
    });
    if (!requesterMember) throw forbidden('FORBIDDEN', 'You are not a member of this room');

    const members = await this.prisma.collaborationMember.findMany({
      where: { roomId: room.id },
      include: {
        // 不暴露 email,仅返回成员协作所需字段
        user: { select: { id: true, nickname: true, avatarUrl: true, username: true } },
      },
      orderBy: [{ role: 'desc' }, { sessionIndex: 'asc' }],
    });

    // 按 userId 聚合，同一用户的多个 session 合并显示
    const userGroups = new Map<string, {
      userId: string;
      nickname: string;
      avatarUrl: string | null;
      role: string;
      permissions: string[];
      sessions: Array<{ sessionIndex: number; deviceType: string; status: string; lastActiveAt: Date }>;
      isSelf: boolean;
    }>();

    for (const m of members) {
      const existing = userGroups.get(m.userId);
      const sessionInfo = {
        sessionIndex: m.sessionIndex,
        deviceType: m.deviceType,
        status: m.status,
        lastActiveAt: m.lastActiveAt,
      };

      if (existing) {
        existing.sessions.push(sessionInfo);
        // 保留最高权限
        if (this.rolePriority(m.role) > this.rolePriority(existing.role)) {
          existing.role = m.role;
          existing.permissions = m.permissions.split(',');
        }
      } else {
        userGroups.set(m.userId, {
          userId: m.userId,
          nickname: m.nickname ?? (m.user?.nickname || m.user?.username || '用户'),
          avatarUrl: m.user?.avatarUrl ?? null,
          role: m.role,
          permissions: m.permissions.split(','),
          sessions: [sessionInfo],
          isSelf: m.userId === requesterId,
        });
      }
    }

    return Array.from(userGroups.values());
  }

  /**
   * 更新成员权限/角色
   */
  async updateMember(canvasId: string, memberUserId: string, requesterId: string, dto: UpdateMemberDto) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== requesterId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can modify member permissions');

    const updates: Record<string, unknown> = {};
    if (dto.role !== undefined) updates.role = dto.role;
    if (dto.permissions !== undefined) updates.permissions = dto.permissions.join(',');

    if (Object.keys(updates).length > 0) {
      await this.prisma.collaborationMember.updateMany({
        where: { roomId: room.id, userId: memberUserId, status: { not: 'banned' } },
        data: updates,
      });
    }

    this.logger.log(`成员 ${memberUserId} 权限已更新`);
    // 实时广播成员权限变更事件
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_updated',
      userId: memberUserId,
      meta: { fields: Object.keys(updates) },
    });
    return { message: '成员权限已更新' };
  }

  /**
   * 踢出成员
   */
  async kickMember(canvasId: string, memberUserId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== requesterId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can kick members');
    if (memberUserId === room.ownerId) throw badRequest('BAD_REQUEST', 'Cannot kick the room owner');

    await this.prisma.collaborationMember.updateMany({
      where: { roomId: room.id, userId: memberUserId },
      data: { status: 'offline' },
    });

    this.logger.log(`成员 ${memberUserId} 被踢出房间 ${room.id}`);
    // 实时广播成员离开事件（被踢出）
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_left',
      userId: memberUserId,
      meta: { kicked: true },
    });
    return { message: '成员已被踢出' };
  }

  /**
   * 封禁成员（禁止重新加入）
   */
  async banMember(canvasId: string, memberUserId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== requesterId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can ban members');
    if (memberUserId === room.ownerId) throw badRequest('BAD_REQUEST', 'Cannot ban the room owner');

    await this.prisma.collaborationMember.updateMany({
      where: { roomId: room.id, userId: memberUserId },
      data: { status: 'banned' },
    });

    this.logger.log(`成员 ${memberUserId} 被封禁`);
    // 实时广播成员状态变更事件（封禁）
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_updated',
      userId: memberUserId,
      meta: { banned: true },
    });
    return { message: '成员已被封禁' };
  }

  /**
   * 解禁成员
   */
  async unbanMember(canvasId: string, memberUserId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== requesterId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can unban members');

    await this.prisma.collaborationMember.updateMany({
      where: { roomId: room.id, userId: memberUserId, status: 'banned' },
      data: { status: 'offline' },
    });

    return { message: '成员已被解禁' };
  }

  /**
   * 禁言成员
   */
  async muteMember(canvasId: string, memberUserId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== requesterId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can mute members');
    if (memberUserId === room.ownerId) throw badRequest('BAD_REQUEST', 'Cannot mute the room owner');

    // 从 permissions 中移除 chat
    await this.prisma.$transaction([
      this.prisma.collaborationMember.updateMany({
        where: { roomId: room.id, userId: memberUserId, status: { not: 'banned' } },
        data: { status: 'muted' },
      }),
    ]);

    this.logger.log(`成员 ${memberUserId} 被禁言`);
    // 实时广播成员状态变更事件（禁言）
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_updated',
      userId: memberUserId,
      meta: { muted: true },
    });
    return { message: '成员已被禁言' };
  }

  /**
   * 解除禁言
   */
  async unmuteMember(canvasId: string, memberUserId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== requesterId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can unmute members');

    await this.prisma.collaborationMember.updateMany({
      where: { roomId: room.id, userId: memberUserId, status: 'muted' },
      data: { status: 'online' },
    });

    // 实时广播成员状态变更事件（解除禁言）
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_updated',
      userId: memberUserId,
      meta: { unmuted: true },
    });
    return { message: '已解除禁言' };
  }

  /**
   * 发送聊天消息
   */
  async sendMessage(canvasId: string, senderId: string, dto: SendMessageDto) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');

    // 检查成员权限
    const member = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId: senderId, status: 'online' },
    });
    if (!member) throw forbidden('FORBIDDEN', 'You are not a member of this room');
    if (member.status === 'muted') throw forbidden('COLLAB_MEMBER_MUTED', 'You are muted');
    if (!room.allowChat) throw forbidden('FORBIDDEN', 'Chat is disabled in this room');

    // 聊天频率限制：每秒最多 5 条，防止刷屏
    const now = Date.now();
    const rateRecord = this.chatRateLimit.get(senderId);
    if (rateRecord && now <= rateRecord.resetAt) {
      rateRecord.count++;
      if (rateRecord.count > 5) {
        this.logger.warn(`[CHAT_RATE] 用户 ${senderId} 聊天消息频率过高`);
        throw badRequest('COLLAB_CHAT_RATE_LIMIT', '消息发送太快，请稍后再试');
      }
    } else {
      this.chatRateLimit.set(senderId, { count: 1, resetAt: now + 1000 });
    }

    const sender = await this.prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) throw notFound('USER_NOT_FOUND', 'User not found');

    const message = await this.prisma.collaborationMessage.create({
      data: {
        roomId: room.id,
        senderId,
        senderName: sender.nickname || sender.username || '用户',
        senderRole: member.role,
        // 用户消息始终为 text（agent 类型仅用于 Agent 自己的回复，见 collaboration-agent.service）
        type: 'text',
        content: dto.content,
        mentions: dto.mentions ?? [],
        agentMentioned: dto.agentMentioned ?? false,
        replyToId: dto.replyToId ?? null,
      },
    });

    // 实时广播新消息事件
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'message',
      userId: senderId,
      meta: { message },
    });

    return message;
  }

  /**
   * 获取聊天历史
   */
  async listMessages(canvasId: string, requesterId: string, limit: number = 50, beforeId?: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');

    // 确认用户是房间成员
    const isMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId: requesterId, status: { not: 'offline' } },
    });
    if (!isMember) throw forbidden('FORBIDDEN', 'You are not a member of this room');

    const whereClause: { roomId: string; id?: { lt: string } } = { roomId: room.id };
    if (beforeId) whereClause.id = { lt: beforeId };

    return this.prisma.collaborationMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 删除消息
   */
  async deleteMessage(canvasId: string, messageId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');

    const message = await this.prisma.collaborationMessage.findUnique({ where: { id: messageId } });
    if (!message || message.roomId !== room.id) throw notFound('NOT_FOUND', 'Message not found');

    // 只有发送者或房主可删除
    if (message.senderId !== requesterId && room.ownerId !== requesterId) {
      throw forbidden('FORBIDDEN', 'No permission to delete this message');
    }

    await this.prisma.collaborationMessage.delete({ where: { id: messageId } });

    // 实时广播消息删除事件
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'message_deleted',
      userId: requesterId,
      meta: { messageId },
    });
    return { message: '消息已删除' };
  }

  /**
   * 角色优先级（用于聚合时保留最高权限）
   */
  private rolePriority(role: string): number {
    switch (role) {
      case 'owner': return 3;
      case 'editor': return 2;
      case 'viewer': return 1;
      default: return 0;
    }
  }

  onModuleDestroy() {
    clearInterval(this.chatRateCleanupTimer);
  }
}
