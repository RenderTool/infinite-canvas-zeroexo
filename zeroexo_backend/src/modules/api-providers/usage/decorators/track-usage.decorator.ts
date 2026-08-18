import { SetMetadata } from '@nestjs/common';
import { UsageWindow } from '../api-usage.service';

/** @TrackUsage 元数据 key */
export const TRACK_USAGE_KEY = 'track-usage:options';

/**
 * @TrackUsage 装饰器选项
 *
 * 区别于 @RecordUsage(方法级,需要 service 主动调用):
 * - @TrackUsage 用在 Controller 路由上,只要请求进来就算一次用量
 * - 必须配合 @UseGuards(UsageTrackerGuard) 使用,Guard 读取元数据并执行记录
 */
export interface TrackUsageOptions {
  /** 用量指标(默认 request) */
  metric?: string;
  /** 时间窗口(默认 hour) */
  window?: UsageWindow;
  /** providerId 解析方式:从 body.params / query / body 取 */
  providerIdSource?: 'body' | 'query' | 'params' | 'body.providerId' | 'body.params.providerId';
  /**
   * 用量值: 固定数值(默认 1)
   * - number: 固定值
   * - 'tokens':从 body.tokens 读取
   * - 'cost':从 body.cost 读取
   */
  value?: number | 'tokens' | 'cost' | 'body.value';
}

/**
 * @TrackUsage 装饰器 - 用于 Controller 路由
 *
 * 配合 UsageTrackerGuard 使用:
 * ```ts
 * @UseGuards(JwtAuthGuard, UsageTrackerGuard)
 * @TrackUsage({ metric: 'request', window: 'hour', providerIdSource: 'body.providerId' })
 * @Post('generate')
 * async generate(@Body() dto: GenerateDto) { ... }
 * ```
 */
export const TrackUsage = (options: TrackUsageOptions = {}): MethodDecorator => {
  return SetMetadata(TRACK_USAGE_KEY, options);
};
