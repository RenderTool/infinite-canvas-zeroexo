/**
 * SettingsModule - 后台配置管理模块
 *
 * 依赖:
 * - AssetsModule(提供 MinioService,用于读取/修改存储路径)
 * - LogsModule(提供 LogsService,用于记录配置变更日志)
 *
 * SettingsService 实现 OnModuleInit,启动时自动加载配置文件
 */

import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { GcScheduleService } from './gc-schedule.service';
import { AssetsModule } from '../assets/assets.module';
import { UsersModule } from '../users/users.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [AssetsModule, UsersModule, LogsModule],
  controllers: [SettingsController],
  providers: [SettingsService, GcScheduleService],
  exports: [SettingsService, GcScheduleService],
})
export class SettingsModule {}
