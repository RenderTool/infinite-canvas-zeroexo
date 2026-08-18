import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * 全局异常过滤器 - 统一错误响应格式:
 * { statusCode, code, message, error, path, timestamp }
 *
 * code: 稳定错误码(优先取自 AppException 的 response.code;否则按 status 映射通用码)
 * message: 英文兜底(前端按 code 翻译,未知码回退此字段)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttp ? exception.getResponse() : null;
    const message = this.resolveMessage(exceptionResponse, exception);
    const code = this.resolveCode(exceptionResponse, status);

    const errorResponse = {
      statusCode: status,
      code,
      message,
      error: HttpStatus[status] ?? 'Error',
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url}`,
        (exception as Error)?.stack ?? String(exception),
      );
    } else {
      this.logger.warn(`[${request.method}] ${request.url} -> ${status}`);
    }

    response.status(status).json(errorResponse);
  }

  // 解析异常 message,兼容 string / {message} / {message:[]} 形式
  private resolveMessage(
    exceptionResponse: unknown,
    exception: unknown,
  ): string | string[] {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }
    if (exceptionResponse && typeof exceptionResponse === 'object') {
      const msg = (exceptionResponse as { message?: unknown }).message;
      if (Array.isArray(msg)) {
        return msg as string[];
      }
      if (typeof msg === 'string') {
        return msg;
      }
    }
    return (exception as Error)?.message ?? 'Internal server error';
  }

  // 解析稳定错误码:优先取 response.code;缺失时按 status 映射通用码
  private resolveCode(exceptionResponse: unknown, status: number): string {
    if (exceptionResponse && typeof exceptionResponse === 'object') {
      const code = (exceptionResponse as { code?: unknown }).code;
      if (typeof code === 'string' && code) {
        return code;
      }
    }
    if (status >= 500) return 'INTERNAL_SERVER_ERROR';
    const map: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    };
    return map[status] ?? 'BAD_REQUEST';
  }
}
