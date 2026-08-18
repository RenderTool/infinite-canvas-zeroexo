import { Module } from '@nestjs/common';
import { PromptFavoritesService } from './prompt-favorites.service';
import { PromptFavoritesController } from './prompt-favorites.controller';

@Module({
  controllers: [PromptFavoritesController],
  providers: [PromptFavoritesService],
  exports: [PromptFavoritesService],
})
export class PromptFavoritesModule {}