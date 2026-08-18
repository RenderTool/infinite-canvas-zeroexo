/**
 * 订阅计划管理控制器 — 定价分组(Plan) CRUD + 用户订阅授予/回退
 *
 * 全部走 JwtAuthGuard + AdminGuard 双重鉴权（与其它 admin 控制器一致）。
 * 路由前缀: /admin/plans
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PlanService } from './plan.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/plans')
export class PlanAdminController {
  constructor(private readonly planService: PlanService) {}

  // === Plan CRUD ===

  @Get()
  list(@Query('enabled') enabled?: string) {
    if (enabled !== undefined) {
      return this.planService.listEnabledPlans();
    }
    return this.planService.listPlans();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.planService.getPlan(id);
  }

  @Post()
  create(
    @Body()
    body: {
      code: string;
      name: string;
      description?: string;
      multiplier?: number;
      creditsPerCycle?: number;
      monthlyPrice?: number;
      quarterlyPrice?: number;
      yearlyPrice?: number;
      seats?: number;
      enabled?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.planService.createPlan(body);
  }

  @Post(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      multiplier?: number;
      creditsPerCycle?: number;
      monthlyPrice?: number;
      quarterlyPrice?: number;
      yearlyPrice?: number;
      seats?: number;
      enabled?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.planService.updatePlan(id, body);
  }

  @Post(':id/delete')
  delete(@Param('id') id: string) {
    return this.planService.deletePlan(id);
  }

  // === 用户订阅 ===

  @Get('users/:userId/plan')
  getUserPlan(@Param('userId') userId: string) {
    return this.planService.getUserPlan(userId);
  }

  @Get('users/:userId/subscriptions')
  getUserSubscriptions(@Param('userId') userId: string) {
    return this.planService.listUserSubscriptions(userId);
  }

  @Post('users/:userId/subscribe')
  subscribe(
    @Param('userId') userId: string,
    @Body()
    body: {
      planId: string;
      cycle?: 'month' | 'quarter' | 'year';
      seats?: number;
      renewMode?: 'manual' | 'auto';
      extend?: boolean;
    },
  ) {
    return this.planService.grantSubscription(userId, body.planId, body);
  }

  @Post('users/:userId/cancel')
  cancel(
    @Param('userId') userId: string,
    @Body() body: { subscriptionId?: string },
  ) {
    return this.planService.cancelSubscription(userId, body?.subscriptionId);
  }

  @Post('users/:userId/reset')
  reset(@Param('userId') userId: string) {
    return this.planService.resetToFree(userId);
  }

  // === 到期回退（手动触发，另有定时任务） ===

  @Post('expire-overdue')
  expireOverdue() {
    return this.planService.expireOverdueSubscriptions();
  }
}
