import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Request } from 'express';

/**
 * 全局响应转换拦截器 - 统一成功响应格式为 { data: T }。
 * 异常由 AllExceptionsFilter 处理,不走此拦截器的 map。
 *
 * 排除 SSE 端点(/api/sync-events),避免 Observable 流被 map 破坏。
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, { data: T }>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ data: T }> {
    // 排除 SSE 端点,避免破坏 Observable 流
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path.startsWith('/api/sync-events') || request.path.startsWith('/api/ai-events') || request.path.includes('/think/stream')) {
      return next.handle() as Observable<{ data: T }>;
    }
    return next.handle().pipe(map((data: T) => ({ data })));
  }
}
