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
   * 返回该画布最新房间(不限状态:active/expired 均返回,便于前端区分"未开启/协作中/已失效")
   * 仅房间成员(或房主)可查看,非成员抛 Forbidden
   */
  async getRoomByCanvas(userId: string, canvasId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId },
      orderBy: { createdAt: 'desc' },
      include: {
        members: {
          include: { user: { select: { id: true, nickname: true, avatarUrl: true, username: true } } },
        },
      },
    });
    if (!room) return null;

    // 越权防护: 请求者必须是房间成员(未被封禁且非待审申请; pending 不算已入房);房主在创建房间时已自动成为成员
    const requesterMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId, status: { notIn: ['banned', 'pending'] } },
      select: { id: true },
    });
    if (!requesterMember) throw forbidden('FORBIDDEN', 'You are not a member of this room');

    return {
      ...this.toResponse(room, userId),
      members: room.members
        .filter((m) => m.status !== 'pending') // 待审申请不混入成员列表（房主走 applications 接口）
        .map((m) => ({
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
      memberCount: room.members.filter((m) => m.status !== 'pending').length,
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
    if (dto.requiresApproval !== undefined) updateData.requiresApproval = dto.requiresApproval;
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
   * 关闭协作房间（软删除：状态置为 expired，房间与成员记录保留，
   * 参与者主页仍能看到该画布并标记为"已失效"）
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
        data: { status: 'expired' },
      }),
    ]);

    this.logger.log(`协作房间已关闭(软删除): ${room.id}`);
    // 实时广播房间关闭事件
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'room_closed',
      userId,
      meta: { ownerId: room.ownerId },
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
   * 验证邀请码（公开端点，Plan#38 Phase 9）
   * 附带邀请落地页展示所需的公开信息：邀请者昵称/头像 + 画布标题。
   * 不返回房间设置/成员列表等敏感字段。
   */
  async verifyInvite(inviteCode: string) {
    const result = await this.inviteService.verifyCode(inviteCode);
    if (!result) throw badRequest('COLLAB_INVITE_INVALID', 'Invalid, expired, or closed invite code');
    const [owner, project] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: result.ownerId },
        select: { nickname: true, username: true, avatarUrl: true },
      }),
      this.prisma.project.findUnique({
        where: { id: result.canvasId },
        select: { title: true },
      }),
    ]);
    return {
      id: result.id,
      canvasId: result.canvasId,
      mode: result.mode,
      status: result.status,
      ownerId: result.ownerId,
      ownerName: owner?.nickname || owner?.username || '用户',
      ownerAvatarUrl: owner?.avatarUrl ?? null,
      canvasTitle: project?.title ?? null,
    };
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

    // Phase 8 审核制：已有待审申请 → 幂等返回 pending（不重复创建）
    const pendingApplication = await this.prisma.collaborationMember.findFirst({
      where: { roomId: verification.id, userId, status: 'pending' },
    });
    if (pendingApplication) {
      return { pending: true, canvasId, roomId: verification.id };
    }

    // 检查是否已在房间中（offline=离屏≠退出，复用既有记录并恢复在线；
    // Plan#38 验收热修：原实现只查 online，offline 成员再次 join 会重复创建 session 记录）
    const joinedMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: verification.id, userId, status: { notIn: ['banned', 'pending'] } },
    });
    if (joinedMember) {
      await this.prisma.collaborationMember.updateMany({
        where: { id: joinedMember.id },
        data: { status: 'online', lastActiveAt: new Date() },
      });
      // 已在房间中，直接返回
      return this.getRoomByCanvas(userId, canvasId);
    }

    // 确定权限 - 房间两档权限模型（Plan#38 Phase 7.2）：
    // 「允许编辑」= editor 角色 + edit + download 捆绑；「只读」= viewer 仅 view；
    // chat 按房间 allowChat 动态组装（替换原死代码：allowEdit 恒不生效）
    const isOwner = verification.ownerId === userId;
    const allowChat = room?.allowChat ?? true;
    const role = isOwner ? 'owner' : room?.allowEdit ? 'editor' : 'viewer';
    const permParts = isOwner
      ? ['view', 'chat', 'edit', 'agent', 'download']
      : [
          'view',
          ...(allowChat ? ['chat'] : []),
          ...(room?.allowEdit ? ['edit', 'download'] : []),
        ];
    const permissions = permParts.join(',');

    // Phase 8 审核制（用户拍板）：房间开启审核且非房主 → 创建待审申请，不入房；
    // 权限预计算随申请落库，批准时直接生效，无需二次计算
    if (room?.requiresApproval && !isOwner) {
      await this.prisma.collaborationMember.create({
        data: {
          roomId: verification.id,
          userId,
          nickname: nickname ?? undefined,
          role,
          permissions,
          status: 'pending',
          deviceType: deviceType ?? 'desktop',
          sessionIndex: 0,
        },
      });
      this.logger.log(`用户 ${userId} 提交加入申请(待审核), 房间 ${verification.id}`);
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'join_application',
        userId,
        meta: { roomId: verification.id },
      });
      return { pending: true, canvasId, roomId: verification.id };
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
      // 权限模型与 joinByInvite 对齐（Plan#38 Phase 7.2）：allowEdit → editor + edit/download 捆绑
      const isOwner = room.ownerId === userId;
      const role = isOwner ? 'owner' : room.allowEdit ? 'editor' : 'viewer';
      const permParts = isOwner
        ? ['view', 'chat', 'edit', 'agent', 'download']
        : [
            'view',
            ...(room.allowChat ? ['chat'] : []),
            ...(room.allowEdit ? ['edit', 'download'] : []),
          ];
      const permissions = permParts.join(',');
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

    // Plan#38 Phase 6.1（用户拍板）：房主离开不再自动关闭房间，邀请链接保持有效；
    // 房间失效仅限三种情况：房主显式关闭(closeRoom) / expiresAt 到期(定时清理) / 注销级联。
    // 实时广播成员离开事件（房主关闭房间的 room_closed 由 closeRoom 负责）
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_left',
      userId,
    });

    return { message: '已离开协作房间', affected: left.count };
  }

  // ==================== 加入审核（Phase 8，用户拍板：需要审核/无需审核两档） ====================

  /**
   * 待审加入申请列表（仅房主）
   */
  async listApplications(userId: string, canvasId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== userId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can view applications');

    const apps = await this.prisma.collaborationMember.findMany({
      where: { roomId: room.id, status: 'pending' },
      include: { user: { select: { id: true, nickname: true, avatarUrl: true, username: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return apps.map((a) => ({
      userId: a.userId,
      nickname: a.nickname ?? (a.user?.nickname || a.user?.username || '用户'),
      avatarUrl: a.user?.avatarUrl ?? null,
      appliedAt: a.joinedAt,
    }));
  }

  /**
   * 批准加入申请（仅房主）：pending → online，权限随申请时预计算值直接生效
   */
  async approveApplication(userId: string, canvasId: string, applicantUserId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== userId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can approve applications');

    const application = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId: applicantUserId, status: 'pending' },
    });
    if (!application) throw notFound('COLLAB_APPLICATION_NOT_FOUND', 'Application not found or already handled');

    await this.prisma.collaborationMember.update({
      where: { id: application.id },
      data: { status: 'online' },
    });
    this.logger.log(`房主 ${userId} 批准用户 ${applicantUserId} 加入房间 ${room.id}`);
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_joined',
      userId: applicantUserId,
      meta: { role: application.role, sessionIndex: application.sessionIndex },
    });
    return { message: '已批准加入' };
  }

  /**
   * 拒绝加入申请（仅房主）：物理删除待审记录（用户可再次申请）
   */
  async rejectApplication(userId: string, canvasId: string, applicantUserId: string) {
    const room = await this.prisma.collaborationRoom.findFirst({
      where: { canvasId, status: 'active' },
    });
    if (!room) throw notFound('COLLAB_ROOM_NOT_FOUND', 'Collaboration room not found');
    if (room.ownerId !== userId) throw forbidden('COLLAB_ROOM_OWNER_REQUIRED', 'Only the room owner can reject applications');

    const removed = await this.prisma.collaborationMember.deleteMany({
      where: { roomId: room.id, userId: applicantUserId, status: 'pending' },
    });
    if (removed.count === 0) throw notFound('COLLAB_APPLICATION_NOT_FOUND', 'Application not found or already handled');
    this.logger.log(`房主 ${userId} 拒绝用户 ${applicantUserId} 的加入申请`);
    return { message: '已拒绝申请' };
  }

  /**
   * 参与者主动移除自己的成员身份（退出协作 / 失效画布移除）
   * 物理删除该用户在该画布**所有房间**内的成员记录，此后主页不再展示该协作画布。
   * 注意：画布可能因"开启→关闭→再开启"存在多个历史房间，若只删最新房间会残留
   * 旧房间成员记录，导致主页列表刷新后画布依然可见。
   */
  async removeSelfFromRoom(userId: string, canvasId: string) {
    const rooms = await this.prisma.collaborationRoom.findMany({
      where: { canvasId },
      select: { id: true },
    });
    if (rooms.length === 0) return { message: 'ok', removed: 0 };

    const removed = await this.prisma.collaborationMember.deleteMany({
      where: { roomId: { in: rooms.map((r) => r.id) }, userId },
    });

    // 广播成员离开（供房主刷新成员列表）
    this.eventsService.broadcastToRoom(canvasId, {
      type: 'member_left',
      userId,
      meta: { removed: true },
    });

    return { message: '已退出协作', removed: removed.count };
  }

  /**
   * 发起者账户注销(软删除)时级联失效其发起的全部协作房间。
   * 仅失效 active 房间(状态置 expired + 在线成员 offline)，并向各房间广播 room_closed，
   * 参与者前端据此显示"协作已失效"并闭环移除。禁用/临时封号不调用此方法(房间保持 active)。
   */
  async expireRoomsByOwner(userId: string) {
    const rooms = await this.prisma.collaborationRoom.findMany({
      where: { ownerId: userId, status: 'active' },
      select: { id: true, canvasId: true },
    });
    if (rooms.length === 0) return { expired: 0 };

    await this.prisma.$transaction([
      this.prisma.collaborationMember.updateMany({
        where: { roomId: { in: rooms.map((r) => r.id) }, status: 'online' },
        data: { status: 'offline' },
      }),
      this.prisma.collaborationRoom.updateMany({
        where: { id: { in: rooms.map((r) => r.id) } },
        data: { status: 'expired' },
      }),
    ]);

    for (const r of rooms) {
      this.eventsService.broadcastToRoom(r.canvasId, {
        type: 'room_closed',
        userId,
        meta: { ownerId: userId },
      });
    }
    this.logger.log(`账户注销级联失效协作房间: userId=${userId}, count=${rooms.length}`);
    return { expired: rooms.length };
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
   * 我拥有的画布 + 各画布最新协作状态（供主页"发起协作"模式/协作状态 Tag 使用）
   * 返回所有自有画布，并附带 collaborationStatus: idle(从未开启/已关闭) | active(协作中)
   */
  async listMyCanvases(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, thumbnailUrl: true, updatedAt: true },
    });
    if (projects.length === 0) return [];

    const rooms = await this.prisma.collaborationRoom.findMany({
      where: { canvasId: { in: projects.map((p) => p.id) } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, canvasId: true, status: true, inviteCode: true,
        members: { select: { id: true, status: true } },
      },
    });
    const latestByCanvas = new Map<string, (typeof rooms)[number]>();
    for (const r of rooms) {
      if (!latestByCanvas.has(r.canvasId)) latestByCanvas.set(r.canvasId, r);
    }

    return projects.map((p) => {
      const room = latestByCanvas.get(p.id);
      const memberCount = room
        ? room.members.filter((m) => m.status === 'online').length
        : 0;
      return {
        canvasId: p.id,
        title: p.title,
        thumbnailUrl: p.thumbnailUrl,
        updatedAt: p.updatedAt,
        collaborationStatus: !room ? 'idle' : room.status === 'active' ? 'active' : 'expired',
        roomId: room?.id ?? null,
        inviteCode: room?.inviteCode ?? null,
        memberCount,
      };
    });
  }

  /**
   * 我参与的协作画布列表（含已失效，供主页展示"协作画布"卡片）
   * 仅返回非房主身份的成员身份；活跃与失效房间均返回，由前端标记状态。
   */
  async listParticipating(userId: string) {
    const memberships = await this.prisma.collaborationMember.findMany({
      where: { userId, status: { not: 'banned' } },
      include: {
        room: {
          include: {
            members: {
              where: { role: 'owner' },
              include: { user: { select: { id: true, nickname: true, username: true, avatarUrl: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: { lastActiveAt: 'desc' },
    });

    const roomMap = new Map<string, {
      roomId: string; canvasId: string; title: string; thumbnailUrl: string | null;
      ownerName: string | null; roomStatus: string; memberCount: number; lastActiveAt: Date;
    }>();

    for (const m of memberships) {
      const room = m.room;
      if (!room || room.ownerId === userId) continue;
      if (roomMap.has(room.id)) continue;

      const ownerMember = room.members[0];
      roomMap.set(room.id, {
        roomId: room.id,
        canvasId: room.canvasId,
        title: '未命名画布',
        thumbnailUrl: null,
        ownerName: ownerMember?.user?.nickname ?? ownerMember?.user?.username ?? null,
        roomStatus: room.status,
        memberCount: 0,
        lastActiveAt: m.lastActiveAt,
      });
    }

    if (roomMap.size === 0) return [];

    // 补充画布标题/封面 + 在线成员数
    const canvasIds = Array.from(roomMap.values()).map((r) => r.canvasId);
    const projects = await this.prisma.project.findMany({
      where: { id: { in: canvasIds } },
      select: { id: true, title: true, thumbnailUrl: true },
    });
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const allRooms = await this.prisma.collaborationRoom.findMany({
      where: { id: { in: Array.from(roomMap.keys()) } },
      include: { members: { select: { status: true } } },
    });
    const onlineByRoom = new Map<string, number>();
    for (const r of allRooms) {
      onlineByRoom.set(r.id, r.members.filter((mm) => mm.status === 'online').length);
    }

    return Array.from(roomMap.values()).map((r) => {
      const project = projectMap.get(r.canvasId);
      return {
        ...r,
        title: project?.title ?? r.title,
        thumbnailUrl: project?.thumbnailUrl ?? r.thumbnailUrl,
        memberCount: onlineByRoom.get(r.roomId) ?? 0,
      };
    });
  }

  /**
   * 转换为响应 DTO
   */
  private toResponse(room: {
    id: string; canvasId: string; ownerId: string; inviteCode: string; inviteLink: string;
    mode: string; status: string; expiresAt: Date | null;
    allowChat: boolean; allowAgentChat: boolean; allowEdit: boolean; allowDownload: boolean;
    requiresApproval?: boolean;
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
      requiresApproval: room.requiresApproval ?? false,
      isOwner: room.ownerId === userId,
    };
  }
}
