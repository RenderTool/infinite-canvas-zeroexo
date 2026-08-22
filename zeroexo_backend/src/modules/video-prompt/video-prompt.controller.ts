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
import { AiThrottle } from '../../common/throttler/decorators/throttle.decorator';
import { VideoPromptService } from './video-prompt.service';
import { ShotInputDto } from './dto/generate-video-prompt.dto';
import { GenerateVideoPromptBatchDto } from './dto/generate-video-prompt-batch.dto';

/**
 * 视频提示词生成控制器
 *
 * 端点:
 *   POST /api/video-prompt/generate        单镜头生成
 *   POST /api/video-prompt/generate-batch  批量生成
 */
@ApiTags('Video Prompt')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('video-prompt')
export class VideoPromptController {
  constructor(private readonly videoPromptService: VideoPromptService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '单镜头生成 imagePrompt 和 videoPrompt' })
  @AiThrottle({ ttl: 60_000, limit: 30 })
  generate(@Body() dto: ShotInputDto) {
    return this.videoPromptService.generateVideoPrompt(dto);
  }

  @Post('generate-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '批量生成 imagePrompt 和 videoPrompt' })
  @AiThrottle({ ttl: 60_000, limit: 10 })
  generateBatch(@Body() dto: GenerateVideoPromptBatchDto) {
    return this.videoPromptService.generateVideoPromptBatch(dto.shots);
  }
}