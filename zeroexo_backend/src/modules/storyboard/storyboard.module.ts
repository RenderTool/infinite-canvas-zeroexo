import { Module } from '@nestjs/common';
import { AiGenerateModule } from '../ai-generate/ai-generate.module';
import { PromptsModule } from '../prompts/prompts.module';
import { StoryboardController } from './storyboard.controller';
import { StoryboardService } from './storyboard.service';

/**
 * 分镜模块 - Phase 4
 *
 * 提供按集分镜生成能力。
 * 依赖:
 *   - AiGenerateModule: 提供 AI 文本生成能力
 *   - PromptsModule: 提供提示词模板加载
 */
@Module({
  imports: [AiGenerateModule, PromptsModule],
  controllers: [StoryboardController],
  providers: [StoryboardService],
  exports: [StoryboardService],
})
export class StoryboardModule {}