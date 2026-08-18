import { Injectable } from '@nestjs/common';
import { unauthorized } from '../../../common/errors/app-exception.js';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JwtPayload } from './jwt.strategy';

/**
 * Refresh Token 策略 - 从请求体 refreshToken 字段提取并校验。
 * 用于 POST /api/auth/refresh,通过 AuthGuard('jwt-refresh') 触发。
 */
@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // 从请求体 body.refreshToken 字段读取
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
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
    // 与 jwt.strategy 对齐: 被禁用/删除的用户拒绝刷新令牌
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
