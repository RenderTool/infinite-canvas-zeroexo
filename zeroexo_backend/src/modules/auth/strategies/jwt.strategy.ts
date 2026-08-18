import { Injectable } from '@nestjs/common';
import { unauthorized } from '../../../common/errors/app-exception.js';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * JWT Payload 结构(sub 为用户 id)。
 */
export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
}

function extractJwtFromRequest(req: Request): string | null {
  const bearerToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (bearerToken) return bearerToken;
  return req.query.token as string | null;
}

/**
 * Access Token 策略 - 从 Authorization: Bearer <token> 或 URL 参数 token 提取并校验。
 * 校验通过后,将用户信息挂载到 request.user。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: extractJwtFromRequest,
      ignoreExpiration: false,
      // 密钥已由 jwt.config.ts 集中校验,缺失会导致启动失败,禁止默认密钥兜底
      secretOrKey: configService.getOrThrow<string>('jwt.secret'),
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<{ id: string; email: string; username: string; role: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw unauthorized('AUTH_USER_NOT_FOUND', 'User not found or has been deleted');
    }
    if (user.disabled || user.deletedAt) {
      throw unauthorized('AUTH_ACCOUNT_DISABLED', 'Account has been disabled or deleted, please contact admin');
    }
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };
  }
}
