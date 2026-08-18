import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { QuotaAlertHook, QuotaAlertPayload } from './quota-alert.hook';

/**
 * 默认告警钩子 - 控制台 + 数据库双写
 *
 * 行为:
 * 1. console.warn 打印告警信息
 * 2. 以 'request' metric 写一条 ApiUsage 记录(window=day 或 month),
 *    留痕用于后续告警历史查询
 *
 * 不阻塞主流程,内部 try/catch 吞掉异常。
 */
@Injectable()
export class ConsoleAlertHook implements QuotaAlertHook {
  readonly name = 'console';

  private readonly logger = new Logger(ConsoleAlertHook.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 处理告警事件
   * - 打印 warn 日志
   * - 在 ApiUsage 表中以 metric='quota_alert' 留痕
   */
  async onAlert(payload: QuotaAlertPayload): Promise<void> {
    const providerId = payload.provider.id;
    const message =
      `[QuotaAlert] provider=${providerId}(${payload.provider.name}) ` +
      `metric=${payload.metric} window=${payload.window} ` +
      `used=${payload.used}/${payload.limit ?? '∞'} ` +
      `(${payload.percent.toFixed(2)}%, level=${payload.level}, ` +
      `threshold=${payload.threshold}%)`;

    // 1. 写 warn 日志
    this.logger.warn(message);

    // 2. 写 ApiUsage 留痕(失败不影响告警)
    try {
      const now = new Date();
      const windowStart =
        payload.window === 'day'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
          : new Date(now.getFullYear(), now.getMonth(), 1);

      await this.prisma.apiUsage.create({
        data: {
          providerId,
          metric: 'quota_alert',
          value: BigInt(payload.threshold),
          window: payload.window,
          windowStart,
        },
      });
    } catch (err) {
      this.logger.error(
        `写入告警留痕失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
