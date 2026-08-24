/**
 * collaboration-sse.guard - 协作 SSE 端点专用守卫
 *
 * 校验 JWT 身份 + 确认用户是该画布协作房间的活跃成员。
 * 从 URL query 参数 `token` 或 Authorization header 中提取 JWT 直接验证签名，
 * 不依赖 AuthModule/Passport，避免 cyclic dependency。
 *
 * 同时限制每用户每房间最多 5 个 SSE 连接，防止连接耗尽。
 */

import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unauthorized, forbidden, badRequest } from '../../common/errors/app-exception.js';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';

@Injectable()
export class CollaborationSseGuard implements CanActivate {
  private readonly logger = new Logger(CollaborationSseGuard.name);
  private readonly secret: string;

  /** 每用户每房间 SSE 连接数上限 */
  private static readonly MAX_SSE_PER_ROOM = 5;

  /** 活跃 SSE 连接计数: key=`userId:canvasId` → count */
  private static readonly sseConnectionCounts = new Map<string, number>();

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.secret = configService.getOrThrow<string>('jwt.secret');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token =
      (req.headers.authorization as string)?.replace('Bearer ', '') ||
      (req.query.token as string);

    if (!token) {
      throw unauthorized('UNAUTHORIZED', 'token is missing');
    }

    let payload: Record<string, unknown>;
    try {
      payload = jwt.verify(token, this.secret) as Record<string, unknown>;
    } catch {
      throw unauthorized('UNAUTHORIZED', 'token is invalid or expired');
    }

    const userId = payload.sub as string;
    req.user = {
      id: userId,
      email: payload.email as string,
      username: payload.username as string,
      role: payload.role as string,
    };

    // 校验用户是该画布协作房间的活跃成员（非 offline / banned）
    const canvasId = (req.params as Record<string, string>).canvasId as string;
    if (canvasId) {
      const room = await this.prisma.collaborationRoom.findFirst({
        where: { canvasId, status: 'active' },
      });
      if (!room) throw unauthorized('UNAUTHORIZED', 'collaboration room not found');

      const member = await this.prisma.collaborationMember.findFirst({
        // offline=离屏≠退出（Plan#38 验收热修）：重进画布的成员必须允许重建 SSE，
        // 否则协作活性永远无法恢复（SSE 403 → active=false → 无光标/无协作态）；
        // 与 getRoomByCanvas/canvas.service/listMembers 的放行口径对齐（banned/pending 除外）
        where: { roomId: room.id, userId, status: { notIn: ['banned', 'pending'] } },
      });
      if (!member) {
        throw forbidden('FORBIDDEN', 'You are not an active member of this room');
      }

      // SSE 连接数限制
      const key = `${userId}:${canvasId}`;
      const currentCount = CollaborationSseGuard.sseConnectionCounts.get(key) ?? 0;
      if (currentCount >= CollaborationSseGuard.MAX_SSE_PER_ROOM) {
        this.logger.warn(`[SSE_LIMIT] 用户 ${userId} 在房间 ${canvasId} 的 SSE 连接数已达上限 (${CollaborationSseGuard.MAX_SSE_PER_ROOM})`);
        throw badRequest('SSE_CONNECTION_LIMIT', `SSE 连接数已达上限 (${CollaborationSseGuard.MAX_SSE_PER_ROOM} 个)`);
      }
    }

    return true;
  }

  /** 注册一个 SSE 连接（由 controller 在连接建立时调用） */
  static incrementConnection(userId: string, canvasId: string): void {
    const key = `${userId}:${canvasId}`;
    const current = CollaborationSseGuard.sseConnectionCounts.get(key) ?? 0;
    CollaborationSseGuard.sseConnectionCounts.set(key, current + 1);
  }

  /** 注销一个 SSE 连接（由 controller 在连接关闭时调用） */
  static decrementConnection(userId: string, canvasId: string): void {
    const key = `${userId}:${canvasId}`;
    const current = CollaborationSseGuard.sseConnectionCounts.get(key) ?? 0;
    if (current <= 1) {
      CollaborationSseGuard.sseConnectionCounts.delete(key);
    } else {
      CollaborationSseGuard.sseConnectionCounts.set(key, current - 1);
    }
  }
}
