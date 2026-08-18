/**
 * AI 错误分类与重试工具(P3.5)
 *
 * 错误类型:
 * - AUTH_ERROR        API KEY 无效/过期(401/403)
 * - RATE_LIMIT        限流(429)
 * - NETWORK_ERROR     网络错误(fetch 抛错/超时断开)
 * - PROVIDER_ERROR    Provider 内部错误(5xx)
 * - TIMEOUT           客户端超时(AbortController 触发)
 * - VALIDATION_ERROR  请求参数错误(4xx 非 401/403/429)
 *
 * 重试策略:
 * - NETWORK_ERROR: 重试 3 次,间隔 1s/2s/4s(指数退避)
 * - RATE_LIMIT:    读 Retry-After header,等待后重试(最多 1 次)
 * - PROVIDER_ERROR: 重试 2 次,间隔 2s/4s
 * - 其他: 不重试
 */

/** AI 错误类型 */
export type AiErrorType =
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'VALIDATION_ERROR';

/** AI 错误(含类型分类,供前端展示错误图标) */
export class AiError extends Error {
  readonly errorType: AiErrorType;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(
    errorType: AiErrorType,
    message: string,
    opts?: { statusCode?: number; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AiError';
    this.errorType = errorType;
    this.statusCode = opts?.statusCode;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}

/** 是否可重试的错误类型 */
export function isRetryable(type: AiErrorType): boolean {
  return type === 'NETWORK_ERROR' || type === 'PROVIDER_ERROR' || type === 'RATE_LIMIT';
}

/** 最大重试次数(按错误类型) */
export function maxRetryCount(type: AiErrorType): number {
  if (type === 'NETWORK_ERROR') return 3;
  if (type === 'PROVIDER_ERROR') return 2;
  if (type === 'RATE_LIMIT') return 1;
  return 0;
}

/** 重试间隔(毫秒,按重试次数 index 0-based) */
export function retryDelayMs(type: AiErrorType, attemptIndex: number): number {
  if (type === 'NETWORK_ERROR') {
    // 1s / 2s / 4s
    return 1000 * Math.pow(2, attemptIndex);
  }
  if (type === 'PROVIDER_ERROR') {
    // 2s / 4s
    return 2000 * Math.pow(2, attemptIndex);
  }
  // RATE_LIMIT: 由 retryAfterMs 决定(由调用方处理)
  return 1000;
}

/**
 * 根据错误对象推断 AiErrorType
 * @param err 错误对象
 * @param httpStatus HTTP 状态码(可选,若 err 来自后端响应)
 */
export function classifyError(err: unknown, httpStatus?: number): AiErrorType {
  // 已是 AiError:直接返回
  if (err instanceof AiError) return err.errorType;

  // AbortError(超时)
  if (err instanceof Error && err.name === 'AbortError') return 'TIMEOUT';

  // 有 HTTP 状态码
  if (httpStatus !== undefined) {
    if (httpStatus === 401 || httpStatus === 403) return 'AUTH_ERROR';
    if (httpStatus === 429) return 'RATE_LIMIT';
    if (httpStatus >= 500) return 'PROVIDER_ERROR';
    if (httpStatus >= 400) return 'VALIDATION_ERROR';
  }

  // TypeError 通常是 fetch 网络错误(DNS/连接失败/离线)
  if (err instanceof TypeError) return 'NETWORK_ERROR';

  // 其他默认归类为 Provider 错误
  return 'PROVIDER_ERROR';
}

/** 生成超时时间(毫秒,按 kind) */
export function timeoutMsByKind(kind: 'text' | 'image' | 'video' | 'audio'): number {
  if (kind === 'image') return 60_000;
  if (kind === 'video') return 10 * 60_000; // 10 分钟
  if (kind === 'text') return 120_000; // 2 分钟(分镜/剧本生成需要更长时间)
  if (kind === 'audio') return 60_000;
  return 60_000;
}
