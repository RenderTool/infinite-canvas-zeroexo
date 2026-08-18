import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { ApiHealthService } from './api-health.service';
import { HealthHistoryQuery, HealthStatus } from './dto/health.dto';

/**
 * ApiHealthController - API Provider 健康检查管理接口
 *
 * 路由(均挂载在全局 /api 前缀下):
 * - GET    /api/admin/api-providers/health              列出所有 provider 健康概览
 * - GET    /api/admin/api-providers/health/:id          单个 provider 健康详情
 * - GET    /api/admin/api-providers/health/:id/history  历史健康日志(默认 7 天)
 * - POST   /api/admin/api-providers/health/:id/check    立即触发单次检查
 * - POST   /api/admin/api-providers/health/check-all    立即触发全量检查
 *
 * 全部走 JwtAuthGuard + AdminGuard 双重鉴权,仅管理员可访问。
 */
@ApiTags('AdminApiProviderHealth')
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/api-providers/health')
export class ApiHealthController {
  constructor(private readonly healthService: ApiHealthService) {}

  /**
   * 列出所有 provider 的当前健康状态
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 列出所有 API Provider 的健康状态' })
  async list() {
    return {
      items: await this.healthService.getOverview(),
    };
  }

  /**
   * 单个 provider 的健康详情
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 获取单个 API Provider 的健康详情' })
  async getOne(@Param('id') id: string) {
    return this.healthService.getOne(id);
  }

  /**
   * 单个 provider 的健康历史日志
   *
   * Query 参数:
   * - days: 查询最近多少天(默认 7,最大 90)
   * - status: 按状态过滤(healthy | degraded | down | unknown)
   * - limit: 最大返回条数(默认 500,最大 5000)
   */
  @Get(':id/history')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 获取单个 API Provider 的健康历史日志' })
  async getHistory(
    @Param('id') id: string,
    @Query('days') days?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const query: HealthHistoryQuery = {
      days: days !== undefined ? Number(days) : 7,
      status: (status as HealthStatus) || undefined,
      limit: limit !== undefined ? Number(limit) : 500,
    };
    return this.healthService.getHistory(id, query);
  }

  /**
   * 立即对单个 provider 触发一次健康检查
   */
  @Post(':id/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 立即触发单个 API Provider 的健康检查' })
  async checkOne(@Param('id') id: string) {
    const result = await this.healthService.checkOne(id);
    return { result };
  }

  /**
   * 立即触发全量健康检查
   */
  @Post('check-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 立即触发全量 API Provider 健康检查' })
  async checkAll() {
    const results = await this.healthService.runHealthChecks('manual');
    return {
      count: results.length,
      down: results.filter((r) => r.status === 'down').length,
      degraded: results.filter((r) => r.status === 'degraded').length,
      healthy: results.filter((r) => r.status === 'healthy').length,
      results,
    };
  }
}
