/**
 * 用户侧积分控制器 — 查看自己的余额、消耗明细、流水
 *
 * 路径前缀: /api/credits (全局前缀 api + 控制器 credits)
 * 权限: 仅 JwtAuthGuard (用户登录即可, 不需要管理员)
 */
import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreditService } from './credit.service';

interface AuthedRequest extends Request {
  user: { id: string };
}

@Controller('credits')
@UseGuards(JwtAuthGuard)
export class BillingUserController {
  constructor(private readonly creditService: CreditService) {}

  /** 查询当前用户积分余额 */
  @Get('balance')
  async getBalance(@Req() req: AuthedRequest) {
    return this.creditService.getBalance(req.user.id);
  }

  /** 查询当前用户消耗明细 */
  @Get('consumptions')
  async getConsumptions(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.creditService.getConsumptions(req.user.id, {
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  /** 查询当前用户积分流水 */
  @Get('transactions')
  async getTransactions(
    @Req() req: AuthedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.creditService.getTransactions(req.user.id, {
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
    });
  }
}
