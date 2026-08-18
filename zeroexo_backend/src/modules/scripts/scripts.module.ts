import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { ApiProvidersModule } from '../api-providers/api-providers.module';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';

/**
 * 剧本模块 — 格式化章节、缓存、重试
 *
 * 依赖:
 *   - AssetsModule: 提供 AssetsService(用于创建剧本 Asset)
 *   - ApiProvidersModule: 提供 ApiProvidersService(用于获取 AI 渠道)
 */
@Module({
  imports: [AssetsModule, ApiProvidersModule],
  controllers: [ScriptsController],
  providers: [ScriptsService],
  exports: [ScriptsService],
})
export class ScriptsModule {}