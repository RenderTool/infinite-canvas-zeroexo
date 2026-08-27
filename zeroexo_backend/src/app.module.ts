import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AppThrottlerModule } from './common/throttler/throttler.module';
import { ApiThrottlerGuard } from './common/throttler/guards/api-throttler.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { StudioModule } from './modules/studio/studio.module';
import { PromptsModule } from './modules/prompts/prompts.module';
import { AssetsModule } from './modules/assets/assets.module';
import { FoldersModule } from './modules/folders/folders.module';
import { AiGenerateModule } from './modules/ai-generate/ai-generate.module';
import { SyncModule } from './modules/sync/sync.module';
import { UserAiPreferenceModule } from './modules/user-ai-preference/user-ai-preference.module';
import { LogsModule } from './modules/logs/logs.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AiEventsModule } from './modules/ai-events/ai-events.module';
import { EmailModule } from './modules/email/email.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { AuditLogModule } from './modules/audit/audit-log.module';
import { StorageModule } from './modules/storage/storage.module';
import { ApiProvidersModule } from './modules/api-providers/api-providers.module';
import { ApiHealthModule } from './modules/api-providers/health/health.module';
import { AiChatModule } from './modules/ai-chat/ai-chat.module';
import { AgentModule } from './modules/agent/agent.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { BillingModule } from './modules/billing/billing.module';
import { HealthModule } from './modules/health/health.module';
import { ResourceClassificationModule } from './modules/resources/resource-classification.module';
import { SourceMaterialModule } from './modules/source-material/source-material.module';
import { StoryboardModule } from './modules/storyboard/storyboard.module';
import { VideoPromptModule } from './modules/video-prompt/video-prompt.module';
import { ScriptsModule } from './modules/scripts/scripts.module';
import { PublicPromptsModule } from './modules/public-prompts/public-prompts.module';
import { PromptFavoritesModule } from './modules/prompt-favorites/prompt-favorites.module';
import { PoliciesModule } from './modules/policies/policies.module';
import { BrandingModule } from './modules/branding/branding.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';

import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import aiConfig from './config/ai.config';
import { throttlerConfig } from './common/throttler/throttler.config';

/**
 * 应用根模块 - 装配配置、Prisma 与各业务模块。
 *
 * 安全加固(Stage H.1 - API 速率限制):
 * - 通过 AppThrottlerModule 装配三档位限流:
 *   短时 60s/100,中时 5min/500,长时 1h/3000。
 * - ApiThrottlerGuard 增强:
 *   1. getTracker 优先 userId,未登录回退 IP
 *   2. 仅显式配置的 THROTTLE_WHITELIST 跳过限流(不再默认放行内网段,
 *      反代部署下内网前缀会导致限流失效,内网信任请显式配置)
 *   3. 触发限流抛出标准化 429,含 retryAfter / limit / remaining / resetAt
 *   4. 触发时记录日志 + 1h 内 ≥10 次告警
 * - 关键端点使用 @ShortThrottle() / @LoginThrottle() / @AiThrottle() 等
 *   业务级装饰器覆盖默认档位。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig, aiConfig, throttlerConfig],
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    // 必须先于 AppThrottlerModule:LogsService 用于 ThrottlerMonitorService 埋点
    LogsModule,
    // 全局限流模块(三档位 + 自定义 Guard + 监控服务)
    AppThrottlerModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    StudioModule,
    PromptsModule,
    AssetsModule,
    FoldersModule,
    AiGenerateModule,
    // Yjs 实时同步（Hocuspocus 挂载到现有 HTTP server）
    SyncModule,
    UserAiPreferenceModule,
    SettingsModule,
    AiEventsModule,
    EmailModule,
    AnalyticsModule,
    MonitoringModule,
    AuditLogModule,
    StorageModule,
    // API Provider 统一模块(CRUD + Adapter 路由)
    ApiProvidersModule,
    // API Provider 健康检查调度(每 5 分钟,启动时立即一次)
    ApiHealthModule,
    // AI 对话测试(管理员页面)
    AiChatModule,
    // Agent 执行框架(编排/工具/LLM 循环)
    AgentModule,
    // 定价目录 + 消费金额计算
    PricingModule,
    // 计费模块 — 积分账户/倍率体系/消费记录
    BillingModule,
    // 服务健康检查(用于 Docker HEALTHCHECK / 负载均衡探测)
    HealthModule,
    // 资源分类 — 配置驱动的统一资源查询引擎（替代 assets admin / projects admin 中的硬编码查询）
    ResourceClassificationModule,
    // 源素材模块 — 跟踪前端上传的原始素材经过资产引擎处理后的关联信息
    SourceMaterialModule,
    // 分镜模块 — 按集分镜生成(Phase 4)
    StoryboardModule,
    // 视频提示词生成模块 — 从分镜字段生成 imagePrompt/videoPrompt
    VideoPromptModule,
    // 剧本模块 — 格式化章节、缓存、重试
    ScriptsModule,
    PublicPromptsModule,
    PromptFavoritesModule,
    PoliciesModule,
    BrandingModule,
    // 协作模块 — 协作房间管理/邀请码/成员管理/消息/同账户多设备自动协作
    CollaborationModule,
  ],
  providers: [
    // 全局注册自定义限流 Guard:覆盖默认 getTracker / 响应格式 / 白名单
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
  ],
})
export class AppModule {}
