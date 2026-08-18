import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScriptsService } from './scripts.service';
import {
  FormatChaptersDto,
  FormatChaptersRetryDto,
} from './dto/format-chapters.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiThrottle } from '../../common/throttler/decorators/throttle.decorator';

/**
 * 剧本控制器 — 格式化章节、进度查询、重试
 *
 * 端点:
 *   POST /api/scripts/format-chapters       格式化章节(主入口)
 *   POST /api/scripts/format-chapters/retry  重试失败的单元
 */
@ApiTags('Scripts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('scripts')
export class ScriptsController {
  constructor(private readonly scriptsService: ScriptsService) {}

  @Post('format-chapters')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '格式化章节 — 将 zeroexo-text 资产中的选定单元格式化为章节' })
  @AiThrottle({ ttl: 60_000, limit: 3 })
  formatChapters(
    @CurrentUser('id') userId: string,
    @Body() dto: FormatChaptersDto,
  ) {
    return this.scriptsService.formatChapters(userId, {
      zeroexoTextAssetId: dto.zeroexoTextAssetId,
      modelId: dto.modelId,
      concurrency: dto.concurrency,
      unitIndices: dto.unitIndices,
    });
  }

  @Get('format-chapters/:generationId/progress')
  @ApiOperation({ summary: '查询格式化章节任务的进度' })
  getProgress(
    @CurrentUser('id') userId: string,
    @Param('generationId') generationId: string,
  ) {
    return this.scriptsService.getProgress(userId, generationId);
  }

  @Post('format-chapters/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试格式化章节中失败的单元' })
  @AiThrottle({ ttl: 60_000, limit: 3 })
  retry(
    @CurrentUser('id') userId: string,
    @Body() dto: FormatChaptersRetryDto,
  ) {
    return this.scriptsService.retryFailedUnits(userId, {
      generationId: dto.generationId,
      unitIndices: dto.unitIndices,
    });
  }
}