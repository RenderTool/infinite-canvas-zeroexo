import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

/**
 * 定价目录模块
 *
 * - 静态 JSON 目录(catalog.ts)在首次访问时加载并缓存
 * - PricingService 提供目录只读 + 消费金额聚合(注入全局 PrismaService)
 */
@Module({
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
