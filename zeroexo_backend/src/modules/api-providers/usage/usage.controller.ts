import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { ApiUsageService, UsagePeriod } from './api-usage.service';
import { ResetUsageDto, UsageQueryDto } from './dto/usage.dto';

/**
 * 用量管理 Controller(管理员)
 *
 * 路由前缀: /admin/api-providers/usage
 * 全部走 JwtAuthGuard + AdminGuard 双重鉴权
 *
 * 端点:
 * - GET  /                                所有 provider 用量概览
 * - GET  /:id                             单个 provider 详细用量
 * - GET  /:id/quota                       额度状态
 * - GET  /:id/stats                       统计信息
 * - POST /:id/reset                       重置用量计数(敏感操作,会写审计日志)
 */
@ApiTags('AdminApiProviderUsage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/api-providers/usage')
export class UsageController {
  constructor(private readonly usageService: ApiUsageService) {}

  /**
   * 所有 provider 用量概览
   * GET /admin/api-providers/usage
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 所有 provider 用量概览' })
  async overview() {
    const items = await this.usageService.getAllProvidersOverview();
    return { items };
  }

  /**
   * 单个 provider 详细用量
   * GET /admin/api-providers/usage/:id
   *
   * 支持查询参数:metric / window / startDate / endDate
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 单个 provider 详细用量' })
  async findOne(
    @Param('id') id: string,
    @Query() query: UsageQueryDto,
  ) {
    const end = query.endDate ?? new Date();
    const start = query.startDate ?? new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const metric = query.metric ?? 'request';
    const window = query.window ?? 'day';

    const series = await this.usageService.getUsage(
      id,
      metric,
      window,
      start,
      end,
    );
    return { providerId: id, metric, window, start, end, series };
  }

  /**
   * 额度状态
   * GET /admin/api-providers/usage/:id/quota
   */
  @Get(':id/quota')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 额度状态(日/月用量、百分比、告警等级)' })
  async quota(@Param('id') id: string) {
    return this.usageService.getQuotaStatus(id);
  }

  /**
   * 统计信息
   * GET /admin/api-providers/usage/:id/stats?period=week&metric=request
   */
  @Get(':id/stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 统计信息(总数/均值/峰值/趋势)' })
  async stats(
    @Param('id') id: string,
    @Query('period') period: UsagePeriod = 'week',
    @Query('metric') metric: string = 'request',
  ) {
    return this.usageService.getUsageStats(id, period, metric);
  }

  /**
   * 重置用量计数(敏感操作)
   * POST /admin/api-providers/usage/:id/reset
   *
   * 仅超级管理员可调用 - 上层 admin 路由已通过 AdminGuard 拦截普通管理员。
   * 实际写审计日志由调用方注入,本接口从 req.user 读取操作者信息。
   */
  @Post(':id/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] 重置用量计数(敏感操作,会写审计日志)' })
  async reset(
    @Param('id') id: string,
    @Body() dto: ResetUsageDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as
      | { id: string; username: string; role: string }
      | undefined;
    const actor = {
      actorId: user?.id ?? 'unknown',
      actorName: user?.username ?? 'unknown',
      actorRole: user?.role ?? 'unknown',
      reason: dto.reason,
    };
    return this.usageService.resetUsage(id, dto.window, actor);
  }
}
