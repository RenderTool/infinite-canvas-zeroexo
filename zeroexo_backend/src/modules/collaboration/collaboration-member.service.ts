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

    // 越权防护: 请求者必须是房间成员(未被封禁/未退出且非待审申请)
    const requesterMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId: requesterId, status: { notIn: ['banned', 'left', 'pending'] } },
      select: { id: true },
    });
    if (!requesterMember) throw forbidden('FORBIDDEN', 'You are not a member of this room');

    const members = await this.prisma.collaborationMember.findMany({
      // 待审申请走 applications 接口;已退出/被封禁不显示——移出就是移出,
      // 被移出(含封禁)成员不应留在成员列表,重进须重新申请(审核制)或走邀请(非审核制)
      where: { roomId: room.id, status: { notIn: ['pending', 'left', 'banned'] } },
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
    // 房间 owner 成员记录不可修改(role/permissions)——房主自我降级会让
    // removeSelfFromRoom 的 owner 守卫失效,退出时房间崩溃(曾实测复现)
    if (memberUserId === room.ownerId) throw badRequest('BAD_REQUEST', 'Cannot modify the room owner');

    // 两档权限模型防绕过（2026-08-25 用户实测暴露）：只读房间（allowEdit=false）的成员
    // 不可被授予 edit/download 权限或 editor 角色——否则权限数据与房间档位不一致，
    // 前端按 permissions 判定「可编辑」→ 只读遮罩不渲染 → viewer 可操作画布（曾实测复现）
    if (!room.allowEdit) {
      if (dto.role === 'editor') {
        throw badRequest('COLLAB_TIER_VIOLATION', 'Read-only room does not allow editor role');
      }
      if (dto.permissions?.some((p) => p === 'edit' || p === 'download')) {
        throw badRequest('COLLAB_TIER_VIOLATION', 'Read-only room does not allow edit/download permission');
      }
    }
    // agent 权限仅限房主（owner 记录 L116 已排除不可改，非 owner 成员不可被授予）
    if (dto.permissions?.includes('agent')) {
      throw badRequest('COLLAB_TIER_VIOLATION', 'agent permission is owner-only');
    }

    const updates: Record<string, unknown> = {};
    if (dto.role !== undefined) updates.role = dto.role;
    if (dto.permissions !== undefined) updates.permissions = dto.permissions.join(',');

    if (Object.keys(updates).length > 0) {
      await this.prisma.collaborationMember.updateMany({
        where: { roomId: room.id, userId: memberUserId, status: { notIn: ['banned', 'left'] } },
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
   * 踢出成员（移出本次协作，可重新加入）
   * 软删除（status 置 left）而非物理删除：原实现删除记录会把 muted/权限一并抹掉，
   * 被踢的禁言成员重进即绕过禁言（与退出→重进同一漏洞）；
   * left 状态被各访问校验点排除（SSE/画布读/版本/消息），重进走 join/autoJoin 恢复分支。
   */
  async kickMember(canvasId: string, memberUserId: string, requesterId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== requesterId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can kick members');
    if (memberUserId === room.ownerId) throw badRequest('BAD_REQUEST', 'Cannot kick the room owner');

    const updated = await this.prisma.collaborationMember.updateMany({
      // banned 是最高优先级状态:不可被 kick 覆盖成 left(前端"移出+同时封禁"先 ban 后 kick);
      // pending 待审申请不可被踢——否则申请记录变 left,房主批准时 404 找不到申请
      where: { roomId: room.id, userId: memberUserId, status: { notIn: ['banned', 'left', 'pending'] } },
      data: { status: 'left', lastActiveAt: new Date() },
    });

    // 成员可能已处于 banned/left(banned 优先不可覆盖;left 重复操作)→ 明确报错而非假成功
    if (updated.count === 0) {
      throw notFound('COLLAB_MEMBER_NOT_FOUND', 'Member not found or already removed');
    }

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

    // 画布级封禁: 同画布所有房间(含历史房间)一并标记——房间会随"开启→关闭→再开启"
    // 重建(多历史房间),只 ban 当前房间会在重开后失效(新房间无 banned 记录,封禁形同虚设)
    await this.prisma.collaborationMember.updateMany({
      where: { room: { canvasId }, userId: memberUserId },
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

    // 画布级解禁（与 banMember 的画布级封禁对应，否则旧房间残留 banned 仍会拦截重入）
    await this.prisma.collaborationMember.updateMany({
      where: { room: { canvasId }, userId: memberUserId, status: 'banned' },
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

    // 禁言持久化: 从 permissions 移除 chat——退出/踢出是软删除(left),
    // 记录与 permissions 保留,重进恢复时无 chat 权限 → 仍为禁言状态;
    // 排除 pending: 待审申请不可被禁言,否则批准时 404 找不到申请
    const targets = await this.prisma.collaborationMember.findMany({
      where: { roomId: room.id, userId: memberUserId, status: { notIn: ['banned', 'pending'] } },
      select: { id: true, permissions: true },
    });
    if (targets.length === 0) throw notFound('COLLAB_MEMBER_NOT_FOUND', 'Member not found');

    await this.prisma.$transaction(
      targets.map((t) =>
        this.prisma.collaborationMember.update({
          where: { id: t.id },
          data: {
            status: 'muted',
            permissions: t.permissions.split(',').filter((p) => p !== 'chat').join(','),
          },
        }),
      ),
    );

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

    // 解除禁言: 恢复所有非 banned/left/pending session 的 chat 权限——只恢复
    // status='muted' 的 session 会让 offline 设备重连时被恢复分支判为 muted
    // (canChat=false),出现"解禁了禁言又复活"的假象;muted → online,offline 保持原状
    const targets = await this.prisma.collaborationMember.findMany({
      where: { roomId: room.id, userId: memberUserId, status: { notIn: ['banned', 'left', 'pending'] } },
      select: { id: true, permissions: true, status: true },
    });
    if (targets.length === 0) throw notFound('COLLAB_MEMBER_NOT_FOUND', 'Member not found or not muted');

    await this.prisma.$transaction(
      targets.map((t) => {
        const perms = t.permissions.split(',');
        if (room.allowChat && !perms.includes('chat')) perms.push('chat');
        return this.prisma.collaborationMember.update({
          where: { id: t.id },
          data: { status: t.status === 'muted' ? 'online' : t.status, permissions: perms.join(',') },
        });
      }),
    );

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

    // 检查成员权限（muted/offline 均为已入房成员：muted 需返回明确的禁言错误，
    // offline=离屏≠退出，重连恢复 online 前不应误判为越权）
    const member = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId: senderId, status: { notIn: ['banned', 'left', 'pending'] } },
    });
    if (!member) throw forbidden('FORBIDDEN', 'You are not a member of this room');
    // 禁言持久化: status=muted 或 permissions 无 chat(退出重进后 session 恢复 online 但权限保留)
    if (member.status === 'muted' || !member.permissions.split(',').includes('chat')) {
      throw forbidden('COLLAB_MEMBER_MUTED', 'You are muted');
    }
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

    // 确认用户是房间成员(left=已退出,不可读历史消息;banned=封禁,同样不可读;
    // offline=离屏≠退出,与 SSE guard/CanvasService 放行口径一致,offline 成员可读历史)
    const isMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId: requesterId, status: { notIn: ['banned', 'left', 'pending'] } },
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
