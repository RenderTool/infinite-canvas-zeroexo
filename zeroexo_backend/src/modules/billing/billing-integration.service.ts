/**
 * 计费集成服务 — AI 生成流程的计费钩子
 *
 * 提供 beforeGenerate / afterGenerate / onGenerateFailed 三个钩子
 * 供 AiGenerateService 在生成流程中调用
 */
import { Injectable, Logger } from '@nestjs/common';
import { CreditService } from './credit.service';
import { MultiplierService, type BillingBreakdown } from './multiplier.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface BeforeGenerateResult {
  allowed: boolean;
  estimatedCredits: number;
  frozenId?: string;
  error?: string;
}

export interface AfterGenerateResult {
  settled: boolean;
  creditsConsumed: number;
  billing: BillingBreakdown;
}

@Injectable()
export class BillingIntegrationService {
  private readonly logger = new Logger(BillingIntegrationService.name);

  constructor(
    private readonly creditService: CreditService,
    private readonly multiplierService: MultiplierService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 生成前钩子: 估算积分 + 预冻结
   *
   * @param userId 用户 ID
   * @param params 生成参数
   * @returns 是否允许生成 + 冻结信息
   */
  async beforeGenerate(
    userId: string,
    params: {
      modelType: string;
      provider: string;
      modelId: string;
      estimatedTokens?: number;
      estimatedCount?: number;
    },
  ): Promise<BeforeGenerateResult> {
    try {
      await this.creditService.ensureAccount(userId);

      const estimatedCredits = await this.multiplierService.estimateCredits(
        params.modelType,
        params.provider,
        params.modelId,
        params.estimatedTokens ?? params.estimatedCount ?? 0,
        userId,
      );

      if (estimatedCredits <= 0) {
        return { allowed: true, estimatedCredits: 0 };
      }

      const freezeResult = await this.creditService.freeze(userId, estimatedCredits);

      if (!freezeResult.success) {
        return {
          allowed: false,
          estimatedCredits,
          error: freezeResult.error,
        };
      }

      return {
        allowed: true,
        estimatedCredits,
        frozenId: freezeResult.frozenId,
      };
    } catch (err) {
      this.logger.error(`beforeGenerate 失败: ${err}`);
      // 计费系统异常时允许生成(降级处理)，避免阻塞核心业务
      return { allowed: true, estimatedCredits: 0 };
    }
  }

  /**
   * 生成后钩子: 按实际用量结算 + 写消费记录
   *
   * @param userId 用户 ID
   * @param params 生成结果参数
   */
  async afterGenerate(
    userId: string,
    params: {
      generationId: string;
      modelType: string;
      provider: string;
      modelId: string;
      usageAmount: number;
      inputTokens?: number;
      outputTokens?: number;
    },
  ): Promise<AfterGenerateResult | null> {
    try {
      const breakdown = await this.multiplierService.calculateCost({
        modelType: params.modelType,
        provider: params.provider,
        modelId: params.modelId,
        usageAmount: params.usageAmount,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
      }, userId);

      // 结算积分
      const settleResult = await this.creditService.settle(
        userId,
        breakdown.creditsConsumed,
        params.generationId,
        `${params.modelType} 生成: ${params.modelId}`,
      );

      if (!settleResult.success) {
        this.logger.warn(`积分结算异常: ${settleResult.error}`);
      }

      // 写入消耗明细
      await this.writeConsumptionLog(userId, params, breakdown);

      return {
        settled: settleResult.success,
        creditsConsumed: breakdown.creditsConsumed,
        billing: breakdown,
      };
    } catch (err) {
      this.logger.error(`afterGenerate 失败: ${err}`);
      return null;
    }
  }

  /**
   * 生成失败钩子: 解冻积分
   */
  async onGenerateFailed(userId: string): Promise<void> {
    try {
      await this.creditService.unfreeze(userId, '生成失败解冻');
    } catch (err) {
      this.logger.error(`onGenerateFailed 失败: ${err}`);
    }
  }

  /**
   * 写入消费明细 (user_consumption + upstream_cost 双表合一)
   */
  private async writeConsumptionLog(
    userId: string,
    params: {
      generationId: string;
      modelType: string;
      provider: string;
      modelId: string;
      usageAmount: number;
      inputTokens?: number;
      outputTokens?: number;
    },
    breakdown: BillingBreakdown,
  ): Promise<void> {
    const credit = await this.prisma.userCredit.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!credit) return;

    await this.prisma.consumptionLog.create({
      data: {
        generationId: params.generationId,
        userId,
        creditId: credit.id,
        model: params.modelId,
        modelType: params.modelType,
        unitType: breakdown.multiplier.unitType,
        usageAmount: params.usageAmount,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        creditsConsumed: breakdown.creditsConsumed,
        creditValueCny: breakdown.creditValueCny,
        upstreamCostUsd: breakdown.totalCostUsd,
        channelPool: params.provider,
        modelMultiplier: breakdown.multiplier.modelMultiplier,
        completionMultiplier: breakdown.multiplier.completionMultiplier,
        groupMultiplier: breakdown.multiplier.groupMultiplier,
        creditPerUnit: breakdown.multiplier.creditPerUnit,
        billingStatus: 'completed',
      },
    });
  }
}
