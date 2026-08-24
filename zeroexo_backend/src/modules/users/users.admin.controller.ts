import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { forbidden } from '../../common/errors/app-exception.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ResourceService } from '../assets/resource.service';
import { MinioService } from '../assets/minio.service';
import { PlanService } from '../billing/plan.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import {
  LongThrottle,
  MediumThrottle,
  RegisterThrottle,
} from '../../common/throttler/decorators/throttle.decorator';
import * as bcrypt from 'bcryptjs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * 回收站保留天数:30 天后自动永久删除
 */
const RECYCLE_BIN_RETENTION_DAYS = 30;

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resourceService: ResourceService,
    private readonly minioService: MinioService,
    private readonly planService: PlanService,
    private readonly collaborationService: CollaborationService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @MediumThrottle()
  async listUsers(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('username') username?: string,
    @Query('email') email?: string,
    @Query('role') role?: string,
    @Query('disabled') disabled?: string,
  ) {
    const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const where: any = { deletedAt: null };
    if (username) where.username = { contains: username };
    if (email) where.email = { contains: email };
    if (role) {
      where.role = role;
    } else {
      // 默认不显示系统账户（role=system 是概念账户，非真实用户）
      where.role = { not: 'system' };
    }
    if (disabled !== undefined) {
      where.disabled = disabled === 'true';
    }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        take,
        skip,
        select: {
          id: true,
          email: true,
          username: true,
          nickname: true,
          role: true,
          disabled: true,
          emailVerified: true,
          planCode: true,
          planExpiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    // 主管理员(super_admin)始终置顶
    users.sort((a, b) => {
      if (a.role === 'super_admin' && b.role !== 'super_admin') return -1;
      if (a.role !== 'super_admin' && b.role === 'super_admin') return 1;
      return 0;
    });
    return { items: users, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
  }

  @Get('roles')
  @HttpCode(HttpStatus.OK)
  async getRoles() {
    return { roles: ['user', 'operator', 'admin', 'super_admin'] };
  }

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  async getStats() {
    const total = await this.prisma.user.count({
      where: { deletedAt: null },
    });
    return { total };
  }

  /** 回收站:已软删除的用户列表（分页） */
  @Get('recycle-bin')
  @HttpCode(HttpStatus.OK)
  async listRecycleBin(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const take = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { deletedAt: { not: null } },
        take,
        skip,
        select: {
          id: true,
          email: true,
          username: true,
          nickname: true,
          role: true,
          createdAt: true,
          deletedAt: true,
        },
        orderBy: { deletedAt: 'desc' },
      }),
      this.prisma.user.count({ where: { deletedAt: { not: null } } }),
    ]);

    const now = Date.now();
    const items = users.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      nickname: u.nickname,
      role: u.role,
      createdAt: u.createdAt,
      deletedAt: u.deletedAt,
      /** 剩余保留天数(整数,向下取整) */
      remainingDays: Math.max(
        0,
        RECYCLE_BIN_RETENTION_DAYS -
          Math.floor((now - u.deletedAt!.getTime()) / (24 * 60 * 60 * 1000)),
      ),
    }));
    return { items, total, page: Math.max(Number(page) || 1, 1), pageSize: take };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        deletedAt: true,
      },
    });
    if (!user) {
      throw new Error('用户不存在');
    }
    return user;
  }

  // 角色等级: 数字越大权限越高
  private readonly ROLE_LEVEL: Record<string, number> = {
    user: 1,
    operator: 2,
    admin: 3,
    super_admin: 4,
  };

  private readonly ALL_ROLES = ['user', 'operator', 'admin', 'super_admin'];

  /**
   * 校验: 仅当请求者角色等级高于目标角色等级时通过
   */
  private assertCanModify(targetRole: string, reqUserRole: string, action: string): void {
    const reqLevel = this.ROLE_LEVEL[reqUserRole] ?? 0;
    const targetLevel = this.ROLE_LEVEL[targetRole] ?? 0;
    if (reqLevel <= targetLevel) {
      throw forbidden('FORBIDDEN', `Insufficient permissions to ${action} an account of the same or higher privilege level`);
    }
  }

  /**
   * 校验: 仅当请求者角色等级高于创建的角色等级时允许
   */
  private assertCanCreate(targetRole: string, reqUserRole: string): void {
    const reqLevel = this.ROLE_LEVEL[reqUserRole] ?? 0;
    const targetLevel = this.ROLE_LEVEL[targetRole] ?? 0;
    if (reqLevel <= targetLevel) {
      throw forbidden('FORBIDDEN', 'Insufficient permissions to create an account of the same or higher privilege level');
    }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RegisterThrottle()
  async createUser(
    @Body() body: { username: string; email: string; password: string; nickname?: string; role?: string },
    @Request() req: any,
  ) {
    const { username, email, password, nickname, role = 'user' } = body;

    if (!this.ALL_ROLES.includes(role)) {
      throw new Error('无效的角色');
    }

    // 仅允许创建低等级角色
    this.assertCanCreate(role, req.user?.role);

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      throw new Error('邮箱或用户名已存在');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        nickname,
        role,
      },
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        disabled: true,
        createdAt: true,
      },
    });
    return user;
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async updateUser(
    @Param('id') id: string,
    @Body()
    body: {
      username?: string;
      email?: string;
      nickname?: string;
      role?: string;
      disabled?: boolean;
      /** 会员分组 code（null/空字符串 = 回退免费） */
      planCode?: string | null;
      /** 会员分组到期时间（ISO 字符串，指定分组时必填且须晚于当前时间） */
      planExpiresAt?: string | null;
    },
    @Request() req: any,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, disabled: true },
    });
    if (!target) {
      throw new Error('用户不存在');
    }

    // 越权校验：仅当操作者非本人时，要求操作者等级严格高于目标等级。
    // 本人修改本人允许（如改昵称/订阅），但仍受下方角色变更等级校验约束，无法借机提权。
    if (req.user?.id !== target.id) {
      this.assertCanModify(target.role, req.user?.role, '修改');
    }

    const { role, planCode, planExpiresAt, ...rest } = body;

    // 仅高权限可修改低权限的角色
    if (role !== undefined) {
      if (!this.ALL_ROLES.includes(role)) {
        throw new Error('无效的角色');
      }
      this.assertCanCreate(role, req.user?.role);
    }

    // 防止移除最后一个 super_admin
    if (role !== undefined && role !== 'super_admin' && target.role === 'super_admin') {
      const superAdminCount = await this.prisma.user.count({ where: { role: 'super_admin', deletedAt: null } });
      if (superAdminCount <= 1) {
        throw forbidden('USER_LAST_ADMIN_REMOVE', 'Cannot remove the last super administrator');
      }
    }

    // 防止禁用最后一位 super_admin
    if (body.disabled === true && target.role === 'super_admin') {
      const superAdminCount = await this.prisma.user.count({ where: { role: 'super_admin', deletedAt: null } });
      if (superAdminCount <= 1) {
        throw forbidden('USER_LAST_ADMIN_DISABLE', 'Cannot disable the last super administrator');
      }
      throw forbidden('FORBIDDEN', 'Cannot disable a super administrator account');
    }

    // 会员分组指定（未传则跳过）
    if (planCode !== undefined || planExpiresAt !== undefined) {
      await this.applyPlanAssignment(id, planCode ?? null, planExpiresAt ?? null);
    }

    const data: any = { ...rest };
    if (role !== undefined) {
      data.role = role;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        disabled: true,
        planCode: true,
        planExpiresAt: true,
        createdAt: true,
      },
    });
    return user;
  }

  /**
   * 管理后台手动指定/清除会员分组
   * - planCode 为空 → 回退免费（取消 active 订阅，清空快照）
   * - planCode 有效 → 校验计划启用、到期时间有效后授予订阅（复用 PlanService）
   */
  private async applyPlanAssignment(userId: string, planCode: string | null, planExpiresAtRaw: string | null) {
    if (!planCode) {
      await this.planService.resetToFree(userId);
      return;
    }

    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode },
      select: { id: true, enabled: true },
    });
    if (!plan) {
      throw new Error('无效的会员分组');
    }
    if (!plan.enabled) {
      throw new Error('该会员分组已停用');
    }

    const expiresAt = planExpiresAtRaw ? new Date(planExpiresAtRaw) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error('请设置有效的到期时间');
    }

    await this.planService.grantSubscription(userId, plan.id, { expiresAt });
  }

  /**
   * 软删除用户(放入回收站)。
   * 不删除关联数据,仅标记 deletedAt。
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @LongThrottle()
  async deleteUser(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, deletedAt: true },
    });
    if (!target) {
      throw new Error('用户不存在');
    }
    if (target.deletedAt) {
      throw new Error('用户已在回收站中');
    }

    // 仅高权限可删除低权限
    this.assertCanModify(target.role, req.user?.role, '删除');

    // 防止删除最后一个 super_admin
    if (target.role === 'super_admin') {
      const superAdminCount = await this.prisma.user.count({ where: { role: 'super_admin', deletedAt: null } });
      if (superAdminCount <= 1) {
        throw forbidden('USER_LAST_ADMIN_DELETE', 'Cannot delete the last super administrator');
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), disabled: true },
    });

    // 注销级联：发起者账户注销 → 其发起的协作房间置为"已失效"并广播 room_closed，
    // 参与者前端据此显示失效闭环移除。级联失败不阻塞注销主流程，仅记录日志。
    await this.collaborationService.expireRoomsByOwner(id).catch((err: unknown) => {
      this.logger.warn(`[deleteUser] 级联失效协作房间失败 userId=${id}: ${err instanceof Error ? err.message : String(err)}`);
    });

    return { message: '用户已移入回收站(保留30天)' };
  }

  /**
   * 从回收站恢复用户。
   */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restoreUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!user) {
      throw new Error('用户不存在');
    }
    if (!user.deletedAt) {
      throw new Error('用户不在回收站中');
    }
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null, disabled: false },
    });
    return { message: '用户已恢复' };
  }

  /**
   * 永久删除用户(从回收站彻底清除)。
   * 清理所有关联资源后,Prisma cascade 删除 DB 记录。
   */
  @Delete('recycle-bin/:id')
  @HttpCode(HttpStatus.OK)
  async permanentDeleteUser(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, deletedAt: true, role: true },
    });
    if (!user) {
      throw new Error('用户不存在');
    }
    if (!user.deletedAt) {
      throw new Error('只有回收站中的用户可以永久删除');
    }

    // 仅高权限可永久删除低权限
    this.assertCanModify(user.role, req.user?.role, '永久删除');

    // 防止永久删除最后一个 super_admin
    if (user.role === 'super_admin') {
      const superAdminCount = await this.prisma.user.count({ where: { role: 'super_admin', deletedAt: null } });
      if (superAdminCount <= 1) {
        throw forbidden('USER_LAST_ADMIN_DELETE', 'Cannot permanently delete the last super administrator');
      }
    }

    await this.cleanupUserResources(id);

    await this.prisma.user.delete({ where: { id } });

    this.logger.log(`用户"${user.username}"(${id})已永久删除`);
    return { message: '用户已永久删除,所有关联数据已清理' };
  }

  /** 内部:清理用户关联的所有资源文件 */
  private async cleanupUserResources(userId: string): Promise<void> {
    // 1. 获取所有 Asset → 递减 Resource refCount
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: userId },
      select: { storageKey: true },
    });
    const storageKeys = assets.map((a) => a.storageKey).filter(Boolean);
    for (const key of storageKeys) {
      await this.resourceService.decrementRef(key);
    }

    // 2. 删除画布快照文件
    const projects = await this.prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true, ownerId: true },
    });
    const storageRoot = this.minioService.getStorageRoot();
    for (const project of projects) {
      const snapshotDir = path.join(storageRoot, 'resources', 'front', 'canvases', project.ownerId, project.id);
      try {
        await fs.rm(snapshotDir, { recursive: true, force: true });
      } catch {
        // 文件不存在则忽略
      }
    }

    this.logger.log(
      `清理用户资源完成: assets=${storageKeys.length}, projects=${projects.length}`,
    );
  }
}
