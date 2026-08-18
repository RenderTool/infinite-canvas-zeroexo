/**
 * Throttler 模块 - 封装 ThrottlerModule.forRootAsync,统一装配限流模块。
 *
 * 通过 ConfigService 读取 throttler 配置档位,允许运行时通过环境变量调整
 * (后续如需支持 Redis 分布式存储,只需在此处切换 storage provider)。
 *
 * 该模块在 AppModule 中通过 imports 注册,限流 Guard 在 AppModule 中
 * 通过 APP_GUARD 单独注册到全局。
 */

import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ThrottlerModule as NestThrottlerModule,
} from '@nestjs/throttler';
import { throttlerConfig, THROTTLER_CONFIG_KEY } from './throttler.config';
import { ApiThrottlerGuard } from './guards/api-throttler.guard';
import { ThrottlerMonitorService } from './services/throttler-monitor.service';

/**
 * 全局限流模块:提供 ThrottlerModule + 自定义 Guard + 监控服务。
 *
 * - ConfigModule 需在 AppModule 中已通过 forRoot({ isGlobal: true }) 注册,
 *   此处使用 ConfigService 读取 throttler 配置。
 * - ApiThrottlerGuard 需被外部通过 APP_GUARD 注入到全局(在 AppModule 中完成),
 *   这里仅 export 供 APP_GUARD 引用。
 */
@Global()
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cfg = config.get<ReturnType<typeof throttlerConfig>>(THROTTLER_CONFIG_KEY);
        if (!cfg) {
          // 兜底:使用硬编码默认档位
          return {
            throttlers: [
              { name: 'short', ttl: 60_000, limit: 100 },
              { name: 'medium', ttl: 300_000, limit: 500 },
              { name: 'long', ttl: 3_600_000, limit: 3_000 },
            ],
            errorMessage: '请求过于频繁,请稍后再试',
          };
        }
        return cfg.options;
      },
    }),
  ],
  providers: [ApiThrottlerGuard, ThrottlerMonitorService],
  exports: [ApiThrottlerGuard, ThrottlerMonitorService, NestThrottlerModule],
})
export class AppThrottlerModule {}
