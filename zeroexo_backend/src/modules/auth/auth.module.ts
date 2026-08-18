import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshStrategy } from './strategies/refresh.strategy';
import { LogsModule } from '../logs/logs.module';
import { ApiProvidersModule } from '../api-providers/api-providers.module';

/**
 * 认证模块 - 注册 JWT / Refresh 策略与认证服务。
 * - JwtModule 使用 registerAsync 从 ConfigService 读取密钥与默认过期时间
 * - 策略(provider)一旦注册,AuthGuard('jwt') / AuthGuard('jwt-refresh') 全局可用
 */
@Module({
  imports: [
    PassportModule,
    LogsModule,
    forwardRef(() => ApiProvidersModule),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // 密钥已由 jwt.config.ts 在加载时集中校验,缺失会导致启动失败
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: {
          expiresIn: config.get<string>('jwt.accessExpiresIn') ?? '15m',
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, RefreshStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
