import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiUsageService, UsageWindow } from '../api-usage.service';
import {
  TrackUsageOptions,
  TRACK_USAGE_KEY,
} from '../decorators/track-usage.decorator';

/**
 * 从 request 中按路径提取 providerId
 * - body.*      -> request.body.path
 * - query.*     -> request.query.path
 * - params.*    -> request.params.path
 * - 直接字符串  -> 视为顶级 key(body / query / params 优先级)
 */
function extractProviderId(
  source: TrackUsageOptions['providerIdSource'],
  req: Request,
): string | null {
  if (!source) {
    return null;
  }
  if (source === 'body') {
    const v = (req as any).body?.providerId;
    return typeof v === 'string' ? v : null;
  }
  if (source === 'query') {
    const v = (req as any).query?.providerId;
    return typeof v === 'string' ? v : null;
  }
  if (source === 'params') {
    const v = (req as any).params?.providerId;
    return typeof v === 'string' ? v : null;
  }
  // 'body.x.y' / 'body.params.providerId' / 'query.x' / 'params.x'
  const [root, ...rest] = source.split('.');
  let cur: any = (req as any)[root];
  for (const p of rest) {
    if (cur === null || cur === undefined) return null;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : null;
}

/**
 * 提取 value
 */
function extractValue(
  raw: TrackUsageOptions['value'],
  req: Request,
): number {
  if (raw === undefined) return 1;
  if (typeof raw === 'number') return raw;
  const body = (req as any).body ?? {};
  switch (raw) {
    case 'tokens':
      return typeof body.tokens === 'number' ? body.tokens : 0;
    case 'cost':
      return typeof body.cost === 'number' ? body.cost : 0;
    case 'body.value':
      return typeof body.value === 'number' ? body.value : 0;
    default:
      return 0;
  }
}

/**
 * UsageTrackerGuard - HTTP 用量追踪守卫
 *
 * 配合 @TrackUsage 装饰器: 每次请求进入 Controller 路由时,记录 1 条 ApiUsage。
 * 失败不抛出(用量记录失败不应阻塞业务),但会 warn 日志。
 */
@Injectable()
export class UsageTrackerGuard implements CanActivate {
  private readonly logger = new Logger(UsageTrackerGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly usageService: ApiUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<TrackUsageOptions | undefined>(
      TRACK_USAGE_KEY,
      context.getHandler(),
    );
    if (!options) {
      return true; // 没有元数据就当作没有 @TrackUsage,放行
    }

    const req = context.switchToHttp().getRequest<Request>();
    const providerId = extractProviderId(options.providerIdSource, req);
    if (!providerId) {
      this.logger.warn(
        `UsageTrackerGuard: 无法解析 providerId(source=${options.providerIdSource ?? 'n/a'})`,
      );
      return true;
    }

    const metric = options.metric ?? 'request';
    const window: UsageWindow = options.window ?? 'hour';
    const value = extractValue(options.value, req);
    if (value <= 0) return true;

    // 异步写入,不阻塞请求
    this.usageService
      .recordUsage(providerId, metric, value, window)
      .catch((err) => {
        this.logger.error(
          `UsageTrackerGuard 写入失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    return true;
  }
}
