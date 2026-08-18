/**
 * BrandingModule - 品牌配置模块
 *
 * 提供:
 * - GET    /api/branding            (公开,供登录页使用)
 * - GET    /api/admin/branding      (管理员)
 * - PUT    /api/admin/branding      (管理员)
 * - POST   /api/admin/branding/upload   (管理员,上传视频)
 * - DELETE /api/admin/branding/file     (管理员,删除视频)
 */

import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller';
import { BrandingAdminController } from './branding.admin.controller';
import { BrandingService } from './branding.service';
import { AssetsModule } from '../assets/assets.module';

@Module({
  imports: [AssetsModule],
  controllers: [BrandingController, BrandingAdminController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}