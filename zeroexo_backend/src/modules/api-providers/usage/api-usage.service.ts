import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ApiProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConsoleAlertHook } from './hooks/console-alert.hook';
import { QuotaAlertHook, QuotaAlertLevel, QuotaAlertPayload } from './hooks/quota-alert.hook';

/**
 * 用量窗口类型
 *
 * - hour:  按小时聚合(高频限额 / 实时监控)
 * - day:   按天聚合(日限额)
 * - month: 按月聚合(月限额 / 计费)
 */
export type UsageWindow = 'hour' | 'day' | 'month';

/** 统计粒度(同 UsageWindow) */
export type UsageGranularity = 'hour' | 'day' | 'month';

/** 统计周期(用于 getUsageStats) */
export type UsagePeriod = 'day' | 'week' | 'month';

/** 额度告警阈值(单位:百分比) */
const ALERT_THRESHOLDS: Array<70 | 85 | 95> = [70, 85, 95];

/** ApiProvider.quota 字段结构 */
interface QuotaConfig {
  daily?: number;
  monthly?: number;
  dailyUsed?: number;
  monthlyUsed?: number;
  dailyResetAt?: string;
  monthlyResetAt?: string;
  lastAlertAt?: string;
}

/** 用量趋势 */
export type UsageTrend = 'up' | 'down' | 'flat';

/**
 * API 用量追踪服务(主服务)
 *
 * 核心职责:
 * - recordUsage:  记录单次用量(按 providerId + metric + window + windowStart 自增)
 * - getUsage:     查询某个 provider + metric 在时间区间内的用量序列
 * - getAggregatedUsage: 按粒度(hour / day / month)聚合统计
 * - getQuotaStatus:     获取 provider 当前额度状态(日 / 月 / 告警等级)
 * - getUsageStats:      统计总数 / 均值 / 峰值 / 趋势
 * - 命中 70 / 85 / 95 阈值时,触发已注册的 QuotaAlertHook
 *
 * 数据库注意:
 * ApiUsage 表的 (providerId, metric, window, windowStart) 仅是组合索引,不是唯一约束。
 * 为避免重复行,本服务使用 findFirst + create / updateMany 的读写分离模式。
 */
@Injectable()
export class ApiUsageService implements OnModuleInit {
  private readonly logger = new Logger(ApiUsageService.name);

  /** 已注册的告警钩子(按注册顺序串行调用) */
  private readonly alertHooks: QuotaAlertHook[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly consoleHook?: ConsoleAlertHook,
  ) {}

  /**
   * 模块初始化时注册默认告警钩子(ConsoleAlertHook)
   * 业务侧可通过 registerAlertHook 追加自定义钩子
   */
  onModuleInit(): void {
    if (this.consoleHook) {
      this.registerAlertHook(this.consoleHook);
    }
  }

  // ============================ 告警钩子 ============================

  /**
   * 注册告警钩子(按注册顺序串行执行,失败不影响其他钩子)
   */
  registerAlertHook(hook: QuotaAlertHook): void {
    if (this.alertHooks.find((h) => h.name === hook.name)) {
      return;
    }
    this.alertHooks.push(hook);
    this.logger.log(`已注册告警钩子: ${hook.name}`);
  }

  /** 列出所有告警钩子名称(只读) */
  listAlertHooks(): string[] {
    return this.alertHooks.map((h) => h.name);
  }

  // ============================ 核心 API ============================

  /**
   * 记录一次用量
   *
   * 同一 (providerId, metric, window, windowStart, modelId) 内的调用会自增 value 字段。
   * 当写完用量后,会自动检测日 / 月额度阈值,命中 70/85/95 时触发告警。
   *
   * @param providerId provider 主键
   * @param metric     指标名(例如 token / request / email_sent)
   * @param value      用量数值(BigInt 安全的 number)
   * @param window     聚合粒度,默认 hour
   * @param modelId    模型 ID(可空,用于按模型精确计价)
   */
  async recordUsage(
    providerId: string,
    metric: string,
    value: number,
    window: UsageWindow = 'hour',
    modelId?: string | null,
  ): Promise<void> {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`recordUsage: value 非法 (${value})`);
    }
    if (value === 0) {
      // 0 增量直接跳过,避免空行
      return;
    }

    const windowStart = this.getWindowStart(window);
    const bigValue = BigInt(Math.trunc(value));
    // 规范化: undefined → null(匹配 IS NULL,避免与具名模型行混淆)
    const mid = modelId ?? null;

    // 使用事务包裹 findFirst + create/update，避免并发竞态条件导致重复行
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.apiUsage.findFirst({
        where: { providerId, metric, window, windowStart, modelId: mid },
      });

      if (existing) {
        await tx.apiUsage.update({
          where: { id: existing.id },
          data: { value: existing.value + bigValue },
        });
      } else {
        await tx.apiUsage.create({
          data: {
            providerId,
            metric,
            value: bigValue,
            window,
            windowStart,
            modelId: mid,
          },
        });
      }
    });

    // 仅 day / month 窗口触发额度检查
    if (window === 'day' || window === 'month') {
      await this.checkAndAlert(providerId, metric, window).catch((err) => {
        this.logger.error(
          `额度检查失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  /**
   * 批量记录(用于定时统计 / 一次性结算)
   */
  async recordUsageBatch(
    items: Array<{
      providerId: string;
      metric: string;
      value: number;
      window?: UsageWindow;
      modelId?: string | null;
    }>,
  ): Promise<void> {
    for (const item of items) {
      await this.recordUsage(
        item.providerId,
        item.metric,
        item.value,
        item.window ?? 'hour',
        item.modelId,
      );
    }
  }

  /**
   * 查询某 provider + metric 在时间区间内的用量序列
   *
   * @param providerId provider 主键
   * @param metric     指标名
   * @param window     聚合粒度
   * @param start      起始时间(含)
   * @param end        截止时间(含)
   */
  async getUsage(
    providerId: string,
    metric: string,
    window: UsageWindow,
    start: Date,
    end: Date,
  ): Promise<
    Array<{ windowStart: string; value: number; metric: string; window: string }>
  > {
    const records = await this.prisma.apiUsage.findMany({
      where: {
        providerId,
        metric,
        window,
        windowStart: { gte: start, lte: end },
      },
      orderBy: { windowStart: 'asc' },
    });

    return records.map((r) => ({
      windowStart: r.windowStart.toISOString(),
      value: Number(r.value),
      metric: r.metric,
      window: r.window,
    }));
  }

  /**
   * 按粒度聚合用量
   *
   * 跨小时粒度按日聚合、跨日按月聚合等。当前实现:
   * - granularity=hour: 取 ApiUsage.window=hour 的最近 N 天
   * - granularity=day:  取 ApiUsage.window=day 的最近 N 天
   * - granularity=month: 取 ApiUsage.window=month 的最近 N 月
   */
  async getAggregatedUsage(
    providerId: string,
    metric: string,
    granularity: UsageGranularity,
  ): Promise<Array<{ bucket: string; value: number }>> {
    const now = new Date();
    let since: Date;
    let window: UsageWindow;

    if (granularity === 'hour') {
      since = new Date(now);
      since.setDate(since.getDate() - 7);
      window = 'hour';
    } else if (granularity === 'day') {
      since = new Date(now);
      since.setDate(since.getDate() - 30);
      window = 'day';
    } else {
      since = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      window = 'month';
    }

    const records = await this.prisma.apiUsage.findMany({
      where: {
        providerId,
        metric,
        window,
        windowStart: { gte: since },
      },
      orderBy: { windowStart: 'asc' },
    });

    return records.map((r) => ({
      bucket: r.windowStart.toISOString(),
      value: Number(r.value),
    }));
  }

  /**
   * 获取 provider 当前的额度状态(日 / 月用量、百分比、告警等级)
   */
  async getQuotaStatus(providerId: string): Promise<{
    providerId: string;
    daily: { used: number; limit: number | null; percent: number };
    monthly: { used: number; limit: number | null; percent: number };
    level: QuotaAlertLevel;
    lastAlertAt: string | null;
  }> {
    const provider = await this.prisma.apiProvider.findUnique({
      where: { id: providerId },
    });
    if (!provider) {
      throw new Error(`Provider 不存在: ${providerId}`);
    }

    const quota = (provider.quota || {}) as QuotaConfig;
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 从 ApiUsage 重新聚合当日 / 当月用量
    const [dayRecords, monthRecords] = await Promise.all([
      this.prisma.apiUsage.findMany({
        where: { providerId, window: 'day', windowStart: dayStart },
      }),
      this.prisma.apiUsage.findMany({
        where: { providerId, window: 'month', windowStart: monthStart },
      }),
    ]);

    const dailyUsed =
      quota.dailyUsed ?? dayRecords.reduce((s, r) => s + Number(r.value), 0);
    const monthlyUsed =
      quota.monthlyUsed ??
      monthRecords.reduce((s, r) => s + Number(r.value), 0);

    const dailyPercent = quota.daily ? (dailyUsed / quota.daily) * 100 : 0;
    const monthlyPercent = quota.monthly ? (monthlyUsed / quota.monthly) * 100 : 0;
    const maxPercent = Math.max(dailyPercent, monthlyPercent);

    let level: QuotaAlertLevel = 'ok';
    if (maxPercent >= 95) level = 'critical';
    else if (maxPercent >= 70) level = 'warning';

    return {
      providerId,
      daily: {
        used: dailyUsed,
        limit: typeof quota.daily === 'number' ? quota.daily : null,
        percent: Number(dailyPercent.toFixed(2)),
      },
      monthly: {
        used: monthlyUsed,
        limit: typeof quota.monthly === 'number' ? quota.monthly : null,
        percent: Number(monthlyPercent.toFixed(2)),
      },
      level,
      lastAlertAt: quota.lastAlertAt ?? null,
    };
  }

  /**
   * 统计某 provider 在指定周期内的用量(总数 / 均值 / 峰值 / 趋势)
   *
   * 趋势计算: 把序列拆成两半,后半均值 - 前半均值;正>5% 视为 up,负<-5% 视为 down,其他 flat
   *
   * @param period 统计周期: day(24h,按小时) | week(7d,按日) | month(30d,按日)
   */
  async getUsageStats(
    providerId: string,
    period: UsagePeriod,
    metric: string = 'request',
  ): Promise<{
    providerId: string;
    metric: string;
    period: UsagePeriod;
    total: number;
    average: number;
    peak: number;
    trend: UsageTrend;
    series: Array<{ windowStart: string; value: number }>;
  }> {
    const now = new Date();
    let since: Date;
    let window: UsageWindow;

    if (period === 'day') {
      since = new Date(now);
      since.setDate(since.getDate() - 1);
      window = 'hour';
    } else if (period === 'week') {
      since = new Date(now);
      since.setDate(since.getDate() - 7);
      window = 'day';
    } else {
      since = new Date(now);
      since.setDate(since.getDate() - 30);
      window = 'day';
    }

    const records = await this.prisma.apiUsage.findMany({
      where: {
        providerId,
        metric,
        window,
        windowStart: { gte: since },
      },
      orderBy: { windowStart: 'asc' },
    });

    const series = records.map((r) => ({
      windowStart: r.windowStart.toISOString(),
      value: Number(r.value),
    }));
    const total = series.reduce((s, p) => s + p.value, 0);
    const average = series.length === 0 ? 0 : total / series.length;
    const peak = series.reduce((m, p) => (p.value > m ? p.value : m), 0);

    return {
      providerId,
      metric,
      period,
      total,
      average: Number(average.toFixed(2)),
      peak,
      trend: this.computeTrend(series.map((s) => s.value)),
      series,
    };
  }

  // ============================ 高级 API ============================

  /**
   * 列出所有 provider 的用量概览(用于仪表盘)
   */
  async getAllProvidersOverview(): Promise<
    Array<{
      provider: { id: string; name: string; type: string; provider: string; enabled: boolean };
      daily: { used: number; limit: number | null; percent: number };
      monthly: { used: number; limit: number | null; percent: number };
      level: QuotaAlertLevel;
    }>
  > {
    const providers = await this.prisma.apiProvider.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const results: Array<{
      provider: { id: string; name: string; type: string; provider: string; enabled: boolean };
      daily: { used: number; limit: number | null; percent: number };
      monthly: { used: number; limit: number | null; percent: number };
      level: QuotaAlertLevel;
    }> = [];

    for (const p of providers) {
      const status = await this.getQuotaStatus(p.id).catch(() => null);
      if (!status) continue;
      results.push({
        provider: {
          id: p.id,
          name: p.name,
          type: p.type,
          provider: p.provider,
          enabled: p.enabled,
        },
        daily: status.daily,
        monthly: status.monthly,
        level: status.level,
      });
    }
    return results;
  }

  /**
   * 重置 provider 在指定窗口下的用量计数
   *
   * 会清空 ApiUsage 表中匹配 (providerId, window=window) 的所有记录,
   * 并把 ApiProvider.quota 中的 dailyUsed / monthlyUsed 归零。
   */
  async resetUsage(
    providerId: string,
    window: 'day' | 'month',
    actor: { actorId: string; actorName: string; actorRole: string; reason?: string },
  ): Promise<{ deleted: number; provider: ApiProvider }> {
    const provider = await this.prisma.apiProvider.findUnique({
      where: { id: providerId },
    });
    if (!provider) {
      throw new Error(`Provider 不存在: ${providerId}`);
    }

    const now = new Date();
    const windowStart =
      window === 'day'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
        : new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. 删除窗口起始时间匹配的 ApiUsage
    const del = await this.prisma.apiUsage.deleteMany({
      where: { providerId, window, windowStart },
    });

    // 2. 更新 provider.quota 快照
    const quota = { ...((provider.quota || {}) as QuotaConfig) };
    if (window === 'day') {
      quota.dailyUsed = 0;
    } else {
      quota.monthlyUsed = 0;
    }

    const updated = await this.prisma.apiProvider.update({
      where: { id: providerId },
      data: {
        quota: quota as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.warn(
      `[RESET] provider=${providerId} window=${window} ` +
        `deleted=${del.count} actor=${actor.actorName}(${actor.actorRole}) ` +
        `reason=${actor.reason ?? 'n/a'}`,
    );

    return { deleted: del.count, provider: updated };
  }

  // ============================ 私有方法 ============================

  /**
   * 写入用量后调用: 检查额度并按需触发告警
   */
  private async checkAndAlert(
    providerId: string,
    metric: string,
    window: 'day' | 'month',
  ): Promise<void> {
    const status = await this.getQuotaStatus(providerId);
    const bucket = window === 'day' ? status.daily : status.monthly;
    if (bucket.limit === null) return;

    for (const threshold of ALERT_THRESHOLDS) {
      if (bucket.percent >= threshold) {
        await this.dispatchAlert({
          provider: await this.prisma.apiProvider.findUniqueOrThrow({
            where: { id: providerId },
          }),
          metric,
          window,
          used: bucket.used,
          limit: bucket.limit,
          percent: bucket.percent,
          level: threshold >= 95 ? 'critical' : 'warning',
          threshold,
          triggeredAt: new Date(),
        });
        break; // 每个窗口每次只发一次告警
      }
    }
  }

  /**
   * 串行调用所有已注册的告警钩子(失败不互相影响)
   */
  private async dispatchAlert(payload: QuotaAlertPayload): Promise<void> {
    for (const hook of this.alertHooks) {
      try {
        await hook.onAlert(payload);
      } catch (err) {
        this.logger.error(
          `告警钩子 ${hook.name} 执行失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 根据窗口粒度计算窗口起始时间
   */
  private getWindowStart(window: UsageWindow): Date {
    const now = new Date();
    if (window === 'hour') {
      now.setMinutes(0, 0, 0);
    } else if (window === 'day') {
      now.setHours(0, 0, 0, 0);
    } else {
      now.setDate(1);
      now.setHours(0, 0, 0, 0);
    }
    return now;
  }

  /**
   * 计算用量趋势:对比前半段与后半段的均值差异
   */
  private computeTrend(values: number[]): UsageTrend {
    if (values.length < 2) return 'flat';
    const mid = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, mid);
    const secondHalf = values.slice(mid);
    if (firstHalf.length === 0 || secondHalf.length === 0) return 'flat';

    const avg = (arr: number[]) =>
      arr.reduce((s, v) => s + v, 0) / arr.length;
    const first = avg(firstHalf);
    const second = avg(secondHalf);
    if (first === 0 && second === 0) return 'flat';

    const delta = (second - first) / Math.max(first, 1);
    if (delta > 0.05) return 'up';
    if (delta < -0.05) return 'down';
    return 'flat';
  }
}
