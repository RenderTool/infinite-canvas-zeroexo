import { Injectable } from '@nestjs/common';
import { ApiProvider } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * 限额配置结构(对应 ApiProvider.quota JSON 字段)
 * - daily / monthly: 限额上限
 * - dailyUsed / monthlyUsed: 已用值
 * - dailyResetAt / monthlyResetAt: 下次重置时间(ISO 字符串)
 */
export interface QuotaConfig {
  daily?: number;
  monthly?: number;
  dailyUsed?: number;
  monthlyUsed?: number;
  dailyResetAt?: string;
  monthlyResetAt?: string;
}

/**
 * API 提供商限额服务
 *
 * 职责:
 * - 从 ApiUsage 汇总每个 provider 的当日/当月用量,写回 ApiProvider.quota
 * - 判断 provider 是否已超额(用于在 invokeAction 前拦截)
 * - 列出超额 / 高位告警,供仪表盘展示
 *
 * 注意: 该服务只读写 ApiProvider.quota 字段(限额的"快照"),
 * 真正的"流量入口"应该在每次调用前用 isQuotaExceeded 拦截,
 * 调用结束后通过 UsageTrackerService.record 累计,再由 refreshQuota 同步快照。
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 刷新某个 provider 的限额快照:
   * 1. 检查日 / 月是否到期,到期则清零
   * 2. 从 ApiUsage 重新统计当日 / 当月用量
   * 3. 持久化到 provider.quota
   */
  async refreshQuota(providerId: string): Promise<QuotaConfig> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id: providerId } });
    if (!provider) {
      throw new Error('Provider not found');
    }

    const quota: QuotaConfig = { ...((provider.quota as QuotaConfig) || {}) };
    const now = new Date();

    // 检查并重置日配额
    const dailyResetAt = quota.dailyResetAt ? new Date(quota.dailyResetAt) : null;
    if (!dailyResetAt || now > dailyResetAt) {
      const nextDailyReset = new Date(now);
      nextDailyReset.setHours(24, 0, 0, 0);
      quota.dailyUsed = 0;
      quota.dailyResetAt = nextDailyReset.toISOString();
    }

    // 检查并重置月配额
    const monthlyResetAt = quota.monthlyResetAt ? new Date(quota.monthlyResetAt) : null;
    if (!monthlyResetAt || now > monthlyResetAt) {
      const nextMonthlyReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      quota.monthlyUsed = 0;
      quota.monthlyResetAt = nextMonthlyReset.toISOString();
    }

    // 从 ApiUsage 重新汇总
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayRecords = await this.prisma.apiUsage.findMany({
      where: { providerId, window: 'day', windowStart: todayStart },
    });
    const monthRecords = await this.prisma.apiUsage.findMany({
      where: { providerId, window: 'month', windowStart: monthStart },
    });

    quota.dailyUsed = todayRecords.reduce((sum, r) => sum + Number(r.value), 0);
    quota.monthlyUsed = monthRecords.reduce((sum, r) => sum + Number(r.value), 0);

    // 持久化快照
    await this.prisma.apiProvider.update({
      where: { id: providerId },
      data: { quota: quota as any },
    });

    return quota;
  }

  /**
   * 判断 provider 是否已超额(用于调用前拦截)
   * 仅检查 daily / monthly 的硬上限,不涉及 warning 等级
   */
  async isQuotaExceeded(provider: ApiProvider): Promise<boolean> {
    const quota = (provider.quota || {}) as QuotaConfig;
    if (quota.daily !== undefined && (quota.dailyUsed || 0) >= quota.daily) {
      return true;
    }
    if (quota.monthly !== undefined && (quota.monthlyUsed || 0) >= quota.monthly) {
      return true;
    }
    return false;
  }

  /**
   * 列出所有启用 provider 的限额告警
   * 阈值: >=95% critical, >=80% warning
   */
  async getQuotaAlerts(): Promise<
    Array<{ provider: ApiProvider; quota: QuotaConfig; level: 'warning' | 'critical' }>
  > {
    const providers = await this.prisma.apiProvider.findMany({ where: { enabled: true } });
    const alerts: Array<{ provider: ApiProvider; quota: QuotaConfig; level: 'warning' | 'critical' }> = [];

    for (const p of providers) {
      const quota = (p.quota || {}) as QuotaConfig;
      const dailyPercent = quota.daily ? ((quota.dailyUsed || 0) / quota.daily) * 100 : 0;
      const monthlyPercent = quota.monthly ? ((quota.monthlyUsed || 0) / quota.monthly) * 100 : 0;
      const maxPercent = Math.max(dailyPercent, monthlyPercent);

      if (maxPercent >= 95) {
        alerts.push({ provider: p, quota, level: 'critical' });
      } else if (maxPercent >= 80) {
        alerts.push({ provider: p, quota, level: 'warning' });
      }
    }

    return alerts;
  }
}
