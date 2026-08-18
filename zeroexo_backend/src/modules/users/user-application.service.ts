import { Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LogsService } from '../logs/logs.service';

interface ApplyDto {
  type: string;
  reason?: string;
}

@Injectable()
export class UserApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logsService: LogsService,
  ) {}

  /**
   * 已登录用户申请角色升级（admin / operator），需管理员审核
   */
  async createApplication(userId: string, dto: ApplyDto) {
    const { type, reason } = dto;

    if (type !== 'admin' && type !== 'operator') {
      throw badRequest('USER_APPLICATION_INVALID', 'Invalid application type');
    }

    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) {
      throw badRequest('USER_NOT_FOUND', 'User not found');
    }
    if (currentUser.role === 'super_admin') {
      throw badRequest('CONFLICT', 'You are already a super administrator, no need to apply');
    }
    if (currentUser.role === type) {
      throw badRequest('CONFLICT', `You are already an ${type === 'admin' ? 'administrator' : 'operator'}, no need to apply again`);
    }

    const existingApp = await this.prisma.userApplication.findFirst({
      where: { email: currentUser.email, status: 'pending' },
    });
    if (existingApp) {
      throw conflict('USER_APPLICATION_PENDING', 'You already have a pending application, please wait for the review result');
    }

    // 若上次申请被拒绝，允许重新提交
    const lastRejected = await this.prisma.userApplication.findFirst({
      where: { email: currentUser.email, status: 'rejected' },
      orderBy: { createdAt: 'desc' },
    });
    if (lastRejected) {
      // 删除旧被拒记录，避免 history 堆积
      await this.prisma.userApplication.delete({ where: { id: lastRejected.id } });
    }

    const application = await this.prisma.userApplication.create({
      data: {
        email: currentUser.email,
        username: currentUser.username,
        passwordHash: '',
        nickname: currentUser.nickname,
        type,
        reason: reason || undefined,
        status: 'pending',
      },
      select: {
        id: true, email: true, username: true, nickname: true,
        type: true, reason: true, status: true, createdAt: true,
      },
    });

    this.logsService.log('auth', `角色升级申请: ${type} - ${currentUser.username}`, {
      userId: currentUser.id, username: currentUser.username, meta: { type, reason },
    });

    return { message: '申请已提交，请等待管理员审核', application };
  }

  /**
   * 查询当前用户的申请状态
   */
  async getApplicationStatus(email: string) {
    const application = await this.prisma.userApplication.findFirst({
      where: { email },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, type: true, reason: true, status: true, createdAt: true,
        approvedBy: true, approvedAt: true,
      },
    });
    return { application: application || null };
  }

  async listApplications(query?: { username?: string; email?: string; status?: string }) {
    const where: any = {};
    if (query?.username) { where.username = { contains: query.username }; }
    if (query?.email) { where.email = { contains: query.email }; }
    if (query?.status) { where.status = query.status; }

    const applications = await this.prisma.userApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { items: applications };
  }

  /**
   * 角色等级映射(用于审批时校验目标角色不得高于操作人)
   */
  private roleLevel(role: string): number {
    switch (role) {
      case 'super_admin': return 3;
      case 'admin': return 2;
      case 'operator': return 1;
      default: return 0; // user
    }
  }

  /**
   * 批准角色升级申请
   * - targetRole 仅允许 'admin'/'operator'(与 createApplication 申请逻辑一致)
   * - 目标角色等级不得高于操作人角色(admin 不能批准 super_admin,operator 无权审批)
   */
  async approveApplication(id: string, approvedBy: string, operatorRole: string, targetRole?: string) {
    const application = await this.prisma.userApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw badRequest('NOT_FOUND', 'Application not found');
    }

    // 如果已有 approved/rejected 状态，仍然允许覆盖（重新批准）
    const role = targetRole || (application.type === 'admin' ? 'admin' : application.type === 'operator' ? 'operator' : 'user');
    // 安全校验: 目标角色只允许 admin/operator,且等级不得高于操作人
    if (role !== 'admin' && role !== 'operator') {
      throw badRequest('USER_APPLICATION_INVALID', 'Invalid target role: only admin/operator can be approved');
    }
    if (this.roleLevel(role) > this.roleLevel(operatorRole)) {
      throw forbidden('USER_PERMISSION_DENIED', 'Cannot approve a role higher than your own role');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: application.email },
    });

    if (existingUser) {
      // 已有用户：直接升级角色（使用指定的 role 或默认映射）
      const user = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: { role },
        select: {
          id: true,
          email: true,
          username: true,
          nickname: true,
          role: true,
          createdAt: true,
        },
      });

      await this.prisma.userApplication.update({
        where: { id },
        data: {
          status: 'approved',
          approvedBy,
          approvedAt: new Date(),
        },
      });

      this.logsService.log('auth', `角色升级已批准: ${application.type} - ${user.username}`, {
        userId: user.id,
        username: user.username,
        meta: { approvedBy, oldRole: existingUser.role, newRole: role },
      });

      return {
        message: '角色升级已批准',
        user,
      };
    }

    // 新用户：创建账户
    const conflictUser = await this.prisma.user.findFirst({
      where: { OR: [{ email: application.email }, { username: application.username }] },
    });
    if (conflictUser) {
      throw conflict('USER_EMAIL_TAKEN', 'Email or username is already taken');
    }

    const user = await this.prisma.user.create({
      data: {
        email: application.email,
        username: application.username,
        passwordHash: application.passwordHash,
        nickname: application.nickname,
        role,
      },
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
        role: true,
        createdAt: true,
      },
    });

    await this.prisma.userApplication.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy,
        approvedAt: new Date(),
      },
    });

    this.logsService.log('auth', `申请已批准: ${application.type} - ${user.username}`, {
      userId: user.id,
      username: user.username,
      meta: { approvedBy },
    });

    return {
      message: '申请已批准，用户已创建',
      user,
    };
  }

  async rejectApplication(id: string, approvedBy: string) {
    const application = await this.prisma.userApplication.findUnique({
      where: { id },
    });
    if (!application) {
      throw badRequest('NOT_FOUND', 'Application not found');
    }

    await this.prisma.userApplication.update({
      where: { id },
      data: {
        status: 'rejected',
        approvedBy,
        approvedAt: new Date(),
      },
    });

    this.logsService.log('auth', `申请已拒绝: ${application.type} - ${application.username}`, {
      meta: { approvedBy },
    });

    return { message: '申请已拒绝' };
  }

  async deleteApplication(id: string) {
    await this.prisma.userApplication.delete({
      where: { id },
    });
    return { message: '申请已删除' };
  }
}