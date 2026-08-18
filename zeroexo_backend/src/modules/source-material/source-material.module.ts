import { Module } from '@nestjs/common';
import { SourceMaterialController } from './source-material.controller';
import { SourceMaterialService } from './source-material.service';

/**
 * 源素材模块 - 跟踪前端上传的原始素材经过资产引擎处理后的关联信息。
 */
@Module({
  controllers: [SourceMaterialController],
  providers: [SourceMaterialService],
  exports: [SourceMaterialService],
})
export class SourceMaterialModule {}