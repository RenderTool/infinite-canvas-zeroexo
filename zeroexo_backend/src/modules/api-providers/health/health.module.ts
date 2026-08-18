import { Module } from '@nestjs/common';
import { ApiHealthService } from './api-health.service';
import { ApiHealthController } from './api-health.controller';
import { ConsoleAlertHook } from './alerts/console-alert.hook';
import { WebhookAlertHook } from './alerts/webhook-alert.hook';
import { EmailAlertHook } from './alerts/email-alert.hook';
import { ApiProvidersModule } from '../api-providers.module';
import { LogsModule } from '../../logs/logs.module';
import { AuthModule } from '../../auth/auth.module';

/**
 * ApiHealthModule - API Provider 健康检查模块
 *
 * 装配:
 * - ApiHealthService: 定时调度 + 状态管理 + 告警分发
 * - ApiHealthController: 管理员查询 / 触发接口
 * - 3 个 AlertHook 实现: console(主) / webhook(占位) / email(占位)
 *
 * ScheduleModule.forRoot() 已在 AppModule 全局注册,本模块无需重复。
 *
 * 依赖关系:
 * - ApiProvidersModule: 提供 5 个 Adapter(Ai/Email/OAuth/Storage/Payment)实例
 * - LogsModule: 提供 LogsService,告警时写一条 system 分类日志
 * - AuthModule: 提供 JwtAuthGuard / AdminGuard
 */
@Module({
  imports: [ApiProvidersModule, LogsModule, AuthModule],
  controllers: [ApiHealthController],
  providers: [
    ApiHealthService,
    ConsoleAlertHook,
    WebhookAlertHook,
    EmailAlertHook,
  ],
  exports: [ApiHealthService],
})
export class ApiHealthModule {}
