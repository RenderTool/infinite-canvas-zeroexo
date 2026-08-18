/**
 * collaboration-sse.guard - 协作 SSE 端点专用守卫
 *
 * 校验 JWT 身份 + 确认用户是该画布协作房间的活跃成员。
 * 从 URL query 参数 `token` 或 Authorization header 中提取 JWT 直接验证签名，
 * 不依赖 AuthModule/Passport，避免 cyclic dependency。
 */

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { unauthorized, forbidden } from '../../common/errors/app-exception.js';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';

@Injectable()
export class CollaborationSseGuard implements CanActivate {
  private readonly secret: string;

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
        where: { roomId: room.id, userId, status: { notIn: ['offline', 'banned'] } },
      });
      if (!member) {
        throw forbidden('FORBIDDEN', 'You are not an active member of this room');
      }
    }

    return true;
  }
}
