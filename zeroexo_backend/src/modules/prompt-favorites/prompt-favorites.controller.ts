import { Controller, Post, Delete, Get, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PromptFavoritesService } from './prompt-favorites.service';
import { FavoritePromptDto } from './dto/prompt-favorite.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Prompt Favorites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('prompts/favorites')
export class PromptFavoritesController {
  constructor(private readonly service: PromptFavoritesService) {}

  @Post()
  @ApiOperation({ summary: '收藏公共提示词' })
  favorite(@CurrentUser('id') userId: string, @Body() dto: FavoritePromptDto) {
    return this.service.favorite(userId, dto.promptId);
  }

  @Delete(':promptId')
  @ApiOperation({ summary: '取消收藏公共提示词' })
  unfavorite(@CurrentUser('id') userId: string, @Param('promptId') promptId: string) {
    return this.service.unfavorite(userId, promptId);
  }

  @Get()
  @ApiOperation({ summary: '获取用户收藏的公共提示词列表' })
  listFavorites(@CurrentUser('id') userId: string) {
    return this.service.listFavorites(userId);
  }
}