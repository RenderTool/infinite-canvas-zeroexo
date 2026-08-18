import { Module } from '@nestjs/common';
import { PublicPromptsService } from './public-prompts.service';
import { PublicPromptsController } from './public-prompts.controller';
import { PublicPromptsAdminController } from './public-prompts.admin.controller';
import { PromptFavoritesModule } from '../prompt-favorites/prompt-favorites.module';

@Module({
  imports: [PromptFavoritesModule],
  controllers: [PublicPromptsController, PublicPromptsAdminController],
  providers: [PublicPromptsService],
  exports: [PublicPromptsService],
})
export class PublicPromptsModule {}