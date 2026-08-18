import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiProvidersService } from './api-providers.service';

/**
 * 管理员 API Provider 管理接口 - 仪表盘/用量/设置默认
 * 主 CRUD + presets 走 ApiProvidersController(/admin/api-providers),本类只补充:
 * - dashboard:  仪表盘聚合(健康/限额告警)
 * - getUsage:   用量统计(由 UsageTrackerService 实际实现)
 *
 * 全部走 JwtAuthGuard + AdminGuard 双重鉴权
 */
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@ApiTags('AdminApiProviders')
@Controller('admin/api-providers')
export class ApiProvidersAdminController {
  constructor(private readonly service: ApiProvidersService) {}

  /**
   * 仪表盘聚合(健康/限额告警/总数分布)
   * GET /admin/api-providers/dashboard
   */
  @Get('dashboard')
  @ApiOperation({ summary: '[Admin] API 设置总览仪表盘' })
  async dashboard() {
    const items = await this.service.list({});
    const byType: Record<string, number> = {};
    const byHealth: Record<string, number> = {};
    const alerts: Array<{
      id: string;
      name: string;
      type: string;
      reason: string;
      severity: 'warning' | 'critical';
    }> = [];

    for (const p of items) {
      byType[p.type] = (byType[p.type] || 0) + 1;
      byHealth[p.health] = (byHealth[p.health] || 0) + 1;
      if (p.health === 'down') {
        alerts.push({
          id: p.id,
          name: p.name,
          type: p.type,
          reason: p.healthError || '服务不可用',
          severity: 'critical',
        });
      } else if (p.health === 'degraded') {
        alerts.push({
          id: p.id,
          name: p.name,
          type: p.type,
          reason: p.healthError || '性能下降',
          severity: 'warning',
        });
      }
    }

    return { total: items.length, byType, byHealth, alerts };
  }

  /**
   * 获取用量统计(占位,完整实现由 UsageTrackerService 提供)
   * GET /admin/api-providers/:id/usage?days=7
   */
  @Get(':id/usage')
  @ApiOperation({ summary: '[Admin] 获取用量统计' })
  async getUsage(@Param('id') _id: string, @Query('days') days?: string) {
    const daysN = days ? parseInt(days, 10) : 7;
    return { items: [], days: daysN };
  }
}
