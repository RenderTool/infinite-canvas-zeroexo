/**
 * SettingsController - 后台配置管理 API
 *
 * 路由(受全局 /api 前缀影响):
 * - GET  /api/admin/settings          → 获取当前配置
 * - PUT  /api/admin/settings          → 更新配置(仅写入文件,不迁移)
 * - POST /api/admin/settings/migrate  → 迁移存储文件到新路径
 */

import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SettingsService } from './settings.service';
import { GcScheduleService } from './gc-schedule.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly gcScheduleService: GcScheduleService,
  ) {}

  /** 获取当前配置 */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getSettings() {
    return this.settingsService.getSettings();
  }

  /** 更新配置(仅写入配置文件,不执行文件迁移) */
  @Put()
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @Body() body: { storageRoot?: string; smtp?: any; oauth?: any; schedules?: any },
  ) {
    return this.settingsService.updateSettings(body);
  }

  /**
   * 迁移存储:将旧路径文件复制到新路径,然后切换 storageRoot
   * @param body.storageRoot 新存储根目录
   */
  @Post('migrate')
  @HttpCode(HttpStatus.OK)
  async migrateStorage(@Body() body: { storageRoot: string }) {
    if (!body.storageRoot || typeof body.storageRoot !== 'string') {
      throw new Error('storageRoot is required');
    }
    return this.settingsService.migrateStorage(body.storageRoot);
  }

  /** 获取 GC 定时任务配置 */
  @Get('schedules')
  @HttpCode(HttpStatus.OK)
  async getSchedules() {
    return this.gcScheduleService.getScheduleConfig();
  }

  /** 更新 GC 定时任务配置 */
  @Put('schedules')
  @HttpCode(HttpStatus.OK)
  async updateSchedules(
    @Body()
    body: {
      resourceGc?: { cron?: string; enabled?: boolean; retentionDays?: number };
      userCleanup?: { cron?: string; enabled?: boolean; retentionDays?: number };
    },
  ) {
    return this.gcScheduleService.updateScheduleConfig(body as any);
  }
}
