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

    // 越权防护: 请求者必须是房间成员(未被封禁/未退出; pending 待审成员返回待审标记而非 403——
    // 画布页内重进被 SSE 转 pending 后,前端据此展示"等待审核"态(2026-08-25 审核制漏洞修复))
    const requesterMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: room.id, userId, status: { notIn: ['banned', 'left'] } },
      select: { id: true, status: true },
    });
    if (!requesterMember) throw forbidden('FORBIDDEN', 'You are not a member of this room');
    if (requesterMember.status === 'pending') {
      return { pending: true, canvasId, roomId: room.id };
    }

    // 画布标题:参与者本地无 project 元数据,编辑页标题需服务端下发(否则显示"未命名")
    const project = await this.prisma.project.findUnique({
      where: { id: canvasId },
      select: { title: true },
    });

    return {
      ...this.toResponse(room, userId),
      canvasTitle: project?.title ?? null,
      members: room.members
        .filter((m) => m.status !== 'pending' && m.status !== 'left') // 待审申请/已退出不混入成员列表
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
          // 对齐 listMembers：前端编辑页只读判定依赖 isSelf 定位自己
          isSelf: m.userId === userId,
        })),
      memberCount: room.members.filter((m) => m.status !== 'pending' && m.status !== 'left').length,
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
      // 待审申请随房间关闭作废：pending 记录挂在旧房间(roomId)上，重开会新建房间，
      // 若不删会残留"假申请"——房主重开后点通过查无此申请 → 404（2026-08-25 审核制漏洞修复）
      this.prisma.collaborationMember.deleteMany({
        where: { roomId: room.id, status: 'pending' },
      }),
      this.prisma.collaborationMember.updateMany({
        // 关闭房间不得抹掉封禁标记(封禁是画布级最高优先级状态,closeRoom 仅下线正常成员)
        where: { roomId: room.id, status: { not: 'banned' } },
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

    // 检查人数限制(left 已退出不占名额)
    const memberCount = await this.prisma.collaborationMember.count({
      where: { roomId: verification.id, status: { notIn: ['banned', 'left'] } },
    });
    const room = await this.prisma.collaborationRoom.findUnique({ where: { id: verification.id } });
    if (room?.maxMembers && memberCount >= room.maxMembers) {
      throw badRequest('COLLAB_ROOM_FULL', 'Room is already full');
    }

    // 检查是否已被封禁（画布级：房间可能随"开启→关闭→再开启"重建，须跨房间查同一画布的 banned 记录）
    const existingMember = await this.prisma.collaborationMember.findFirst({
      where: { userId, status: 'banned', room: { canvasId } },
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
    // left=曾退出（软删除标记），重进同样走恢复分支；
    // Plan#38 验收热修：原实现只查 online，offline 成员再次 join 会重复创建 session 记录）
    const joinedMember = await this.prisma.collaborationMember.findFirst({
      where: { roomId: verification.id, userId, status: { notIn: ['banned', 'pending'] } },
    });
    if (joinedMember) {
      // 审核制房间：曾退出协作(left)或离屏(offline)的成员重进必须重新申请——
      // 原实现只对 left 审核，offline 直接恢复 online，导致「先协作后开审核」时
      // 旧成员重进绕过审核（2026-08-25 审核制漏洞修复）；复用记录转 pending，
      // 房主批准后 pending→online 直接生效，禁言等权限信息随记录保留
      if ((joinedMember.status === 'left' || joinedMember.status === 'offline') && room?.requiresApproval) {
        await this.prisma.collaborationMember.updateMany({
          where: { id: joinedMember.id },
          data: { status: 'pending', lastActiveAt: new Date() },
        });
        this.logger.log(`用户 ${userId} 重新提交加入申请(${joinedMember.status}, 审核制房间 ${verification.id})`);
        this.eventsService.broadcastToRoom(canvasId, {
          type: 'join_application',
          userId,
          meta: { roomId: verification.id },
        });
        return { pending: true, canvasId, roomId: verification.id };
      }
      // 禁言持久化：禁言 = permissions 移除 chat。退出重进后 status 恢复为
      // muted（无 chat 权限）而非 online，房主端的禁言不会被退出重进绕过
      const canChat = joinedMember.permissions.split(',').includes('chat');
      await this.prisma.collaborationMember.updateMany({
        where: { id: joinedMember.id },
        data: { status: canChat ? 'online' : 'muted', lastActiveAt: new Date() },
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
      try {
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
      } catch (err) {
        // 并发重复提交（连点/多标签页）：唯一约束 (roomId,userId,sessionIndex) 兜底 → 幂等返回 pending
        // （2026-08-25 修复：不捕获会抛 500/冲突，前端误报"邀请码无效"）
        if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002') {
          return { pending: true, canvasId, roomId: verification.id };
        }
        throw err;
      }
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

    // 封禁拦截（画布级,必须提前于所有分支）：banned 记录存在时若走下方"已有记录"分支
    // 会重建 online session 直接入房（封禁绕过漏洞——banned 是最高优先级状态）;
    // 跨房间查询:房间重建后新房间无 banned 记录,须查同一画布的全部房间
    const bannedMember = await this.prisma.collaborationMember.findFirst({
      where: { userId, status: 'banned', room: { canvasId } },
    });
    if (bannedMember) throw forbidden('COLLAB_MEMBER_BANNED', 'You are banned and cannot join');

    // 审核制拦截：待审申请未批准前禁止通过 auto-join 入房——否则下方多设备分支会
    // 复用 pending 记录的 permissions 创建 online session 直接绕过审核（前端未调用
    // autoJoin，但该端点可直接请求，必须服务端兑底）
    const pendingMember = existingMembers.find((m) => m.status === 'pending');
    if (pendingMember) {
      throw forbidden('COLLAB_JOIN_PENDING', 'Your join application is pending approval');
    }

    // 曾退出协作（left 软删除标记）重进：恢复记录而非新建 session——
    // 否则退出→重进会绕过禁言（permissions 无 chat 的成员恢复为 muted 而非 online）
    const leftMember = existingMembers.find((m) => m.status === 'left');
    if (leftMember) {
      // 审核制房间：曾退出成员重进必须重新申请（原实现直接恢复 online 绕过审核）；
      // 复用 left 记录转 pending，批准后 pending→online 直接生效
      if (room.requiresApproval) {
        await this.prisma.collaborationMember.updateMany({
          where: { id: leftMember.id },
          data: { status: 'pending', lastActiveAt: new Date() },
        });
        this.logger.log(`[autoJoin] 审核制房间 ${room.id} 中用户 ${userId} 重新申请(曾退出)`);
        throw forbidden('COLLAB_JOIN_PENDING', 'Your join application is pending approval');
      }
      const canChat = leftMember.permissions.split(',').includes('chat');
      await this.prisma.collaborationMember.updateMany({
        where: { id: leftMember.id },
        data: { status: canChat ? 'online' : 'muted', lastActiveAt: new Date() },
      });
      this.logger.log(`[autoJoin] 退出成员 ${userId} 重新加入房间 ${room.id}`);
      // 广播成员加入（重新加入）
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'member_joined',
        userId,
        meta: { role: leftMember.role, sessionIndex: leftMember.sessionIndex },
      });
      return this.getRoomByCanvas(userId, canvasId);
    }

    // 审核制房间：offline 成员(曾离开画布)重进必须重新申请——否则下方多设备分支会
    // 复用 offline 记录的 role/permissions 创建 online session 直接入房绕过审核
    // （"先协作后开审核"旧成员重进不审核漏洞,与 joinByInvite/SSE 三入口对齐；2026-08-25 审核制漏洞修复）
    const offlineMember = existingMembers.find((m) => m.status === 'offline');
    if (offlineMember && room.requiresApproval && room.ownerId !== userId) {
      await this.prisma.collaborationMember.updateMany({
        where: { id: offlineMember.id },
        data: { status: 'pending', lastActiveAt: new Date() },
      });
      this.logger.log(`[autoJoin] 审核制房间 ${room.id} 中用户 ${userId} 重新申请(曾离屏)`);
      this.eventsService.broadcastToRoom(canvasId, {
        type: 'join_application',
        userId,
        meta: { roomId: room.id },
      });
      throw forbidden('COLLAB_JOIN_PENDING', 'Your join application is pending approval');
    }

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
   * 当前用户所有协作房间的待审申请总数（主页 NAV 红点轮询；仅统计自己为房主的 active 房间）
   */
  async countPendingApplications(userId: string) {
    const count = await this.prisma.collaborationMember.count({
      where: {
        status: 'pending',
        room: { ownerId: userId, status: 'active' },
      },
    });
    return { count };
  }

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

    // 原子翻转（2026-08-25 修复）：findFirst 与 update 分离导致并发/连点批准全部成功——
    // 多次广播 member_joined + 多次成功 toast（用户实测"重复收到 3 次已加入"）。
    // updateMany 带 status='pending' 条件：并发下仅一个请求翻转成功，其余 count=0 → 404
    const flipped = await this.prisma.collaborationMember.updateMany({
      where: { id: application.id, status: 'pending' },
      data: { status: 'online', lastActiveAt: new Date() },
    });
    if (flipped.count === 0) throw notFound('COLLAB_APPLICATION_NOT_FOUND', 'Application not found or already handled');

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
   * 软删除（status 置 left）而非物理删除：退出后保留成员记录与禁言/权限信息，
   * 重新加入时走恢复分支（禁言不因退出重进而失效）；主页/成员列表按 left 过滤。
   * 注意：画布可能因"开启→关闭→再开启"存在多个历史房间，若只删最新房间会残留
   * 旧房间成员记录，导致主页列表刷新后画布依然可见。
   * 守卫：房间 owner 的成员记录不可删除——owner 记录是房间的组成部分，删后
   * getRoomByCanvas 将 403（成员校验失败），协作无法重新开启（曾实测复现）。
   */
  async removeSelfFromRoom(userId: string, canvasId: string) {
    const rooms = await this.prisma.collaborationRoom.findMany({
      where: { canvasId },
      select: { id: true },
    });
    if (rooms.length === 0) return { message: 'ok', removed: 0 };

    const removed = await this.prisma.collaborationMember.updateMany({
      where: {
        roomId: { in: rooms.map((r) => r.id) },
        userId,
        role: { not: 'owner' }, // owner 成员记录不可自删（见上方守卫说明）
        status: { notIn: ['banned', 'left'] }, // banned 最高优先级不可被覆盖;已退出不重复标记
      },
      data: { status: 'left', lastActiveAt: new Date() },
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
    // 查询用户所有房间（包括 offline 状态），避免用户感觉房间"刷新不出来"；
    // left=已退出协作，不再展示
    const memberships = await this.prisma.collaborationMember.findMany({
      where: { userId, status: { notIn: ['banned', 'left'] } },
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
      where: { userId, status: { notIn: ['banned', 'left'] } }, // left=已退出协作,主页不再展示
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
