import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { notFound } from '../../common/errors/app-exception';
import { AiThinkExecutorService } from './ai-generate.think-executor.service';
import { AiThinkPromptService } from './ai-generate.think-prompt.service';

/** 思考任务的可执行步骤 */
interface ThinkStep {
  text: string;
  suggestions?: Array<{ label: string; value: string }>;
}

/**
 * AI 思考异步任务服务
 *
 * 负责「灵感 / 类型分析 / 剧本导入」三类 AI 思考的异步任务生命周期：
 * 创建（createThinkTask）→ 后台处理（processThinkTask）→ 查询（getThinkTask）
 * → 取消（cancelThinkTask / cancelAllActiveThinkTasks）
 * → 活跃任务恢复（findActiveThinkTask）
 * → 剧本分集进度（getFormatChaptersProgress）
 *
 * 渠道解析 / 剧本分批 / LLM 调用复用 AiThinkExecutorService，
 * prompt 组装复用 AiThinkPromptService。
 */
@Injectable()
export class AiThinkTaskService {
  private readonly logger = new Logger(AiThinkTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly executor: AiThinkExecutorService,
    private readonly promptService: AiThinkPromptService,
  ) {}

  /**
   * 创建异步思考任务（AiGeneration 记录）
   */
  async createThinkTask(
    userId: string,
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
        content?: string;
        episodeMode?: 'auto' | 'manual' | 'none';
        episodeCount?: number;
      };
    },
  ): Promise<string> {
    const provider = await this.prisma.apiProvider.findUnique({
      where: { id: body.providerId },
    });
    const record = await this.prisma.aiGeneration.create({
      data: {
        ownerId: userId,
        providerId: body.providerId,
        providerName: provider?.name ?? 'unknown',
        model: body.model,
        kind: `think_${body.kind}`,
        prompt: `AI Think: ${body.kind}`,
        status: 'pending',
        projectId: body.projectId ?? null,
        params: {
          thinkKind: body.kind,
          locale: body.locale ?? 'zh',
          projectData: body.projectData,
          steps: [],
        },
      },
    });
    return record.id;
  }

  /**
   * 处理思考任务（后台异步）
   */
  async processThinkTask(taskId: string): Promise<void> {
    let rawParams: Record<string, any> = {};
    try {
      const generation = await this.prisma.aiGeneration.findUnique({
        where: { id: taskId },
      });
      if (!generation) return;
      // 如果任务已成终态（可能被 controller.catch 取消），直接退出
      if (generation.status === 'failed' || generation.status === 'success') {
        this.logger.warn(`思考任务 ${taskId} 已是终态 (${generation.status})，跳过处理`);
        return;
      }

      // 标记 running
      await this.prisma.aiGeneration.update({
        where: { id: taskId, status: 'pending' },
        data: { status: 'running' },
      });

      rawParams = (generation.params as Record<string, any>) || {};
      const locale = (rawParams.locale as string) || 'zh';
      const body = {
        providerId: generation.providerId!,
        model: generation.model,
        kind: rawParams.thinkKind as 'inspire' | 'genre' | 'script_import',
        projectId: generation.projectId,
        projectData: rawParams.projectData as Record<string, any>,
      };

      // 1. 获取渠道并解密（executor 共享，错误消息与原逻辑一致）
      const ctx = await this.executor.resolveContext(body.providerId);

      // 2. 构建 prompt（传递 locale 以控制 LLM 回复语言）
      const langHint = this.promptService.langInstruct(locale);
      const skillAgentType =
        body.kind === 'script_import'
          ? 'script_import'
          : body.kind === 'inspire'
            ? 'inspire_name'
            : 'genre_analyzer';
      const systemPrompt = this.promptService.buildSystemPrompt(skillAgentType, {
        baseInfo:
          body.kind === 'script_import'
            ? undefined
            : this.promptService.buildBaseInfo(body.projectData),
        langHint,
      });

      // 3. 分批拆分(长剧本):超过 chunk 阈值时按 chunk 分批调 LLM,汇总剧集
      let chunkedSteps: Array<ThinkStep> | null = null;
      if (body.kind === 'script_import') {
        const content = (body.projectData?.content as string) || '';
        const chunkSize = this.config.get<number>('ai.scriptChunkSize') ?? 40000;
        if (content.length > chunkSize) {
          const episodes = await this.executor.runScriptSplitChunked({
            url: ctx.url,
            apiKey: ctx.apiKey,
            model: body.model,
            systemPrompt,
            content,
            episodeMode: (body.projectData.episodeMode as 'auto' | 'manual' | 'none') || 'auto',
            episodeCount: Number(body.projectData.episodeCount) || 0,
            chunkSize,
            // 任务级断点:每完成一个 chunk 即持久化进度,中断后可查询恢复
            onProgress: async (done, total) => {
              try {
                await this.prisma.aiGeneration.updateMany({
                  where: { id: taskId, status: 'running' },
                  data: {
                    params: {
                      ...rawParams,
                      chunkProgress: { done, total },
                    } as Prisma.InputJsonValue,
                  },
                });
              } catch { /* 进度持久化失败不阻塞主流程 */ }
            },
          });
          chunkedSteps = [{ text: JSON.stringify({ episodes }), suggestions: [] }];
        }
      }

      // 4. 调用 LLM(仅非分批场景)
      const timeoutMs = this.config.get<number>('ai.requestTimeoutMs') ?? 60000;

      // 最终 steps(非分批场景由下方解析填充;分批场景由 chunkedSteps 填充)
      let steps: Array<ThinkStep> = [];

      if (!chunkedSteps) {
        const content = await this.executor.chatJsonCompletion({
          url: ctx.url,
          apiKey: ctx.apiKey,
          model: body.model,
          systemPrompt,
          userMessage: this.promptService.buildUserMessage(body.kind, body.projectData, locale),
          maxTokens: body.kind === 'script_import' ? 65536 : 1024,
          timeoutMs,
        });

        // 解析 steps
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        const rawContent = codeBlockMatch ? codeBlockMatch[1]! : content;

        for (const line of rawContent.split('\n')) {
          const trimmed = line.trim();
          const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'step') {
              steps.push({ text: event.text || '', suggestions: event.suggestions || [] });
            }
          } catch { /* skip */ }
        }

        if (steps.length === 0) {
          try {
            const root = JSON.parse(content.replace(/^data:\s*/gm, '').trim());
            if (Array.isArray(root.steps)) {
              for (const s of root.steps) {
                steps.push({ text: s.text || '', suggestions: s.suggestions || [] });
              }
            } else if (root.type === 'step') {
              steps.push({ text: root.text || '', suggestions: root.suggestions || [] });
            }
          } catch { /* skip */ }
        }
      } // 分批场景 steps 走 chunkedSteps

      if (chunkedSteps) {
        steps = chunkedSteps;
      }
      // 空结果:标记 errorCode 供前端翻译,但仍以 success 状态保存
      const emptyResult = steps.length === 0;
      if (emptyResult) {
        steps.push({ text: 'AI is unable to provide suggestions at this time. Please try again later.', suggestions: [] });
      }

      // 5. 保存结果（仅当任务仍处于 running 状态，防止覆盖已取消的任务）
      const updateResult = await this.prisma.aiGeneration.updateMany({
        where: { id: taskId, status: 'running' },
        data: {
          status: 'success',
          errorCode: emptyResult ? ErrorCode.AI_THINK_EMPTY : null,
          params: { ...rawParams, steps } as unknown as Prisma.InputJsonValue,
        },
      });
      // 如果 updateMany 未匹配到记录（任务已被取消），静默退出
      if (updateResult.count === 0) {
        this.logger.warn(`思考任务 ${taskId} 保存结果时已被取消`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`思考任务 ${taskId} 失败: ${message}`);
      // 优先透传 AppException 携带的稳定错误码;否则回退通用 AI_THINK_FAILED
      const code = (err as any)?.response?.code ?? ErrorCode.AI_THINK_FAILED;
      // 兼容 'pending'（尚未转为 running）和 'running' 两种状态
      await this.prisma.aiGeneration.updateMany({
        where: { id: taskId, status: { in: ['pending', 'running'] } },
        data: {
          status: 'failed',
          errorMessage: message.slice(0, 1000),
          errorCode: code,
          params: { ...rawParams, steps: [] } as Prisma.InputJsonValue,
        },
      });
    }
  }

  /**
   * 获取思考任务状态和步骤
   */
  async getThinkTask(userId: string, taskId: string) {
    const task = await this.prisma.aiGeneration.findFirst({
      where: { id: taskId, ownerId: userId },
      select: {
        id: true,
        status: true,
        params: true,
        errorMessage: true,
        errorCode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!task) throw notFound(ErrorCode.THINK_TASK_NOT_FOUND, 'Think task not found');
    const params = (task.params as Record<string, any>) || {};
    return {
      id: task.id,
      status: task.status,
      steps: params.steps ?? [],
      thinkKind: params.thinkKind ?? null,
      // 分批拆分进度(断点恢复用):{ done, total }
      chunkProgress: params.chunkProgress ?? null,
      errorMessage: task.errorMessage,
      errorCode: task.errorCode,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  /**
   * 取消思考任务（幂等，不管任务当前状态均尝试标记为 cancelled）
   */
  async cancelThinkTask(userId: string, taskId: string) {
    const result = await this.prisma.aiGeneration.updateMany({
      where: { id: taskId, ownerId: userId, status: { in: ['pending', 'running'] } },
      data: {
        status: 'failed',
        errorMessage: 'Cancelled by user',
        errorCode: ErrorCode.THINK_CANCELLED,
      },
    });
    // 幂等：即使任务已结束也不抛异常
    return { message: result.count > 0 ? 'cancelled' : 'task_finished' };
  }

  /**
   * 取消指定项目中所有活跃思考任务（页面恢复前批量清理）
   */
  async cancelAllActiveThinkTasks(userId: string, projectId: string, thinkKind?: string) {
    const kindFilter = thinkKind ? { kind: `think_${thinkKind}` } : { kind: { startsWith: 'think_' } as any };
    const result = await this.prisma.aiGeneration.updateMany({
      where: {
        ownerId: userId,
        projectId,
        ...kindFilter,
        status: { in: ['pending', 'running'] },
      },
      data: {
        status: 'failed',
        errorMessage: 'Terminated automatically on page refresh (stale session)',
        errorCode: ErrorCode.THINK_TERMINATED,
      },
    });
    return { cancelled: result.count };
  }

  /**
   * 获取 format-chapters 任务的进度
   * 通过 AiGeneration 记录的 params 读取
   */
  async getFormatChaptersProgress(userId: string, generationId: string) {
    const gen = await this.prisma.aiGeneration.findUnique({
      where: { id: generationId },
    });
    if (!gen || gen.ownerId !== userId) {
      throw notFound(ErrorCode.AI_GENERATION_NOT_FOUND, 'Generation record not found or no access');
    }
    const params = (gen.params as Record<string, any>) || {};
    return {
      status: gen.status,
      totalUnits: params.totalUnits ?? 0,
      completedUnits: params.completedUnits ?? 0,
      failedUnits: params.failedUnits ?? 0,
      costTokens: gen.costTokens ?? 0,
      results: params.results ?? [],
      scriptAssetId: gen.resultAssetId ?? undefined,
      errorMessage: gen.errorMessage ?? undefined,
      errorCode: gen.errorCode ?? undefined,
    };
  }

  /**
   * 查找项目中活跃的思考任务
   */
  async findActiveThinkTask(userId: string, projectId: string, thinkKind: string) {
    // 1. 清理超过 2 分钟的陈旧 pending/running 任务（匹配前端 120s 超时）
    const staleThreshold = new Date(Date.now() - 2 * 60 * 1000);
    await this.prisma.aiGeneration.updateMany({
      where: {
        ownerId: userId,
        projectId,
        kind: `think_${thinkKind}`,
        status: { in: ['pending', 'running'] },
        createdAt: { lt: staleThreshold },
      },
      data: {
        status: 'failed',
        errorMessage: 'Task timed out (stale task auto-cleaned)',
        errorCode: ErrorCode.AI_GENERATION_TIMEOUT,
      },
    });

    // 2. 查找真正的活跃任务
    const task = await this.prisma.aiGeneration.findFirst({
      where: {
        ownerId: userId,
        projectId,
        kind: `think_${thinkKind}`,
        status: { in: ['pending', 'running'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, params: true },
    });
    if (!task) return null;
    const params = (task.params as Record<string, any>) || {};
    return {
      id: task.id,
      status: task.status,
      steps: params.steps ?? [],
      thinkKind: params.thinkKind ?? null,
    };
  }
}