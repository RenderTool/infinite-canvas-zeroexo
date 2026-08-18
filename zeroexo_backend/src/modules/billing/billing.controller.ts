/**
 * 计费控制器 — 积分账户/充值/消费查询
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Param,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CreditService } from './credit.service';
import { MultiplierService } from './multiplier.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { notFound } from '../../common/errors/app-exception.js';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/billing')
export class BillingController {
  constructor(
    private readonly creditService: CreditService,
    private readonly multiplierService: MultiplierService,
    private readonly prisma: PrismaService,
  ) {}

  // === 积分账户 ===

  @Get('credits/:userId')
  async getCreditBalance(@Param('userId') userId: string) {
    return this.creditService.getBalance(userId);
  }

  @Post('credits/:userId/recharge')
  async recharge(
    @Param('userId') userId: string,
    @Body() body: { credits: number; operatorId?: string; remark?: string },
  ) {
    return this.creditService.recharge(userId, body.credits, body.operatorId, body.remark);
  }

  @Post('credits/:userId/refund')
  async refund(
    @Param('userId') userId: string,
    @Body() body: { credits: number; referenceId?: string; remark?: string },
  ) {
    return this.creditService.refund(userId, body.credits, body.referenceId, body.remark);
  }

  // === 消费记录 ===

  @Get('credits/:userId/consumptions')
  async getConsumptions(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.creditService.getConsumptions(userId, {
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('credits/:userId/transactions')
  async getTransactions(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.creditService.getTransactions(userId, {
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
    });
  }

  // === 定价配置 ===

  @Get('pricing-config')
  async listPricingConfig(
    @Query('modelType') modelType?: string,
    @Query('provider') provider?: string,
    @Query('enabled') enabled?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (modelType) where.modelType = modelType;
    if (provider) where.provider = provider;
    if (enabled !== undefined) where.enabled = enabled === 'true';

    return this.prisma.pricingConfig.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('pricing-config')
  async createPricingConfig(
    @Body()
    body: {
      modelType: string;
      provider: string;
      modelId: string;
      unitType: string;
      modelMultiplier?: number;
      completionMultiplier?: number;
      groupMultiplier?: number;
      creditPerUnit?: number;
      creditUnitSize?: number;
      enabled?: boolean;
      notes?: string;
    },
  ) {
    const existing = await this.prisma.pricingConfig.findUnique({
      where: {
        modelType_provider_modelId: {
          modelType: body.modelType,
          provider: body.provider,
          modelId: body.modelId,
        },
      },
    });

    if (existing) {
      return this.prisma.pricingConfig.update({
        where: { id: existing.id },
        data: {
          unitType: body.unitType,
          modelMultiplier: body.modelMultiplier ?? 1,
          completionMultiplier: body.completionMultiplier ?? 1,
          groupMultiplier: body.groupMultiplier ?? 1,
          creditPerUnit: body.creditPerUnit ?? 0,
          creditUnitSize: body.creditUnitSize ?? 1000,
          enabled: body.enabled ?? true,
          notes: body.notes,
        },
      });
    }

    return this.prisma.pricingConfig.create({
      data: {
        modelType: body.modelType,
        provider: body.provider,
        modelId: body.modelId,
        unitType: body.unitType,
        modelMultiplier: body.modelMultiplier ?? 1,
        completionMultiplier: body.completionMultiplier ?? 1,
        groupMultiplier: body.groupMultiplier ?? 1,
        creditPerUnit: body.creditPerUnit ?? 0,
        creditUnitSize: body.creditUnitSize ?? 1000,
        enabled: body.enabled ?? true,
        notes: body.notes,
      },
    });
  }

  @Post('pricing-config/:id')
  async updatePricingConfig(
    @Param('id') id: string,
    @Body()
    body: {
      modelMultiplier?: number;
      completionMultiplier?: number;
      groupMultiplier?: number;
      creditPerUnit?: number;
      creditUnitSize?: number;
      enabled?: boolean;
      notes?: string;
    },
  ) {
    const config = await this.prisma.pricingConfig.findUnique({ where: { id } });
    if (!config) throw notFound('NOT_FOUND', 'Pricing config not found');

    const updated = await this.prisma.pricingConfig.update({
      where: { id },
      data: body,
    });

    // 清除缓存
    this.multiplierService.invalidateCache(config.modelType, config.provider, config.modelId);

    return updated;
  }

  // === 成本估算 ===

  @Post('estimate')
  async estimateCost(
    @Body()
    body: {
      modelType: string;
      provider: string;
      modelId: string;
      usageAmount: number;
      inputTokens?: number;
      outputTokens?: number;
    },
  ) {
    return this.multiplierService.calculateCost(body);
  }

  // === 计费统计 ===

  @Get('stats/summary')
  async getBillingSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (startDate) where.createdAt = { gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...(where.createdAt as object), lte: new Date(endDate) };

    const consumptions = await this.prisma.consumptionLog.findMany({ where });

    const totalCredits = consumptions.reduce((sum, c) => sum + (c.creditsConsumed || 0), 0);
    const totalCostUsd = consumptions.reduce((sum, c) => sum + (c.upstreamCostUsd || 0), 0);
    const totalCostCny = totalCostUsd * 7.25;
    const totalRevenueCny = consumptions.reduce((sum, c) => sum + (c.creditValueCny || 0), 0);
    const grossProfitCny = totalRevenueCny - totalCostCny;
    const marginRate = totalRevenueCny > 0 ? (grossProfitCny / totalRevenueCny) * 100 : 0;

    return {
      totalCalls: consumptions.length,
      totalCreditsConsumed: totalCredits,
      totalUpstreamCostUsd: totalCostUsd,
      totalUpstreamCostCny: totalCostCny,
      totalRevenueCny,
      grossProfitCny,
      marginRate: Math.round(marginRate * 100) / 100,
    };
  }
}
