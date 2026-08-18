import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 当前登录用户信息(由 JwtAuthGuard 验证后挂载到 request.user)。
 * 可传字段名获取单个属性:@CurrentUser('id'),或不传获取整个 user 对象。
 */
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | unknown => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return data ? request.user?.[data] : request.user;
  },
);
