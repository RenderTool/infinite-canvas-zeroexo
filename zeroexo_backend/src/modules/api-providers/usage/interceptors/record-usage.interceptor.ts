import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { ApiUsageService, UsageWindow } from '../api-usage.service';
import {
  RecordUsageOptions,
  RECORD_USAGE_KEY,
} from '../decorators/record-usage.decorator';

/**
 * 解析 providerId
 * - 字符串:直接返回
 * - { fromArgs: 0 }:取方法第 1 个参数(0-based)
 */
function resolveProviderId(
  raw: RecordUsageOptions['providerId'],
  args: unknown[],
): string | null {
  if (raw === undefined) {
    // 默认从 args[0] 取
    const first = args[0];
    return typeof first === 'string' ? first : null;
  }
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && 'fromArgs' in raw) {
    const v = args[raw.fromArgs];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * 解析 value
 * - 数字:直接返回
 * - { fromResult: 'a.b' }:从方法返回值按路径取值(类似 lodash get)
 * - { fromArgs: 'providerId' }:从对应位置参数取(用变量名匹配,简化版)
 */
function resolveValue(
  raw: RecordUsageOptions['value'],
  result: unknown,
  args: unknown[],
): number {
  if (raw === undefined) return 1; // 默认 +1
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'object' && 'fromResult' in raw) {
    const v = getPath(result, raw.fromResult);
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
  if (typeof raw === 'object' && 'fromArgs' in raw) {
    const v = args[Number((raw as { fromArgs: string }).fromArgs)];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

/** 类似 lodash get 的简易路径取值 */
function getPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const parts = path.split('.');
  let cur: any = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * 解析 modelId（可空）:
 * - 字符串:直接返回
 * - { fromResult: 'data.model' }:从方法返回值按路径取值
 * - { fromArgs: 1 }:取方法第 N 个参数
 */
function resolveModelId(
  raw: RecordUsageOptions['modelId'],
  result: unknown,
  args: unknown[],
): string | null {
  if (raw === undefined) return null;
  if (typeof raw === 'string') return raw || null;
  if (typeof raw === 'object' && 'fromResult' in raw) {
    const v = getPath(result, raw.fromResult);
    return typeof v === 'string' && v ? v : null;
  }
  if (typeof raw === 'object' && 'fromArgs' in raw) {
    const v = args[raw.fromArgs];
    return typeof v === 'string' && v ? v : null;
  }
  return null;
}

/**
 * @RecordUsage 拦截器
 *
 * 配合 RecordUsage 装饰器使用: 方法调用完成后自动 recordUsage。
 * 注意: 必须通过 APP_INTERCEPTER 或方法级 @UseInterceptors(RecordUsageInterceptor) 启用。
 */
@Injectable()
export class RecordUsageInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RecordUsageInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly usageService: ApiUsageService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<RecordUsageOptions | undefined>(
      RECORD_USAGE_KEY,
      context.getHandler(),
    );
    if (!options) {
      return next.handle();
    }

    const args = context.getArgs();
    const providerId = resolveProviderId(options.providerId, args);

    return next.handle().pipe(
      tap({
        next: async (result) => {
          if (!providerId) {
            this.logger.warn(
              'RecordUsage: 无法解析 providerId,跳过用量记录',
            );
            return;
          }
          const metric = options.metric ?? 'request';
          const window: UsageWindow = options.window ?? 'hour';
          const value = resolveValue(options.value, result, args);
          if (value <= 0) return;
          const modelId = resolveModelId(options.modelId, result, args);
          try {
            await this.usageService.recordUsage(providerId, metric, value, window, modelId ?? undefined);
          } catch (err) {
            this.logger.error(
              `RecordUsage 写入失败: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
        error: () => {
          // 失败不计入用量(避免错误请求污染统计)
        },
      }),
    );
  }
}
