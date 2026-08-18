/**
 * 倍率服务 — 三层倍率体系
 *
 * 模型倍率 × 补全倍率 × 分组倍率
 * 用于: 计算实际消耗价格、积分换算
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  calcLlmBlendedCost,
  calcImageCost,
  calcVideoCost,
  calcAudioCost,
} from '../pricing/cost';

export interface MultiplierConfig {
  modelMultiplier: number;
  completionMultiplier: number;
  groupMultiplier: number;
  creditPerUnit: number;
  creditUnitSize: number;
  unitType: string;
}

export interface BillingBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  totalCostCny: number;
  creditsConsumed: number;
  creditValueCny: number;
  multiplier: MultiplierConfig;
}

@Injectable()
export class MultiplierService {
  private readonly logger = new Logger(MultiplierService.name);
  private readonly configCache = new Map<string, MultiplierConfig>();

  constructor(private readonly prisma: PrismaService) {}

  /** 构建缓存 key */
  private cacheKey(modelType: string, provider: string, modelId: string): string {
    return `${modelType}::${provider}::${modelId}`;
  }

  /**
   * 获取指定模型的倍率配置
   * 优先从数据库读取 PricingConfig，回退到默认值
   */
  async getConfig(
    modelType: string,
    provider: string,
    modelId: string,
  ): Promise<MultiplierConfig> {
    const key = this.cacheKey(modelType, provider, modelId);
    const cached = this.configCache.get(key);
    if (cached) return cached;

    try {
      const config = await this.prisma.pricingConfig.findUnique({
        where: {
          modelType_provider_modelId: {
            modelType,
            provider,
            modelId,
          },
        },
      });

      const result: MultiplierConfig = config
        ? {
            modelMultiplier: config.modelMultiplier,
            completionMultiplier: config.completionMultiplier,
            groupMultiplier: config.groupMultiplier,
            creditPerUnit: config.creditPerUnit,
            creditUnitSize: config.creditUnitSize,
            unitType: config.unitType,
          }
        : this.defaultConfig(modelType);

      this.configCache.set(key, result);
      return result;
    } catch {
      const fallback = this.defaultConfig(modelType);
      this.logger.warn(
        `PricingConfig not found for ${key}, using default: ${JSON.stringify(fallback)}`,
      );
      return fallback;
    }
  }

  /** 默认倍率配置 (1:1 透传) */
  private defaultConfig(modelType: string): MultiplierConfig {
    const unitType =
      modelType === 'llm'
        ? 'token'
        : modelType === 'image'
          ? 'image'
          : modelType === 'video'
            ? 'video'
            : 'audio';
    return {
      modelMultiplier: 1,
      completionMultiplier: 1,
      groupMultiplier: 1,
      creditPerUnit: 0,
      creditUnitSize: modelType === 'llm' ? 1000 : 1,
      unitType,
    };
  }

  /** 清除指定配置缓存 */
  invalidateCache(modelType: string, provider: string, modelId: string): void {
    this.configCache.delete(this.cacheKey(modelType, provider, modelId));
  }

  /** 清除全部缓存 */
  clearCache(): void {
    this.configCache.clear();
  }

  /**
   * 计算实际消耗 (带倍率)
   *
   * LLM:
   *   输入成本 = inputTokens × 基准单价 × modelMultiplier
   *   输出成本 = outputTokens × 基准单价 × modelMultiplier × completionMultiplier
   *   总成本 = (输入 + 输出) × groupMultiplier
   *
   * Image/Video/Audio:
   *   总成本 = usageCount × 基准单价 × modelMultiplier × groupMultiplier
   *
   * @param params 计算参数
   * @param userId 可选用户 ID：传入时按用户当前订阅计划的分组倍率覆盖 groupMultiplier
   */
  async calculateCost(
    params: {
      modelType: string;
      provider: string;
      modelId: string;
      usageAmount: number;
      inputTokens?: number;
      outputTokens?: number;
    },
    userId?: string,
  ): Promise<BillingBreakdown> {
    const { modelType, provider, modelId, usageAmount, inputTokens, outputTokens } = params;
    const config = await this.getConfig(modelType, provider, modelId);

    // 用户订阅计划覆盖分组倍率（无有效计划时保留配置值）
    const planMultiplier = userId ? await this.getUserGroupMultiplier(userId) : null;
    const groupMultiplier = planMultiplier ?? config.groupMultiplier;
    const effectiveConfig: MultiplierConfig = { ...config, groupMultiplier };

    let inputCostUsd = 0;
    let outputCostUsd = 0;
    let totalCostUsd = 0;

    if (modelType === 'llm') {
      const blended = calcLlmBlendedCost(provider, modelId, usageAmount);

      if (inputTokens && outputTokens && inputTokens + outputTokens > 0) {
        const totalTokens = inputTokens + outputTokens;
        const inputRatio = inputTokens / totalTokens;
        const outputRatio = outputTokens / totalTokens;

        const blendedRate = blended.costUsd / usageAmount;
        const inputRate = blendedRate * inputRatio;
        const outputRate = blendedRate * outputRatio;

        inputCostUsd = inputTokens * inputRate * effectiveConfig.modelMultiplier * effectiveConfig.groupMultiplier;
        outputCostUsd =
          outputTokens * outputRate * effectiveConfig.modelMultiplier * effectiveConfig.completionMultiplier * effectiveConfig.groupMultiplier;
        totalCostUsd = inputCostUsd + outputCostUsd;
      } else {
        totalCostUsd = blended.costUsd * effectiveConfig.modelMultiplier * effectiveConfig.groupMultiplier;
        inputCostUsd = totalCostUsd * 0.25;
        outputCostUsd = totalCostUsd * 0.75;
      }
    } else if (modelType === 'image') {
      const base = calcImageCost(provider, modelId, usageAmount);
      totalCostUsd = base.costUsd * effectiveConfig.modelMultiplier * effectiveConfig.groupMultiplier;
    } else if (modelType === 'video') {
      const base = calcVideoCost(provider, modelId, usageAmount);
      totalCostUsd = base.costUsd * effectiveConfig.modelMultiplier * effectiveConfig.groupMultiplier;
    } else if (modelType === 'audio') {
      const base = calcAudioCost(provider, modelId, usageAmount);
      totalCostUsd = base.costUsd * effectiveConfig.modelMultiplier * effectiveConfig.groupMultiplier;
    }

    const totalCostCny = totalCostUsd * 7.25;

    const creditsConsumed = this.calcCredits(
      usageAmount,
      inputTokens,
      outputTokens,
      effectiveConfig,
    );

    const creditValueCny = creditsConsumed * 0.01;

    return {
      inputCostUsd: Number(inputCostUsd.toFixed(6)),
      outputCostUsd: Number(outputCostUsd.toFixed(6)),
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalCostCny: Number(totalCostCny.toFixed(4)),
      creditsConsumed,
      creditValueCny: Number(creditValueCny.toFixed(4)),
      multiplier: effectiveConfig,
    };
  }

  /**
   * 计算积分消耗 (向上取整)
   *
   * LLM: credits = ceil(usageAmount / creditUnitSize × creditPerUnit)
   * Image/Video/Audio: credits = ceil(usageAmount × creditPerUnit)
   */
  private calcCredits(
    usageAmount: number,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    config: MultiplierConfig,
  ): number {
    if (config.creditPerUnit <= 0 || usageAmount <= 0) return 0;

    if (config.unitType === 'token') {
      const tokens = inputTokens && outputTokens ? inputTokens + outputTokens : usageAmount;
      return Math.ceil((tokens / config.creditUnitSize) * config.creditPerUnit);
    } else {
      return Math.ceil(usageAmount * config.creditPerUnit);
    }
  }

  /**
   * 预估算积分消耗 (用于预冻结)
   *
   * @param userId 可选用户 ID：传入时按用户订阅计划的分组倍率参与估算
   */
  async estimateCredits(
    modelType: string,
    provider: string,
    modelId: string,
    estimatedUsage: number,
    userId?: string,
  ): Promise<number> {
    const config = await this.getConfig(modelType, provider, modelId);
    const planMultiplier = userId ? await this.getUserGroupMultiplier(userId) : null;
    const effectiveConfig: MultiplierConfig = {
      ...config,
      groupMultiplier: planMultiplier ?? config.groupMultiplier,
    };
    return this.calcCredits(estimatedUsage, undefined, undefined, effectiveConfig);
  }

  /**
   * 查询用户当前订阅计划的分组倍率
   * 无有效订阅时返回 null（调用方回退到配置值）
   */
  private async getUserGroupMultiplier(userId: string): Promise<number | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { planCode: true, planExpiresAt: true },
      });
      if (!user?.planCode || !user.planExpiresAt || user.planExpiresAt.getTime() <= Date.now()) {
        return null;
      }
      const plan = await this.prisma.plan.findUnique({
        where: { code: user.planCode },
        select: { multiplier: true },
      });
      return plan?.multiplier ?? null;
    } catch (err) {
      this.logger.warn(`查询用户订阅计划倍率失败: ${err}`);
      return null;
    }
  }
}
