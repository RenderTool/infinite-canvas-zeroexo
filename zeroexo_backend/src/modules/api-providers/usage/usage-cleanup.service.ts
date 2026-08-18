import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * 用量清理服务
 *
 * 职责:
 * - 每周日凌晨 03:30 执行一次清理任务
 * - 按窗口粒度分别删除过期的 ApiUsage 记录:
 *   - hour:  保留 7 天
 *   - day:   保留 90 天
 *   - month: 保留 365 天
 *
 * 调度由 SchedulerRegistry 动态注册,便于后续在 admin 端运行时调整。
 */
@Injectable()
export class UsageCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageCleanupService.name);
  /** 定时任务名(用于 SchedulerRegistry) */
  static readonly JOB_NAME = 'usage-cleanup-weekly';

  /** 各窗口保留天数 */
  static readonly RETENTION = {
    hour: 7,
    day: 90,
    month: 365,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    // 每周日凌晨 03:30
    const job = new CronJob('0 30 3 * * 0', () => {
      this.runWeeklyCleanup().catch((err) => {
        this.logger.error(
          `用量清理任务异常: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
    this.schedulerRegistry.addCronJob(UsageCleanupService.JOB_NAME, job);
    job.start();
    this.logger.log(
      `已注册用量清理任务: ${UsageCleanupService.JOB_NAME} (每周日 03:30)`,
    );
  }

  onModuleDestroy(): void {
    try {
      this.schedulerRegistry.deleteCronJob(UsageCleanupService.JOB_NAME);
    } catch {
      // ignore: 模块销毁时可能已被移除
    }
  }

  /**
   * 周清理入口:按窗口分别删除过期记录
   */
  async runWeeklyCleanup(): Promise<{
    hour: number;
    day: number;
    month: number;
  }> {
    this.logger.log('开始执行 ApiUsage 过期清理');
    const [hour, day, month] = await Promise.all([
      this.cleanupByWindow('hour', UsageCleanupService.RETENTION.hour),
      this.cleanupByWindow('day', UsageCleanupService.RETENTION.day),
      this.cleanupByWindow('month', UsageCleanupService.RETENTION.month),
    ]);
    this.logger.log(
      `ApiUsage 清理完成: hour=${hour}, day=${day}, month=${month}`,
    );
    return { hour, day, month };
  }

  /**
   * 按窗口删除超过 retentionDays 的历史记录
   */
  private async cleanupByWindow(
    window: 'hour' | 'day' | 'month',
    retentionDays: number,
  ): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = await this.prisma.apiUsage.deleteMany({
      where: {
        window,
        createdAt: { lt: cutoff },
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `清理 ${window} 粒度记录 ${result.count} 条(早于 ${cutoff.toISOString()})`,
      );
    }
    return result.count;
  }
}
