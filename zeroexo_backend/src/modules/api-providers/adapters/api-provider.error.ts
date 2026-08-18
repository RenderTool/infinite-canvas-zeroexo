import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * API Provider 适配器统一错误类型
 *
 * 设计目的:
 * - 统一适配器内部抛出的错误,便于 ApiProvidersService / 上层 catch 后转换为合适的 HTTP 响应
 * - 携带 provider / action / status 三个元信息,用于日志聚合与前端展示
 * - 默认映射为 HTTP 502(Bad Gateway),因为大多数情况下是上游第三方服务不可用
 */
export class ApiProviderError extends HttpException {
  /** 错误码(便于程序化处理) */
  public readonly code: string;
  /** 出错的 provider 标识 */
  public readonly provider: string;
  /** 触发的 action 名称 */
  public readonly action: string;
  /** 上游返回的原始错误(若有) */
  public readonly upstream?: unknown;

  constructor(
    message: string,
    options: {
      code?: string;
      provider?: string;
      action?: string;
      upstream?: unknown;
      status?: HttpStatus;
    } = {},
  ) {
    const status = options.status ?? HttpStatus.BAD_GATEWAY;
    super(
      {
        statusCode: status,
        message,
        code: options.code ?? 'API_PROVIDER_ERROR',
        provider: options.provider,
        action: options.action,
      },
      status,
    );
    this.name = 'ApiProviderError';
    this.code = options.code ?? 'API_PROVIDER_ERROR';
    this.provider = options.provider ?? '';
    this.action = options.action ?? '';
    this.upstream = options.upstream;
  }
}
