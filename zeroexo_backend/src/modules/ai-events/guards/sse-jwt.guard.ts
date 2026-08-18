/**
 * sse-jwt.guard - SSE/EventSource 端点专用 JWT 验证守卫
 *
 * 从 URL query 参数 `token` 或 Authorization header 中提取 JWT 并直接验证签名。
 * 不依赖 AuthModule/Passport，避免 cyclic dependency。
 */

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { unauthorized } from '../../../common/errors/app-exception.js';
import * as jwt from 'jsonwebtoken';
import type { Request } from 'express';

@Injectable()
export class SseJwtGuard implements CanActivate {
  private readonly secret: string;

  constructor(configService: ConfigService) {
    this.secret = configService.getOrThrow<string>('jwt.secret');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token =
      (req.headers.authorization as string)?.replace('Bearer ', '') ||
      (req.query.token as string);

    if (!token) {
      throw unauthorized('UNAUTHORIZED', 'token is missing');
    }

    try {
      const payload = jwt.verify(token, this.secret) as Record<string, unknown>;
      req.user = {
        id: payload.sub as string,
        email: payload.email as string,
        username: payload.username as string,
        role: payload.role as string,
      };
      return true;
    } catch {
      throw unauthorized('UNAUTHORIZED', 'token is invalid or expired');
    }
  }
}
