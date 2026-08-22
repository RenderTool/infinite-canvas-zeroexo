import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InviteService } from './invite.service';
import { CollaborationEventsService } from './collaboration-events.service';
import { CreateRoomDto, UpdateRoomDto } from './dto/collaboration.dto';
import { badRequest, notFound, forbidden, conflict } from '../../common/errors/app-exception.js';

/**
 * 协作房间服务 - 房间 CRUD、邀请码生成/验证、加入/离开逻辑。
 * 核心特性：
 *  1. 创建房间时自动将创建者添加为 owner 成员
 *  2. auto-self 模式下同账户多设备自动触发协作（sessionIndex 区分设备序号）
 *  3. 邀请码过期自动清理
 *  4. 成员加入/离开/房间变更时通过 SSE 向房间所有成员实时广播
 */
@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inviteService: InviteService,
    private readonly eventsService: CollaborationEventsService,
  ) {}

  /**
   * 创建协作房间
   */
  async createRoom(userId: string, dto: CreateRoomDto) {
    // 检查画布是否属于当前用户
    const project = await this.prisma.project.findUnique({ where: { id: dto.canvasId } });
    if (!project) throw notFound('PROJECT_NOT_FOUND', 'Canvas not found');
    if (project.ownerId !== userId) throw forbidden('PROJECT_PERMISSION_DENIED', 'No permission to operate this canvas');

    // 检查是否已存在活跃房间
    const existing = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId: dto.canvasId, status: 'active' },
    });
    if (existing) throw conflict('COLLAB_ROOM_EXISTS', 'A collaboration room already exists for this canvas');

    const inviteCode = await this.inviteService.generateUniqueCode();
    const inviteLink = this.inviteService.generateLink(inviteCode);
    const expiresAt = this.inviteService.calculateExpiresAt(dto.expiresInHours);

    const room = await this.prisma.collaborationRoom.create({
      data: {
        canvasId: dto.canvasId,
        ownerId: userId,
        inviteCode,
        inviteLink,
        mode: dto.mode ?? 'invite-only',
        maxMembers: dto.maxMembers ?? null,
        expiresAt,
        allowChat: dto.allowChat ?? true,
        allowAgentChat: dto.allowAgentChat ?? true,
        allowEdit: dto.allowEdit ?? true,
        allowDownload: dto.allowDownload ?? false,
        // 自动将创建者添加为 owner 成员
        members: {
          create: {
            userId,
            role: 'owner',
            permissions: 'view,chat,edit,agent,download',
            status: 'online',
            deviceType: 'desktop',
            sessionIndex: 0,
          },
        },
      },
      include: { members: true },
    });

    // 同时创建 Agent 会话
    await this.prisma.agentSession.create({
      data: {
        roomId: room.id,
        canvasId: dto.canvasId,
        agentType: 'canvas-assistant',
        memory: { context: [], history: [], stats: {} },
      },
    });

    this.logger.log(`协作房间创建成功: ${room.id}, 画布: ${dto.canvasId}`);
    return this.toResponse(room, userId);
  }

  /**
   * 获取画布的协作房间信息
   * 仅房间成员(或房主)可查看,非成员抛 Forbidden
   */
  async getRoomByCanvas(userId: string, canvasId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
      include: {
        members: {
          include: { user: { select: { id: true, nickname: true, avatarUrl: true, username: true } } },
        },
      },
    });
    if (!room) return null;

    // 越权防护: 请求者必须是房间成员(未被封禁);房主在创建房间时已自动成为成员
    const requesterMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId, status: { not: 'banned' } },
      select: { id: true },
    });
    if (!requesterMember) throw forbidden('FORBIDDEN', 'You are not a member of this room');

    return {
      ...this.toResponse(room, userId),
      members: room.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        nickname: m.nickname ?? (m.user?.nickname || m.user?.username || '用户'),
        avatarUrl: m.user?.avatarUrl ?? null,
        role: m.role,
        permissions: m.permissions.split(','),
        status: m.status,
        deviceType: m.deviceType,
        sessionIndex: m.sessionIndex,
        lastActiveAt: m.lastActiveAt,
      })),
      memberCount: room.members.length,
    };
  }

  /**
   * 更新房间设置
   */
  async updateRoom(userId: string, canvasId: string, dto: UpdateRoomDto) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== userId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can modify room settings');

    const updateData: Record<string, unknown> = {};
    if (dto.mode !== undefined) updateData.mode = dto.mode;
    if (dto.maxMembers !== undefined) updateData.maxMembers = dto.maxMembers;
    if (dto.allowChat !== undefined) updateData.allowChat = dto.allowChat;
    if (dto.allowAgentChat !== undefined) updateData.allowAgentChat = dto.allowAgentChat;
    if (dto.allowEdit !== undefined) updateData.allowEdit = dto.allowEdit;
    if (dto.allowDownload !== undefined) updateData.allowDownload = dto.allowDownload;
    if (dto.expiresInHours !== undefined) {
      updateData.expiresAt = this.inviteService.calculateExpiresAt(dto.expiresInHours);
    }

    const updated = await this.prisma.collaborationRoom.update({
      where: { id: room.id },
      data: updateData,
    });

    this.logger.log(`协作房间已更新: ${room.id}`);
    // 实时广播房间设置变更事件
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'room_updated',
      userId,
      meta: { fields: Object.keys(updateData) },
    });
    return this.toResponse(updated, userId);
  }

  /**
   * 关闭协作房间（踢出所有人）
   */
  async closeRoom(userId: string, canvasId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== userId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can close the room');

    await this.prisma.$transaction([
      this.prisma.collaborationMember.updateMany({
        where: { roomId: room.id },
        data: { status: 'offline' },
      }),
      this.prisma.collaborationRoom.update({
        where: { id: room.id },
        data: { status: 'closed' },
      }),
    ]);

    this.logger.log(`协作房间已关闭: ${room.id}`);
    // 实时广播房间关闭事件
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'room_closed',
      userId,
    });
    return { message: '协作房间已关闭' };
  }

  /**
   * 生成新的邀请码/链接（重置）
   */
  async regenerateInvite(userId: string, canvasId: string, expiresInHours?: number) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== userId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can generate invite codes');

    const inviteCode = await this.inviteService.generateUniqueCode();
    const inviteLink = this.inviteService.generateLink(inviteCode);
    const expiresAt = this.inviteService.calculateExpiresAt(expiresInHours);

    const updated = await this.prisma.collaborationRoom.update({
      where: { id: room.id },
      data: { inviteCode, inviteLink, expiresAt },
    });

    this.logger.log(`邀请码已重置: ${room.id}`);
    return {
      inviteCode: updated.inviteCode,
      inviteLink: updated.inviteLink,
      expiresAt: updated.expiresAt,
    };
  }

  /**
   * 验证邀请码
   */
  async verifyInvite(inviteCode: string) {
    const result = await this.inviteService.verifyCode(inviteCode);
    if (!result) throw badRequest('COLLAB_INVITE_INVALID', 'Invalid, expired, or closed invite code');
    return result;
  }

  /**
   * 通过邀请码加入房间
   */
  async joinByInvite(userId: string, canvasId: string, inviteCode: string, nickname?: string, deviceType?: string) {
    const verification = await this.verifyInvite(inviteCode);
    if (verification.canvasId !== canvasId) {
      throw badRequest('COLLAB_INVITE_INVALID', 'Invite code does not match the current canvas');
    }

    // 检查人数限制
    const memberCount = await this.prisma.collaborationMember.count({
      where: { roomId: verification.id, status: { not: 'banned' } },
    });
    const room = await this.prisma.collaborationRoom.findUnique({ where: { id: verification.id } });
    if (room?.maxMembers && memberCount >= room.maxMembers) {
      throw badRequest('COLLAB_ROOM_FULL', 'Room is already full');
    }

    // 检查是否已被封禁
    const existingMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: verification.id, userId, status: 'banned' },
    });
    if (existingMember) throw forbidden('COLLAB_MEMBER_BANNED', 'You are banned and cannot join');

    // 检查是否已在房间中
    const activeMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: verification.id, userId, status: 'online' },
    });
    if (activeMember) {
      // 已在房间中，直接返回
      return this.getRoomByCanvas(userId, canvasId);
    }

    // 确定权限 - 根据房间模式
    const isOwner = verification.ownerId === userId;
    const role = isOwner ? 'owner' : 'viewer';
    const permissions = isOwner ? 'view,chat,edit,agent,download' : 'view,chat';

    // 如果房主允许编辑
    if (room?.allowEdit && !isOwner) {
      // invite-only 模式下默认 viewer，房主可在成员管理中升级
    }

    // 计算 sessionIndex（同账户多设备）
    const existingSessions = await this.prisma.collaborationMember.findMany({
      where: { roomId: verification.id, userId },
      orderBy: { sessionIndex: 'asc' },
    });
    const sessionIndex = existingSessions.length > 0
      ? Math.max(...existingSessions.map((m) => m.sessionIndex)) + 1
      : 0;

    await this.prisma.collaborationMember.create({
      data: {
        roomId: verification.id,
        userId,
        nickname: nickname ?? undefined,
        role,
        permissions,
        status: 'online',
        deviceType: deviceType ?? 'desktop',
        sessionIndex,
      },
    });

    this.logger.log(`用户 ${userId} 加入房间 ${verification.id}, sessionIndex=${sessionIndex}`);
    // 实时广播成员加入事件
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_joined',
      userId,
      meta: { role, sessionIndex },
    });
    return this.getRoomByCanvas(userId, canvasId);
  }

  /**
   * 同账户多设备自动加入（auto-self 模式）
   * 核心机制：当同一账户在另一设备/标签页打开同一画布时，自动触发协作
   */
  async autoJoin(userId: string, canvasId: string, deviceType?: string) {
    // 查找当前画布的活跃房间
    let room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });

    // 如果不存在房间，自动创建一个 auto-self 模式的房间
    if (!room) {
      const project = await this.prisma.project.findUnique({ where: { id: canvasId } });
      if (!project || project.ownerId !== userId) {
        throw forbidden('PROJECT_PERMISSION_DENIED', 'No permission to access this canvas');
      }

      const inviteCode = await this.inviteService.generateUniqueCode();
      const inviteLink = this.inviteService.generateLink(inviteCode);
      const expiresAt = this.inviteService.calculateExpiresAt(720); // auto-self 房间默认 30 天

      room = await this.prisma.collaborationRoom.create({
        data: {
          canvasId,
          ownerId: userId,
          inviteCode,
          inviteLink,
          mode: 'auto-self',
          allowChat: true,
          allowAgentChat: true,
          allowEdit: true,
          allowDownload: false,
          expiresAt,
          members: {
            create: {
              userId,
              role: 'owner',
              permissions: 'view,chat,edit,agent,download',
              status: 'online',
              deviceType: deviceType ?? 'desktop',
              sessionIndex: 0,
            },
          },
        },
        include: { members: true },
      });

      await this.prisma.agentSession.create({
        data: {
          roomId: room.id,
          canvasId,
          agentType: 'canvas-assistant',
          memory: { context: [], history: [], stats: {} },
        },
      });

      this.logger.log(`[auto-self] 自动创建协作房间: ${room.id}`);
      // 广播成员加入（创建者）
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'member_joined',
        userId,
        meta: { role: 'owner', sessionIndex: 0 },
      });
      return this.getRoomByCanvas(userId, canvasId);
    }

    // 如果房间已存在，检查当前账户是否已在房间中
    const existingMembers = await this.prisma.collaborationMember.findMany({
      where: { roomId: room.id, userId },
      orderBy: { sessionIndex: 'asc' },
    });

    if (existingMembers.length === 0) {
      // 账户不在房间中（可能是邀请加入，也可能是房主的新设备）
      const isOwner = room.ownerId === userId;
      const role = isOwner ? 'owner' : 'viewer';
      const permissions = isOwner ? 'view,chat,edit,agent,download' : 'view,chat';
      const sessionIndex = isOwner ? 0 : existingMembers.length;

      await this.prisma.collaborationMember.create({
        data: {
          roomId: room.id,
          userId,
          role,
          permissions,
          status: 'online',
          deviceType: deviceType ?? 'desktop',
          sessionIndex,
        },
      });
      this.logger.log(`[autoJoin] 用户 ${userId} 首次加入房间 ${room.id} (role=${role})`);
      // 广播成员加入
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'member_joined',
        userId,
        meta: { role, sessionIndex },
      });
    } else {
      // 账户已在房间中（多设备场景）
      // 使用已有成员的角色
      const existingRole = existingMembers[0].role;
      const existingPermissions = existingMembers[0].permissions;
      // 计算新的 sessionIndex
      const maxIndex = Math.max(...existingMembers.map((m) => m.sessionIndex));
      const newSessionIndex = maxIndex + 1;

      // 检查是否超过限制（防止无限创建 session）
      if (newSessionIndex > 9) {
        throw badRequest('COLLAB_DEVICE_LIMIT', 'Device connection limit reached for this account (max 10)');
      }

      await this.prisma.collaborationMember.create({
        data: {
          roomId: room.id,
          userId,
          role: existingRole,
          permissions: existingPermissions,
          status: 'online',
          deviceType: deviceType ?? 'desktop',
          sessionIndex: newSessionIndex,
        },
      });
      this.logger.log(`[autoJoin] 同账户多设备加入: userId=${userId}, role=${existingRole}, 新sessionIndex=${newSessionIndex}`);
      // 广播成员加入（新 session）
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'member_joined',
        userId,
        meta: { role: existingRole, sessionIndex: newSessionIndex },
      });
    }

    return this.getRoomByCanvas(userId, canvasId);
  }

  /**
   * 离开房间
   */
  async leaveRoom(userId: string, canvasId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');

    // 同账户所有 session 都标记为 offline（或仅当前 session）
    const left = await this.prisma.collaborationMember.updateMany({
      where: { roomId: room.id, userId, status: 'online' },
      data: { status: 'offline' },
    });

    // 如果房主的最后一个会话离开，关闭房间（自清理机制：房间关闭 = 邀请码失效）
    const ownerActiveCount = await this.prisma.collaborationMember.count({
      where: { roomId: room.id, userId: room.ownerId, status: 'online' },
    });
    if (ownerActiveCount === 0) {
      await this.prisma.collaborationRoom.update({
        where: { id: room.id },
        data: { status: 'closed' },
      });
      this.logger.log(`房主离开，关闭房间: ${room.id}`);
      // 实时广播房间关闭事件（前端据此显示"协作房间已关闭"）
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'room_closed',
        userId,
      });
    } else {
      // 实时广播成员离开事件
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'member_left',
        userId,
      });
    }

    return { message: '已离开协作房间', affected: left.count };
  }

  /**
   * 获取用户已加入的所有协作房间列表
   */
  async listMyRooms(userId: string) {
    // 查询用户所有房间（包括 offline 状态），避免用户感觉房间"刷新不出来"
    const memberships = await this.prisma.collaborationMember.findMany({
      where: { userId, status: { notIn: ['banned'] } },
      include: {
        room: {
          include: {
            members: {
              include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
            },
          },
        },
      },
    });

    const roomMap = new Map<string, {
      id: string; canvasId: string; mode: string; status: string;
      ownerId: string; ownerName: string | null;
      memberCount: number; lastActiveAt: Date;
    }>();

    for (const m of memberships) {
      const room = m.room;
      if (!room || room.status !== 'active') continue;
      if (roomMap.has(room.id)) continue;

      const owner = room.members.find((mem) => mem.role === 'owner' && mem.userId === room.ownerId);
      roomMap.set(room.id, {
        id: room.id,
        canvasId: room.canvasId,
        mode: room.mode,
        status: room.status,
        ownerId: room.ownerId,
        ownerName: owner?.user?.nickname ?? null,
        memberCount: room.members.filter((mem) => mem.status === 'online').length,
        lastActiveAt: m.lastActiveAt,
      });
    }

    return Array.from(roomMap.values()).sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  /**
   * 转换为响应 DTO
   */
  private toResponse(room: {
    id: string; canvasId: string; ownerId: string; inviteCode: string; inviteLink: string;
    mode: string; status: string; expiresAt: Date | null;
    allowChat: boolean; allowAgentChat: boolean; allowEdit: boolean; allowDownload: boolean;
  }, userId: string) {
    return {
      id: room.id,
      canvasId: room.canvasId,
      ownerId: room.ownerId,
      inviteCode: room.inviteCode,
      inviteLink: room.inviteLink,
      mode: room.mode,
      status: room.status,
      expiresAt: room.expiresAt,
      allowChat: room.allowChat,
      allowAgentChat: room.allowAgentChat,
      allowEdit: room.allowEdit,
      allowDownload: room.allowDownload,
      isOwner: room.ownerId === userId,
    };
  }
}
