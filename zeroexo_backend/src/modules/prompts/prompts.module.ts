import { Module } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { PromptsController } from './prompts.controller';
import { AdminPromptsController } from './prompts.admin.controller';
import { PromptImagesService } from './prompt-images.service';
import { PromptImagesController } from './prompt-images.controller';
import { LogsModule } from '../logs/logs.module';

/**
 * 提示词模块 - 提供提示词 CRUD、多图关联与同步能力。
 *
 * PrismaModule 已是全局模块,无需在此重复 import。
 */
@Module({
  imports: [LogsModule],
  controllers: [PromptsController, AdminPromptsController, PromptImagesController],
  providers: [PromptsService, PromptImagesService],
  exports: [PromptsService, PromptImagesService],
})
export class PromptsModule {}
