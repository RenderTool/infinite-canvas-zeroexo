/**
 * StorageModule - 提供可插拔的存储后端(local / s3 / oss / cos)
 *
 * 设计为全局模块(@Global),所有业务模块(assets / ai-generate / settings)
 * 都可以直接注入 StorageService,无需在每个 Module 重复 import。
 *
 * 兼容策略:
 * - 保留原有 MinioService 类名与接口,通过 storage.module 的 export 暴露
 * - MinioService 作为薄壳(委托给 StorageService),业务侧无感
 */

import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageAdminController } from './storage-admin.controller';

@Global()
@Module({
  controllers: [StorageAdminController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
