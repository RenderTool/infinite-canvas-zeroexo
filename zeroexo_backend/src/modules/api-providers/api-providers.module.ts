import { Module, forwardRef } from '@nestjs/common';
import { ApiProvidersService } from './api-providers.service';
import { ApiProvidersController } from './api-providers.controller';
import { ApiProvidersAdminController } from './api-providers.admin.controller';
import { AiAdapter } from './adapters/ai.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { OAuthAdapter } from './adapters/oauth.adapter';
import { StorageAdapter } from './adapters/storage.adapter';
import { PaymentAdapter } from './adapters/payment.adapter';
import { UsageTrackerService } from './usage/usage-tracker.service';
import { QuotaService } from './usage/quota.service';
import { ApiUsageService } from './usage/api-usage.service';
import { UsageController } from './usage/usage.controller';
import { UsageCleanupService } from './usage/usage-cleanup.service';
import { RecordUsageInterceptor } from './usage/interceptors/record-usage.interceptor';
import { UsageTrackerGuard } from './usage/guards/usage-tracker.guard';
import { ConsoleAlertHook } from './usage/hooks/console-alert.hook';
import { StorageMigrationController } from './migration/storage-migration.controller';
import { StorageMigrationService } from './migration/storage-migration.service';
import { AuthModule } from '../auth/auth.module';
import { AuditLogModule } from '../audit/audit-log.module';
import { StorageModule } from '../storage/storage.module';
import { LogsModule } from '../logs/logs.module';
import { TemplateRegistryService } from '../ai-generate/templates/registry.service';

/**
 * API Provider 统一模块
 *
 * 提供:
 * - 统一 CRUD: GET/POST/PATCH/DELETE /admin/api-providers
 * - 健康检查: POST /admin/api-providers/:id/test
 * - 默认切换: POST /admin/api-providers/:id/default
 * - 业务调用: POST /admin/api-providers/:id/invoke
 * - 用量追踪:
 *   - UsageTrackerService:  旧版基础记录接口
 *   - ApiUsageService:      新版服务(支持聚合 / 统计 / 告警 / 重置)
 *   - UsageController:      /admin/api-providers/usage 系列管理接口
 *   - UsageCleanupService:  每周日 03:30 清理过期记录
 *   - RecordUsage / TrackUsage 装饰器 + Guard / Interceptor
 * - 额度管理: QuotaService (全局可用)
 * - 存储迁移(Stage F): /admin/storage-migration/jobs[/:id] 跨 driver 数据迁移
 * - 存储子适配器: 复用 StorageModule 的 StorageService
 */
@Module({
  imports: [forwardRef(() => AuthModule), AuditLogModule, StorageModule, LogsModule],
  controllers: [
    ApiProvidersController,
    ApiProvidersAdminController,
    StorageMigrationController,
    UsageController,
  ],
  providers: [
    ApiProvidersService,
    AiAdapter,
    EmailAdapter,
    OAuthAdapter,
    StorageAdapter,
    PaymentAdapter,
    UsageTrackerService,
    QuotaService,
    ApiUsageService,
    UsageCleanupService,
    ConsoleAlertHook,
    RecordUsageInterceptor,
    UsageTrackerGuard,
    StorageMigrationService,
    TemplateRegistryService,
  ],
  exports: [
    ApiProvidersService,
    UsageTrackerService,
    QuotaService,
    ApiUsageService,
    ConsoleAlertHook,
    RecordUsageInterceptor,
    UsageTrackerGuard,
    AiAdapter,
    EmailAdapter,
    OAuthAdapter,
    StorageAdapter,
    PaymentAdapter,
    StorageMigrationService,
    TemplateRegistryService,
  ],
})
export class ApiProvidersModule {}
