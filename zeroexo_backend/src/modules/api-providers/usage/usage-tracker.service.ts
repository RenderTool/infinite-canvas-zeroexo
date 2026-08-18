import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * 用量窗口 - 控制 ApiUsage 聚合的时间粒度
 * - hour:  按小时聚合(用于高频限流告警)
 * - day:   按天聚合(用于日限额)
 * - month: 按月聚合(用于月限额 / 计费)
 */
export type UsageWindow = 'hour' | 'day' | 'month';

/**
 * 用量记录项(批量记录入口)
 */
export interface UsageRecord {
  providerId: string;
  metric: string;
  value: number;
  window?: UsageWindow;
}

/**
 * API 用量追踪服务
 *
 * 职责:
 * - 记录 ApiProvider 每次调用的用量(按 metric / window 聚合)
 * - 提供按时间窗口查询用量序列、汇总
 * - 清理过期的历史数据(默认保留 90 天)
 *
 * 数据库约束: ApiUsage 唯一键 (providerId, metric, window, windowStart)
 * 因此采用 upsert + increment 模式,保证同一窗口只产生一行记录。
 */
@Injectable()
export class UsageTrackerService {
  private readonly logger = new Logger(UsageTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录一次用量
   * 同一 providerId + metric + window + windowStart 内会自增 value
   *
   * 实现:由于 ApiUsage 仅声明为普通 index 而非 unique,这里用
   * findFirst + create/update 手动 upsert,避免依赖隐式唯一键。
   */
  async record(
    providerId: string,
    metric: string,
    value: number,
    window: UsageWindow = 'hour',
  ): Promise<void> {
    const windowStart = this.getWindowStart(window);
    const existing = await this.prisma.apiUsage.findFirst({
      where: { providerId, metric, window, windowStart },
    });
    if (existing) {
      await this.prisma.apiUsage.update({
        where: { id: existing.id },
        data: { value: { increment: BigInt(value) } },
      });
    } else {
      await this.prisma.apiUsage.create({
        data: {
          providerId,
          metric,
          value: BigInt(value),
          window,
          windowStart,
        },
      });
    }
  }

  /**
   * 批量记录(用于定时统计 / 一次性结算)
   */
  async recordBatch(records: UsageRecord[]): Promise<void> {
    for (const r of records) {
      await this.record(r.providerId, r.metric, r.value, r.window || 'hour');
    }
  }

  /**
   * 获取最近 N 天的用量序列(按窗口升序)
   * 返回数组元素: { windowStart: ISO 字符串, value: number }
   */
  async getUsage(
    providerId: string,
    metric: string,
    days: number = 7,
  ): Promise<Array<{ windowStart: string; value: number }>> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const records = await this.prisma.apiUsage.findMany({
      where: { providerId, metric, windowStart: { gte: since } },
      orderBy: { windowStart: 'asc' },
    });
    return records.map((r) => ({
      windowStart: r.windowStart.toISOString(),
      value: Number(r.value),
    }));
  }

  /**
   * 获取某时间段内各指标的总和
   * 返回: { metric: totalValue }
   */
  async getSummary(
    providerId: string,
    period: { from: Date; to: Date },
  ): Promise<Record<string, number>> {
    const records = await this.prisma.apiUsage.findMany({
      where: {
        providerId,
        windowStart: { gte: period.from, lte: period.to },
      },
    });
    const summary: Record<string, number> = {};
    for (const r of records) {
      summary[r.metric] = (summary[r.metric] || 0) + Number(r.value);
    }
    return summary;
  }

  /**
   * 清理超过保留天数的历史用量(默认 90 天)
   * 由定时任务调用,控制 ApiUsage 表规模
   */
  async cleanup(retentionDays: number = 90): Promise<{ deleted: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = await this.prisma.apiUsage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`清理 ${result.count} 条过期用量记录(早于 ${cutoff.toISOString()})`);
    }
    return { deleted: result.count };
  }

  /**
   * 根据窗口粒度计算窗口起始时间
   * - hour:  本小时 0 分 0 秒
   * - day:   今日 0 时 0 分 0 秒
   * - month: 本月 1 日 0 时 0 分 0 秒
   */
  private getWindowStart(window: UsageWindow): Date {
    const now = new Date();
    if (window === 'hour') {
      now.setMinutes(0, 0, 0);
    } else if (window === 'day') {
      now.setHours(0, 0, 0, 0);
    } else if (window === 'month') {
      now.setDate(1);
      now.setHours(0, 0, 0, 0);
    }
    return now;
  }
}
