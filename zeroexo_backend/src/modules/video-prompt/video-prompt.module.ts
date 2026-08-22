import { Module } from '@nestjs/common';
import { VideoPromptController } from './video-prompt.controller';
import { VideoPromptService } from './video-prompt.service';

/**
 * 视频提示词生成模块
 *
 * 从分镜字段生成视频生成模型可消费的 imagePrompt 和 videoPrompt。
 * 纯模板化生成，不依赖 AI 调用。
 */
@Module({
  controllers: [VideoPromptController],
  providers: [VideoPromptService],
  exports: [VideoPromptService],
})
export class VideoPromptModule {}