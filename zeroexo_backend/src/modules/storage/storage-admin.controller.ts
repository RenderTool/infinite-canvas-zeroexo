/**
 * StorageAdminController - 存储管理后台接口(健康检查 + 连接测试)
 *
 * 路由(受全局 /api 前缀影响):
 * - GET  /api/admin/storage/health          获取所有 driver 健康状态
 * - POST /api/admin/storage/test-connection  测试指定 driver 连接
 *
 * 全部走 JwtAuthGuard + AdminGuard 双重鉴权
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { StorageService, createDriver } from './storage.service';
import type { StorageDriverName } from './storage-driver.interface';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/storage')
export class StorageAdminController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * 获取所有 driver 健康状态(primary + secondary)
   * GET /admin/storage/health
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  async getHealth() {
    const health = await this.storageService.healthCheckAll();
    return { health };
  }

  /**
   * 测试指定 driver 连接(不切换,仅验证配置)
   * POST /admin/storage/test-connection
   */
  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Body() body: { driver: StorageDriverName; options?: Record<string, any> }) {
    const start = Date.now();
    try {
      const driver = createDriver({
        driver: body.driver,
        options: body.options ?? {},
      });
      await driver.init();
      const health = await driver.healthCheck();
      const latencyMs = Date.now() - start;
      return {
        ok: health.ok,
        message: health.ok ? '连接成功' : health.error || '连接失败',
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        ok: false,
        message: err instanceof Error ? err.message : '连接失败',
        latencyMs,
      };
    }
  }
}
