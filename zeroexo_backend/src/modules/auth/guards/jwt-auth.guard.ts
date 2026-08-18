import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT 认证守卫 - 校验 Authorization header 中的 access token。
 * 依赖 AuthModule 中注册的 JwtStrategy(策略名 'jwt')。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
