/**
 * 计费模块 — 积分/倍率/消费记录
 *
 * PrismaModule 为全局模块, PrismaService 无需在此重复声明
 */
import { Module } from '@nestjs/common';
import { MultiplierService } from './multiplier.service';
import { CreditService } from './credit.service';
import { BillingIntegrationService } from './billing-integration.service';
import { BillingReconciliationService } from './billing-reconciliation.service';
import { PlanService } from './plan.service';
import { PlanAdminController } from './plan.admin.controller';
import { BillingController } from './billing.controller';
import { BillingUserController } from './billing-user.controller';

@Module({
  controllers: [BillingController, BillingUserController, PlanAdminController],
  providers: [MultiplierService, CreditService, BillingIntegrationService, BillingReconciliationService, PlanService],
  exports: [MultiplierService, CreditService, BillingIntegrationService, BillingReconciliationService, PlanService],
})
export class BillingModule {}
