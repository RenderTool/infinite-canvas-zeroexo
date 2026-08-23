import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiGenerateService } from './ai-generate.service';
import { AiThinkTaskService } from './ai-generate.think-task.service';
import { AiThinkStreamService } from './ai-generate.think-stream.service';
import { GenerateRequestDto } from './dto/generate-request.dto';
import { getTemplatesByType } from './templates/built-in-templates';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiThrottle } from '../../common/throttler/decorators/throttle.decorator';

/** 批量删除请求 DTO */
class BatchDeleteDto {
  ids!: string[];
}

/**
 * AI 生成代理控制器 - P3.3
 * 端点:
 *   POST /api/ai/generate                 执行生成请求(同步返回结果 assetId)
 *   GET  /api/ai/generations              分页查询生成历史(可按 status/kind 过滤)
 *   GET  /api/ai/generations/:id          获取单条生成记录
 *   POST /api/ai/generations/:id/cancel   取消生成任务(仅 pending/running 可取消)
 *
 * 安全加固(Stage H.1 - API 速率限制 + 成本保护):
 * - generate 端点 @AiThrottle 60s 3 次/用户,严控 AI 调用费用滥用。
 * - cancel 端点 @AiThrottle 60s 5 次/用户,防止"提交-取消"循环攻击。
 * (service 层另叠加:pending+running 任务上限、取消冷却)
 */
@ApiTags('AiGenerate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiGenerateController {
  constructor(
    private readonly aiGenerateService: AiGenerateService,
    private readonly aiThinkTaskService: AiThinkTaskService,
    private readonly aiThinkStreamService: AiThinkStreamService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '执行 AI 生成请求(产物自动落素材库)' })
  @AiThrottle({ ttl: 60_000, limit: 3 })
  generate(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateRequestDto,
  ) {
    return this.aiGenerateService.generate(userId, dto);
  }

  @Get('channels')
  @ApiOperation({ summary: '列出当前可用的 AI 渠道(含解密 apiKey + baseUrl)' })
  channels(
    @CurrentUser('id') userId: string,
    @Query('capability') capability?: string,
  ) {
    return this.aiGenerateService.listChannels(userId, capability);
  }

  /**
   * 获取指定模型类型的参数模板(供 C 端节点生成面板动态渲染参数表单)
   * GET /api/ai/templates?type=image|video|audio
   */
  @Get('templates')
  @ApiOperation({ summary: '获取参数模板列表(按模型类型过滤)' })
  templates(@Query('type') type?: string) {
    if (!type) return getTemplatesByType('image');
    return getTemplatesByType(type);
  }

  @Post('think')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI 深度思考 — 创建异步任务，返回 taskId' })
  @AiThrottle({ ttl: 30_000, limit: 3 })
  async think(
    @CurrentUser() user: any,
    @Body()
    body: {
      providerId: string;
      model: string;
      kind: 'inspire' | 'genre' | 'script_import';
      projectId?: string;
      locale?: string;
      projectData: {
        name?: string;
        genre?: string;
        resolution?: string;
        aspectRatio?: string;
        duration?: string;
        /** 剧本导入内容（用于 script_import 模式） */
        content?: string;
        /** 分集模式 */
        episodeMode?: 'auto' | 'manual' | 'none';
        /** 期望集数（manual 模式有效） */
        episodeCount?: number;
      };
    },
  ) {
    const taskId = await this.aiThinkTaskService.createThinkTask(user.id, body);
    // 异步处理，不阻塞响应
    this.aiThinkTaskService.processThinkTask(taskId).catch(async (err) => {
      // 兜底：标记任务失败，防止卡在 pending
      console.error(`背景 think 任务 ${taskId} 异常:`, err.message);
      try {
        // cancelThinkTask 将 pending/running 任务标记为 failed
        await this.aiThinkTaskService.cancelThinkTask(user.id, taskId);
      } catch { /* 兜底不影响主流程 */ }
    });
    return { taskId };
  }

  @Post('think/stream')
  @Sse()
  @ApiOperation({ summary: 'AI 深度思考 — 流式 SSE，逐字返回推理过程和可点击建议项' })
  @AiThrottle({ ttl: 30_000, limit: 3 })
  thinkStream(
    @CurrentUser() _user: any,
    @Body()
    body: {
      providerId: string;
      model: string;
      kind: 'inspire' | 'genre' | 'script_import';
      locale?: string;
      projectData: {
        name?: string;
        genre?: string;
        resolution?: string;
        aspectRatio?: string;
        duration?: string;
        /** 剧本导入内容（用于 script_import 模式） */
        content?: string;
        /** 分集模式 */
        episodeMode?: 'auto' | 'manual' | 'none';
        /** 期望集数（manual 模式有效） */
        episodeCount?: number;
      };
    },
  ): Observable<{ data: any }> {
    return new Observable((subscriber) => {
      const run = async () => {
        try {
          const generator = this.aiThinkStreamService.streamThink(
            body.providerId,
            body.model,
            body.kind,
            body.projectData,
            body.locale ?? 'zh',
          );
          for await (const event of generator) {
            subscriber.next({ data: event });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      };
      run();
    });
  }

  @Get('think/:taskId')
  @ApiOperation({ summary: '获取 AI 思考任务状态和步骤' })
  getThinkTask(
    @CurrentUser('id') userId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.aiThinkTaskService.getThinkTask(userId, taskId);
  }

  @Post('think/:taskId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消 AI 思考任务' })
  cancelThinkTask(
    @CurrentUser('id') userId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.aiThinkTaskService.cancelThinkTask(userId, taskId);
  }

  @Post('think/cancel-all-active')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消指定项目中所有活跃思考任务（页面恢复前执行）' })
  cancelAllActiveThinkTasks(
    @CurrentUser('id') userId: string,
    @Body() body: { projectId: string; thinkKind?: string },
  ) {
    return this.aiThinkTaskService.cancelAllActiveThinkTasks(userId, body.projectId, body.thinkKind);
  }

  @Get('think/active/:projectId/:thinkKind')
  @ApiOperation({ summary: '查找项目中活跃的思考任务' })
  findActiveThinkTask(
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @Param('thinkKind') thinkKind: string,
  ) {
    return this.aiThinkTaskService.findActiveThinkTask(userId, projectId, thinkKind);
  }

  @Get('generations')
  @ApiOperation({ summary: '分页查询生成历史(可按 status/kind 过滤)' })
  list(
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    return this.aiGenerateService.list(
      userId,
      cursor,
      limit ? Number(limit) : undefined,
      status,
      kind,
    );
  }

  @Get('generations/:id')
  @ApiOperation({ summary: '获取单条生成记录' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.aiGenerateService.findOne(userId, id);
  }

  @Post('generations/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '取消生成任务(仅 pending/running 可取消)' })
  @AiThrottle({ ttl: 60_000, limit: 5 })
  cancel(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.aiGenerateService.cancelTask(userId, id);
  }

  @Delete('generations/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除单条生成记录(仅删除记录,不删除关联素材)' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.aiGenerateService.remove(userId, id);
  }

  @Get('generations/:id/progress')
  @ApiOperation({ summary: '获取 format-chapters 任务的进度' })
  getProgress(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.aiThinkTaskService.getFormatChaptersProgress(userId, id);
  }

  @Post('generations/batch-delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '批量删除生成记录(仅删除记录,不删除关联素材)' })
  batchRemove(
    @CurrentUser('id') userId: string,
    @Body() dto: BatchDeleteDto,
  ) {
    return this.aiGenerateService.batchRemove(userId, dto.ids);
  }
}
