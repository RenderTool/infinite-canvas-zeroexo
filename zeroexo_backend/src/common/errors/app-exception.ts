import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常 - 统一携带稳定错误码 + 英文兜底消息。
 *
 * 响应结构（由全局 AllExceptionsFilter 输出）:
 *   { statusCode, code, message, error, path, timestamp }
 *
 * - code: 稳定错误码(前端按此查 i18n 词条)
 * - message: 英文兜底(前端未知码时展示)
 */
export class AppException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ statusCode: status, code, message }, status);
  }
}

// ===== 便捷工厂,减少样板代码 =====

export function badRequest(code: string, message: string): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, code, message);
}

export function notFound(code: string, message: string): AppException {
  return new AppException(HttpStatus.NOT_FOUND, code, message);
}

export function forbidden(code: string, message: string): AppException {
  return new AppException(HttpStatus.FORBIDDEN, code, message);
}

export function unauthorized(code: string, message: string): AppException {
  return new AppException(HttpStatus.UNAUTHORIZED, code, message);
}

export function conflict(code: string, message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, code, message);
}
