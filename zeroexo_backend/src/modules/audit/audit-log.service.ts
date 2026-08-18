/**
 * 审计日志服务
 *
 * 用于记录敏感操作(角色权限变更、用户角色变更、API Key 重置等)的完整上下文。
 * 与 LogsService 区别:
 * - LogsService 写入内存环形缓冲区(用于实时查看)
 * - AuditLog 写入数据库,保留至少 180 天用于合规追溯
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface AuditLogInput {
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  sensitive?: boolean;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: input.actorId,
          actorName: input.actorName,
          actorRole: input.actorRole,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          before: (input.before as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          after: (input.after as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          ip: input.ip,
          userAgent: input.userAgent,
          sensitive: input.sensitive ?? false,
        },
      });
    } catch (err) {
      // 审计日志失败不应阻塞主业务流程,但必须报错以便发现
      // eslint-disable-next-line no-console
      console.error('[AuditLog] 记录失败', err);
    }
  }

  /** 查询审计日志(供管理页面) */
  async list(query: {
    actorId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    sensitive?: boolean;
    limit?: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.sensitive !== undefined) where.sensitive = query.sensitive;

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
    });
  }
}
