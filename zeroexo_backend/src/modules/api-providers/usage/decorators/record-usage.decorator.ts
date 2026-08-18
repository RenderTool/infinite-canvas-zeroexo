import { SetMetadata } from '@nestjs/common';
import { UsageWindow } from '../api-usage.service';

/** @RecordUsage 元数据 key */
export const RECORD_USAGE_KEY = 'record-usage:options';

/**
 * RecordUsage 装饰器选项
 */
export interface RecordUsageOptions {
  /** 用量指标(默认 request) */
  metric?: string;
  /** 时间窗口(默认 hour) */
  window?: UsageWindow;
  /**
   * 用量取值方式:
   * - 固定值: number
   * - 从方法返回值取:  { fromResult: 'data.tokens' }  使用 lodash get 风格路径
   * - 从参数取:  { fromArgs: 'providerId' }           取 args[0] / args[1] 等
   */
  value?:
    | number
    | { fromResult: string }
    | { fromArgs: string };
  /**
   * providerId 取值方式:
   * - 固定值
   * - 从参数取: { fromArgs: 0 }   (默认取 args[0])
   */
  providerId?:
    | string
    | { fromArgs: number };
  /**
   * modelId 取值方式（可空，用于按模型计价）:
   * - 固定值
   * - 从方法返回值取: { fromResult: 'data.model' }
   * - 从参数取: { fromArgs: 1 }
   */
  modelId?:
    | string
    | { fromResult: string }
    | { fromArgs: number };
}

/**
 * @RecordUsage 方法装饰器
 *
 * 装饰任意 service 方法,调用结束后自动向 ApiUsageService 写一条用量。
 * 适合业务侧"完成一次调用就计 1 次"的场景。
 *
 * 用法:
 * ```ts
 * @RecordUsage({ metric: 'token', window: 'day' })
 * async generateText(@Args('providerId') providerId: string, prompt: string) {
 *   // ...
 * }
 *
 * @RecordUsage({ providerId: { fromArgs: 0 }, value: { fromResult: 'usage.total_tokens' } })
 * async callOpenAI(providerId: string, params: any) { return { usage: { total_tokens: 100 } } }
 * ```
 */
export const RecordUsage = (options: RecordUsageOptions = {}): MethodDecorator => {
  return SetMetadata(RECORD_USAGE_KEY, options);
};
