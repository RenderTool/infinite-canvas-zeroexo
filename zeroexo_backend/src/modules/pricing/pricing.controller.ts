/**
 * 定价目录 Controller
 *
 * 路径前缀: /admin/pricing
 * - GET /admin/pricing/catalog            列出全部定价条目(只读)
 *
 * 权限: 管理员(沿用 AdminGuard,与 api-providers 一致)
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PricingService } from './pricing.service';

@Controller('admin/pricing')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /** 列出全部定价条目(供前端只读展示与本地计价) */
  @Get('catalog')
  listCatalog() {
    const items = this.pricingService.listCatalog();
    return { items };
  }
}
