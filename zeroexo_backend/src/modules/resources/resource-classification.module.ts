import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ResourceClassificationService } from './resource-classification.service';
import { ResourceClassificationController } from './resource-classification.controller';

/**
 * 资源分类模块 — 配置驱动的统一资源查询引擎
 *
 * 提供：
 *   - ResourceClassificationService：统一查询引擎
 *   - ResourceClassificationController：配置 API + 统一资源列表 API
 *
 * 所有分类逻辑均由 resource-classification.config.ts 单一事实源驱动。
 */
@Module({
  imports: [PrismaModule],
  providers: [ResourceClassificationService],
  controllers: [ResourceClassificationController],
})
export class ResourceClassificationModule {}
