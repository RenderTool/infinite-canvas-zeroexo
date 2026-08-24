import { SetMetadata } from '@nestjs/common';

/**
 * Public 路由标记（Plan#38 Phase 9）：
 * 标注在 Controller 方法上，JwtAuthGuard 检测到该元数据时跳过鉴权，
 * 用于未登录可访问的公开端点（如协作邀请验证页）。
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
