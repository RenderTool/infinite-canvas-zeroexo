import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class BillingReconciliationService {
  private readonly logger = new Logger(BillingReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 * * * *')
  async detectDifferences(): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const recentLogs = await this.prisma.consumptionLog.findMany({
        where: {
          billingStatus: 'completed',
          createdAt: { gte: oneHourAgo },
        },
      });

      if (recentLogs.length === 0) {
        this.logger.debug('Hourly reconciliation: no consumption logs in the last hour');
        return;
      }

      const discrepancies: Array<{
        userId: string;
        logId: string;
        creditsConsumed: number;
        transactionAmount: number;
      }> = [];

      for (const log of recentLogs) {
        const transaction = await this.prisma.creditTransaction.findFirst({
          where: {
            referenceId: log.generationId,
            type: 'consume',
          },
        });

        if (!transaction) {
          discrepancies.push({
            userId: log.userId,
            logId: log.id,
            creditsConsumed: log.creditsConsumed,
            transactionAmount: 0,
          });
          continue;
        }

        if (Math.abs(log.creditsConsumed - Math.abs(transaction.amount)) > 0.001) {
          discrepancies.push({
            userId: log.userId,
            logId: log.id,
            creditsConsumed: log.creditsConsumed,
            transactionAmount: Math.abs(transaction.amount),
          });
        }
      }

      if (discrepancies.length > 0) {
        this.logger.warn(
          `Reconciliation alert: found ${discrepancies.length} discrepancy(s) in the last hour`,
        );

        for (const d of discrepancies) {
          this.logger.warn(
            `  → userId=${d.userId}, logId=${d.logId}, ` +
              `creditsConsumed=${d.creditsConsumed}, txAmount=${d.transactionAmount}`,
          );
        }
      } else {
        this.logger.debug(
          `Hourly reconciliation OK: ${recentLogs.length} log(s) cross-checked, no discrepancies`,
        );
      }
    } catch (err) {
      this.logger.error(
        `detectDifferences failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron('0 2 * * *')
  async generateDailyReport(): Promise<void> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const dateStr = yesterday.toISOString().slice(0, 10);

      const existing = await this.prisma.dailyReport.findUnique({
        where: { date: dateStr },
      });

      if (existing) {
        this.logger.log(`Daily report for ${dateStr} already exists, skipping`);
        return;
      }

      const consumptions = await this.prisma.consumptionLog.findMany({
        where: {
          billingStatus: 'completed',
          createdAt: { gte: yesterday, lt: today },
        },
      });

      const totalCalls = consumptions.length;
      const totalCredits = consumptions.reduce((sum, c) => sum + c.creditsConsumed, 0);
      const totalCostUsd = consumptions.reduce((sum, c) => sum + (c.upstreamCostUsd || 0), 0);
      const totalCostCny = totalCostUsd * 7.25;
      const totalRevenueCny = consumptions.reduce((sum, c) => sum + (c.creditValueCny || 0), 0);
      const grossProfitCny = totalRevenueCny - totalCostCny;
      const marginRate = totalRevenueCny > 0 ? (grossProfitCny / totalRevenueCny) * 100 : 0;

      const grouped = this.groupByModelAndProvider(consumptions);

      const report = await this.prisma.dailyReport.create({
        data: {
          date: dateStr,
          totalCalls,
          totalCredits,
          totalCostUsd: Number(totalCostUsd.toFixed(6)),
          totalCostCny: Number(totalCostCny.toFixed(4)),
          totalRevenueCny: Number(totalRevenueCny.toFixed(4)),
          grossProfitCny: Number(grossProfitCny.toFixed(4)),
          marginRate: Number(marginRate.toFixed(2)),
          summary: grouped,
        },
      });

      this.logger.log(
        `Daily report ${report.id} for ${dateStr} generated: calls=${totalCalls}, ` +
          `credits=${totalCredits}, costUsd=${totalCostUsd.toFixed(4)}, ` +
          `revenueCny=${totalRevenueCny.toFixed(4)}, margin=${marginRate.toFixed(2)}%`,
      );
    } catch (err) {
      this.logger.error(
        `generateDailyReport failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getReport(date: string): Promise<{
    date: string;
    totalCalls: number;
    totalCredits: number;
    totalCostUsd: number;
    totalCostCny: number;
    totalRevenueCny: number;
    grossProfitCny: number;
    marginRate: number;
    summary: Record<string, unknown>;
  } | null> {
    const report = await this.prisma.dailyReport.findUnique({
      where: { date },
    });

    if (!report) {
      return null;
    }

    return {
      date: report.date,
      totalCalls: report.totalCalls,
      totalCredits: report.totalCredits,
      totalCostUsd: report.totalCostUsd,
      totalCostCny: report.totalCostCny,
      totalRevenueCny: report.totalRevenueCny,
      grossProfitCny: report.grossProfitCny,
      marginRate: report.marginRate,
      summary: report.summary as unknown as Record<string, unknown>,
    };
  }

  private groupByModelAndProvider(
    consumptions: Array<{
      modelType: string;
      model: string;
      channelPool: string | null;
      creditsConsumed: number;
      upstreamCostUsd: number;
      creditValueCny: number;
    }>,
  ): Record<
    string,
    {
      modelType: string;
      provider: string;
      totalCalls: number;
      totalCredits: number;
      totalCostUsd: number;
      totalRevenueCny: number;
    }
  > {
    const groups = new Map<
      string,
      {
        modelType: string;
        provider: string;
        totalCalls: number;
        totalCredits: number;
        totalCostUsd: number;
        totalRevenueCny: number;
      }
    >();

    for (const c of consumptions) {
      const provider = c.channelPool || 'unknown';
      const key = `${c.modelType}::${provider}`;

      const existing = groups.get(key);
      if (existing) {
        existing.totalCalls += 1;
        existing.totalCredits += c.creditsConsumed;
        existing.totalCostUsd += c.upstreamCostUsd || 0;
        existing.totalRevenueCny += c.creditValueCny || 0;
      } else {
        groups.set(key, {
          modelType: c.modelType,
          provider,
          totalCalls: 1,
          totalCredits: c.creditsConsumed,
          totalCostUsd: c.upstreamCostUsd || 0,
          totalRevenueCny: c.creditValueCny || 0,
        });
      }
    }

    const result: Record<string, {
      modelType: string;
      provider: string;
      totalCalls: number;
      totalCredits: number;
      totalCostUsd: number;
      totalRevenueCny: number;
    }> = {};

    for (const [key, value] of groups) {
      result[key] = {
        ...value,
        totalCostUsd: Number(value.totalCostUsd.toFixed(6)),
        totalRevenueCny: Number(value.totalRevenueCny.toFixed(4)),
      };
    }

    return result;
  }
}