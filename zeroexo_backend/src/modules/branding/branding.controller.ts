/**
 * BrandingController - 公开品牌配置接口
 *
 * GET /api/branding → 登录页/门户页拉取品牌配置(无需登录)
 */

import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrandingService } from './branding.service';

@ApiTags('Branding')
@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '获取当前品牌配置(公开)' })
  async getBranding() {
    return this.brandingService.getConfig();
  }
}