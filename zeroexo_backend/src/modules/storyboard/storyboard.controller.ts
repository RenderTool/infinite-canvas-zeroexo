import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiThrottle } from '../../common/throttler/decorators/throttle.decorator';
import { StoryboardService } from './storyboard.service';
import { StoryboardEpisodeDto } from './dto/storyboard-episode.dto';

/**
 * 分镜控制器 - Phase 4
 *
 * 端点:
 *   POST /api/storyboard/episode  按集生成分镜镜头
 */
@ApiTags('Storyboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storyboard')
export class StoryboardController {
  constructor(private readonly storyboardService: StoryboardService) {}

  @Post('episode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '按集生成分镜镜头(单集)' })
  @AiThrottle({ ttl: 60_000, limit: 5 })
  generateEpisode(
    @CurrentUser('id') userId: string,
    @Body() dto: StoryboardEpisodeDto,
  ) {
    return this.storyboardService.generateEpisode(userId, dto);
  }
}