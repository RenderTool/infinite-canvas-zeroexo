/**
 * LoggingInterceptor - 全局 HTTP 请求日志拦截器(问题11)
 *
 * 自动捕获所有进入应用的 HTTP 请求:
 * - method / URL / 状态码 / 耗时
 * - 已认证请求的 userId / username(从 req.user 读取)
 * - 异常请求记为 error 级
 *
 * 排除路径: /api/docs(Swagger UI)、/admin(日志页面)、健康检查
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { LogsService } from '../../modules/logs/logs.service';

/** 需要排除日志记录的路径前缀 */
const EXCLUDE_PREFIXES = ['/api/docs', '/admin', '/favicon.ico', '/api/storage/get'];

/** 需要排除日志记录的 URL 正则(如心跳等高频请求) */
const EXCLUDE_PATTERNS: RegExp[] = [];

/** 安全用户类型(与 auth.service 的 SafeUser 对齐) */
interface SafeUser {
  id: string;
  username: string;
  email?: string;
  nickname?: string | null;
  role?: string;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logsService: LogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const url = request.url ?? '';
    const method = request.method ?? 'GET';

    // 排除静态资源与文档页
    if (EXCLUDE_PREFIXES.some((p) => url.startsWith(p))) {
      return next.handle();
    }
    // 排除高频请求(心跳等)
    if (EXCLUDE_PATTERNS.some((p) => p.test(url))) {
      return next.handle();
    }

    const startTime = Date.now();
    const user = (request as unknown as { user?: SafeUser }).user;
    const userId = user?.id;
    const username = user?.nickname || user?.username;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const response = context.switchToHttp().getResponse();
          const status = response.statusCode ?? 200;

          // 只记录非 2xx 为 warn/error,避免日志爆炸
          // 同时只记录写入操作(POST/PUT/PATCH/DELETE)和异常,GET 请求不记录
          // (GET 太频繁,会淹没业务日志)
          const isWriteOp = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
          if (!isWriteOp && status < 400) return;

          const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
          const message = `${method} ${url} → ${status} (${duration}ms)`;

          this.logsService.log('http', message, {
            level,
            userId,
            username,
            meta: { method, url, status, duration },
          });
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          const message = `${method} ${url} → ERROR (${duration}ms): ${err?.message ?? String(err)}`;
          this.logsService.log('http', message, {
            level: 'error',
            userId,
            username,
            meta: {
              method,
              url,
              duration,
              errorName: err?.name,
              errorMessage: err?.message,
            },
          });
        },
      }),
    );
  }
}
