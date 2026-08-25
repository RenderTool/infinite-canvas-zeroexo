import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ApiProvidersModule } from '../api-providers/api-providers.module';
import { LogsModule } from '../logs/logs.module';
import { AiEventsModule } from '../ai-events/ai-events.module';
import { BillingModule } from '../billing/billing.module';
import { AiGenerateController } from './ai-generate.controller';
import { AiGenerateAdminController } from './ai-generate.admin.controller';
import { ModelTemplatesController } from './model-templates.controller';
import { AiGenerateService } from './ai-generate.service';
import { AiGenerateAssetService } from './ai-generate.asset.service';
import { AiThinkPromptService } from './ai-generate.think-prompt.service';
import { AiThinkExecutorService } from './ai-generate.think-executor.service';
import { AiThinkTaskService } from './ai-generate.think-task.service';
import { AiThinkStreamService } from './ai-generate.think-stream.service';
import { AiGenerateWorker } from './ai-generate.worker';

/**
 * AI 生成代理模块 - P3.3 (Stage E)
 *
 * Provider 抽象 + 5 适配器 + 生成接口 + 产物落 Asset
 *
 * 依赖:
 *   - AssetsModule: 提供 MinioService(用于直接上传生成产物)
 *   - ApiProvidersModule: 提供 ApiProvidersService(type='ai' 渠道管理 + 凭证解密) + TemplateRegistryService(模型模板库)
 *   - LogsModule: 提供 LogsService(记录 AI 生成事件)
 *   - BillingModule: 提供 BillingIntegrationService(积分扣费 + 消费记录)
 *
 * 适配器(adapter.factory + 5 个 adapter)无状态,Nest 不需注册为 provider,
 * 由 service 内通过 getAdapter() 工厂函数直接获取。
 *
 * 模板库注册表归属 ApiProvidersModule（与渠道管理同模块，避免模块循环依赖），
 * 本模块通过 imports ApiProvidersModule 直接注入。
 */
@Module({
  imports: [AssetsModule, ApiProvidersModule, LogsModule, AiEventsModule, BillingModule],
  controllers: [AiGenerateController, AiGenerateAdminController, ModelTemplatesController],
  providers: [
    AiGenerateService,
    AiGenerateAssetService,
    AiThinkPromptService,
    AiThinkExecutorService,
    AiThinkTaskService,
    AiThinkStreamService,
    AiGenerateWorker,
  ],
  exports: [AiGenerateService],
})
export class AiGenerateModule {}
