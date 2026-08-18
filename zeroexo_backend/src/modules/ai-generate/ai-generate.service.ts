import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { badRequest, forbidden, notFound } from '../../common/errors/app-exception.js';
import { MinioService } from '../assets/minio.service';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { LogsService } from '../logs/logs.service';
import { AiEventsService } from '../ai-events/ai-events.service';
import { BillingIntegrationService } from '../billing/billing-integration.service';
import { getAdapter } from './adapters/adapter.factory';
import {
  AdapterContext,
  GenerateKind,
  GenerateRequest,
} from './adapters/adapter.interface';
import { GenerateRequestDto } from './dto/generate-request.dto';
import { recommendTemplate } from './templates/built-in-templates';
import { AiGenerateAssetService } from './ai-generate.asset.service';
import { AiThinkPromptService } from './ai-generate.think-prompt.service';
import { getDefaultBaseUrl } from './ai-generate.utils';

/**
 * AI 生成编排服务
 *
 * 职责：
 *   1. 渠道解析 + 前置校验（pending 上限、取消冷却、计费）
 *   2. 文本生成同步执行（generateTextSync）
 *   3. 异步任务处理（processPendingTask）→ 适配器调用 → 结果落 Asset
 *   4. 生成历史 CRUD + 取消任务
 *   5. 渠道列表查询
 *
 * 思考类功能（灵感/类型分析/剧本导入）移至 AiThinkTaskService / AiThinkStreamService。
 * 结果持久化逻辑移至 AiGenerateAssetService。
 */
@Injectable()
export class AiGenerateService {
  private readonly logger = new Logger(AiGenerateService.name);

  /**
   * 运行中任务的 AbortController 映射
   *
   * key: generationId
   * value: AbortController
   *
   * 由 processPendingTask 注册（任务进入 running 后创建），
   * 由 cancelTask 调用 controller.abort() 中断正在进行的 HTTP 请求，
   * 由 processPendingTask 的 finally 块清理。
   */
  private readonly abortControllers = new Map<string, AbortController>();

  /**
   * 用户取消冷却映射
   *
   * key: userId
   * value: 冷却过期时间戳(ms, Date.now() + cooldownMs)
   *
   * 由 cancelTask 在成功取消后写入（防止"提交-取消"循环滥用），
   * 由 generate 在提交前检查；过期项在检查时自动清理，避免内存泄漏。
   */
  private readonly cancelCooldowns = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly minio: MinioService,
    private readonly providersService: ApiProvidersService,
    private readonly logsService: LogsService,
    private readonly aiEventsService: AiEventsService,
    private readonly billingService: BillingIntegrationService,
    private readonly assetService: AiGenerateAssetService,
    private readonly thinkPromptService: AiThinkPromptService,
  ) {}

  /**
   * 校验渠道归属: 系统级渠道(ownerId 为空)或归属当前用户才允许使用,
   * 用户级渠道仅允许本人使用,否则抛异常。
   */
  private assertProviderAccess(provider: { id: string; name?: string; ownerId: string | null }, userId: string): void {
    if (provider.ownerId !== null && provider.ownerId !== userId) {
      throw forbidden(
        ErrorCode.CHANNEL_UNAVAILABLE,
        `Channel "${provider.name ?? provider.id}" belongs to another user and cannot be used`,
      );
    }
  }

  /** 异步提交生成请求：验证渠道后创建 pending 记录，立即返回 generationId */
  async generate(userId: string, dto: GenerateRequestDto) {
    // 1. 解析渠道(优先用指定 providerId,否则用 type='ai' 的默认,最后回退到第一个启用的渠道)
    let provider;
    if (dto.providerId) {
      provider = await this.providersService.getRawById(dto.providerId);
    } else {
      provider = await this.providersService.getDefaultRaw('ai')
        ?? await this.prisma.apiProvider.findFirst({
          where: { type: 'ai', enabled: true },
          orderBy: { createdAt: 'asc' },
        });
    }

    if (!provider) {
      throw badRequest(
        ErrorCode.CHANNEL_NOT_FOUND,
        'No AI channel configured. Please add an AI channel in API settings first',
      );
    }
    if (provider.type !== 'ai') {
      throw badRequest(
        ErrorCode.CHANNEL_UNAVAILABLE,
        `Provider ${provider.name} is not of AI type`,
      );
    }
    if (!provider.enabled) {
      throw badRequest(
        ErrorCode.CHANNEL_UNAVAILABLE,
        `Channel ${provider.name} is disabled`,
      );
    }
    // 渠道归属校验: 系统级渠道或归属当前用户才允许使用
    this.assertProviderAccess(provider, userId);

    // 2. 成本保护：待处理任务上限检查
    const pendingCount = await this.prisma.aiGeneration.count({
      where: { ownerId: userId, status: { in: ['pending', 'running'] } },
    });
    const maxPending =
      this.config.get<number>('ai.maxPendingTasksPerUser') ?? 3;
    if (pendingCount >= maxPending) {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        `${pendingCount} task(s) already queued/processing. Please wait before submitting more (max ${maxPending})`,
      );
    }

    // 3. 成本保护：取消冷却检查
    const cooldownExpiresAt = this.cancelCooldowns.get(userId);
    if (cooldownExpiresAt && cooldownExpiresAt > Date.now()) {
      const remainSeconds = Math.ceil(
        (cooldownExpiresAt - Date.now()) / 1000,
      );
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        `Please wait ${remainSeconds} second(s) before submitting again after cancellation`,
      );
    } else if (cooldownExpiresAt) {
      this.cancelCooldowns.delete(userId);
    }

    // 4. 计费前置检查
    const modelTypeMap: Record<string, string> = {
      text: 'llm', image: 'image', video: 'video', audio: 'audio',
    };
    const billingCheck = await this.billingService.beforeGenerate(userId, {
      modelType: modelTypeMap[dto.kind] ?? dto.kind,
      provider: provider.provider,
      modelId: dto.model,
      estimatedTokens: dto.kind === 'text' ? 1000 : undefined,
      estimatedCount: dto.kind !== 'text' ? 1 : undefined,
    });
    if (!billingCheck.allowed) {
      throw badRequest(
        ErrorCode.CREDIT_INSUFFICIENT,
        `Insufficient credits: ${billingCheck.estimatedCredits} required, ${billingCheck.error ?? 'please top up and retry'}`,
      );
    }

    // 5. 创建 Generation 记录
    const storedParams: Record<string, any> = { ...(dto.params ?? {}) };
    if (dto.tags?.length) storedParams._tags = dto.tags;
    storedParams._isTest = dto.isTest ?? false;

    const generation = await this.prisma.aiGeneration.create({
      data: {
        ownerId: userId,
        providerId: provider.id,
        providerName: provider.name,
        model: dto.model,
        kind: dto.kind,
        prompt: dto.prompt,
        negativePrompt: dto.negativePrompt,
        params: storedParams as Prisma.InputJsonValue,
        status: 'pending',
        ...(dto.projectId ? { projectId: dto.projectId } : {}),
      },
    });

    // 6. 多端实时同步
    this.aiEventsService.broadcast({
      type: 'ai_generation_submitted',
      userId,
      resourceId: generation.id,
      timestamp: Date.now(),
      meta: {
        generationId: generation.id,
        kind: generation.kind,
        model: generation.model,
        providerName: provider.name,
      },
    });

    // 7. text 类型同步处理
    if (dto.kind === 'text') {
      this.logger.log(`同步处理 text 生成任务 ${generation.id}`);
      try {
        const result = await this.generateTextSync(userId, dto, provider, generation.id);
        return {
          generationId: generation.id,
          kind: 'text' as const,
          text: result.text,
          costTokens: result.costTokens,
          costMs: result.costMs,
        };
      } catch (err) {
        await this.prisma.aiGeneration.update({
          where: { id: generation.id },
          data: {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }
    }

    this.logger.log(`已提交生成任务 ${generation.id}，等待 Worker 处理`);
    return { generationId: generation.id };
  }

  /** 同步处理 text 类型任务：直接执行 AI 调用并返回结果 */
  private async generateTextSync(
    userId: string,
    dto: GenerateRequestDto,
    provider: any,
    generationId: string,
  ): Promise<{ text: string; costTokens?: number; costMs?: number; billingCredits?: number }> {
    // 渠道归属校验(防御性: provider 通常已由 generate 校验过)
    this.assertProviderAccess(provider, userId);
    await this.prisma.aiGeneration.update({
      where: { id: generationId },
      data: { status: 'running' },
    });

    const apiKey = await this.providersService.getDecryptedApiKey(provider.id);
    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = cfg.baseUrl || getDefaultBaseUrl(this.config, provider.provider);
    if (!baseUrl) {
      throw badRequest(
        ErrorCode.CHANNEL_BASE_URL_MISSING,
        `Channel "${provider.name}" has no API base URL configured. Please configure it in the admin settings`,
      );
    }
    const timeoutMs = this.config.get<number>('ai.requestTimeoutMs') ?? 60000;

    const abortController = new AbortController();
    this.abortControllers.set(generationId, abortController);

    const ctx: AdapterContext = {
      apiKey,
      baseUrl,
      timeoutMs,
      signal: abortController.signal,
      readFile: (key: string) => this.minio.readFile(key),
    };

    const template = recommendTemplate(dto.model, dto.kind);

    // A9: 文本生成补语言跟随指令,确保输出语言与用户 locale 一致
    const locale = dto.locale ?? 'zh';
    const langHint = this.thinkPromptService.langInstruct(locale);

    const req: GenerateRequest = {
      kind: dto.kind as GenerateKind,
      prompt:
        dto.kind === 'text'
          ? `${dto.prompt}\n\n(${langHint})`
          : dto.prompt,
      model: dto.model,
      params: { ...(dto.params ?? {}) },
      template: template
        ? {
            paramMapping: template.channelConstraints?.paramMapping,
            valueMapping: template.channelConstraints?.valueMapping,
            bounds: template.channelConstraints?.bounds,
          }
        : undefined,
    };

    const startMs = Date.now();

    try {
      const adapter = getAdapter(provider.provider);
      const result = await adapter.generate(req, ctx);
      const costMs = Date.now() - startMs;

      if (result.kind !== 'text' || !result.text) {
        throw new Error('AI 返回的结果不是有效的文本');
      }

      await this.prisma.aiGeneration.update({
        where: { id: generationId },
        data: {
          status: 'success',
          costTokens: result.costTokens ?? null,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          costMs,
        },
      });

      // 计费结算
      const inputTokens = result.inputTokens ?? result.costTokens ?? 0;
      const outputTokens = result.outputTokens ?? 0;
      const totalTokens = result.costTokens ?? (inputTokens + outputTokens);
      let billingCredits: number | undefined;
      try {
        const settlement = await this.billingService.afterGenerate(userId, {
          generationId,
          modelType: 'llm',
          provider: provider.provider,
          modelId: dto.model,
          usageAmount: totalTokens,
          inputTokens,
          outputTokens,
        });
        billingCredits = settlement?.creditsConsumed;
      } catch (billingErr) {
        this.logger.warn(`文本生成计费结算异常(${generationId}): ${billingErr}`);
      }

      return { text: result.text, costTokens: result.costTokens, costMs, billingCredits };
    } catch (err) {
      // 计费失败解冻
      try {
        await this.billingService.onGenerateFailed(userId);
      } catch { /* 计费异常不阻塞原始错误 */ }

      await this.prisma.aiGeneration.update({
        where: { id: generationId },
        data: {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    } finally {
      this.abortControllers.delete(generationId);
    }
  }

  /**
   * 异步处理后端任务：从数据库读取 AiGeneration 记录并执行完整的
   * 模板加载 → 适配器调用 → 结果落 Asset → 状态更新流程。
   * 内部 try/catch，不对外抛出异常。
   */
  async processPendingTask(taskId: string): Promise<void> {
    const generation = await this.prisma.aiGeneration.findUnique({
      where: { id: taskId },
    });
    if (!generation) {
      this.logger.warn(`任务 ${taskId} 不存在，跳过`);
      return;
    }

    const providerId = generation.providerId;
    if (!providerId) {
      await this.prisma.aiGeneration.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: '关联渠道已删除' },
      });
      return;
    }

    const provider = await this.providersService.getRawById(providerId);
    if (!provider || !provider.enabled) {
      await this.prisma.aiGeneration.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: '关联渠道不可用' },
      });
      return;
    }
    // 渠道归属校验: 任务创建者必须能使用该渠道(系统级渠道或归属本人)
    this.assertProviderAccess(provider, generation.ownerId);

    // 构造适配器上下文
    const apiKey = await this.providersService.getDecryptedApiKey(provider.id);
    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = cfg.baseUrl || getDefaultBaseUrl(this.config, provider.provider);
    if (!baseUrl) {
      await this.prisma.aiGeneration.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: `渠道「${provider.name}」未配置 API 地址，请在后台设置中配置该渠道的 baseUrl` },
      });
      return;
    }
    const timeoutMs =
      this.config.get<number>('ai.requestTimeoutMs') ?? 60000;

    const abortController = new AbortController();
    this.abortControllers.set(generation.id, abortController);

    const ctx: AdapterContext = {
      apiKey,
      baseUrl,
      timeoutMs,
      signal: abortController.signal,
      readFile: (key: string) => this.minio.readFile(key),
    };

    const startMs = Date.now();

    // 从 generation.params 中提取内部元数据
    const rawParams = (generation.params as Record<string, any>) || {};
    const _tags: string[] = Array.isArray(rawParams._tags)
      ? rawParams._tags
      : [];
    const _isTest = rawParams._isTest === true;

    const template = recommendTemplate(generation.model, generation.kind);

    const req: GenerateRequest = {
      kind: generation.kind as GenerateKind,
      prompt: generation.prompt,
      negativePrompt: generation.negativePrompt ?? undefined,
      model: generation.model,
      params: { ...rawParams },
      template: template
        ? {
            paramMapping: template.channelConstraints?.paramMapping,
            valueMapping: template.channelConstraints?.valueMapping,
            bounds: template.channelConstraints?.bounds,
          }
        : undefined,
    };

    try {
      const adapter = getAdapter(provider.provider);
      const result = await adapter.generate(req, ctx);
      const costMs = Date.now() - startMs;

      // 检查任务是否已被用户取消
      const current = await this.prisma.aiGeneration.findUnique({
        where: { id: generation.id },
        select: { status: true },
      });
      if (current?.status === 'cancelled') {
        this.logger.log(`任务 ${generation.id} 已被用户取消，丢弃生成结果`);
        return;
      }

      // 构造伪 DTO 供 persistResult 使用
      const dtoLike = {
        prompt: generation.prompt,
        isTest: _isTest,
        tags: _tags,
        kind: generation.kind,
      } as GenerateRequestDto;

      // 落库 Asset
      let assetId = '';
      let assetUrl: string | undefined;

      const asset = await this.assetService.persistResult(generation.ownerId, result, dtoLike);
      assetId = asset.id;
      if (result.kind !== 'text' && asset.storageKey) {
        assetUrl = await this.minio.presignGet(asset.storageKey, 1800);
      }

      // 构造回写 params
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _tags: _t, _isTest: _i, ...originalParams } = rawParams;
      const enrichedParams: Record<string, any> = { ...originalParams };
      if (assetUrl) enrichedParams._resultUrl = assetUrl;
      if (result.width) enrichedParams._resultWidth = result.width;
      if (result.height) enrichedParams._resultHeight = result.height;
      if (result.mimeType) enrichedParams._resultMime = result.mimeType;

      // 使用 updateMany 防竞态
      const { count: successCount } = await this.prisma.aiGeneration.updateMany({
        where: { id: generation.id, status: 'running' },
        data: {
          status: 'success',
          resultAssetId: assetId,
          costTokens: result.costTokens ?? null,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          costMs,
          params: enrichedParams as Prisma.InputJsonValue,
        },
      });
      if (successCount === 0) {
        this.logger.log(
          `任务 ${generation.id} 状态已变更(可能已被取消)，跳过 success 写入`,
        );
        return;
      }

      // 渠道使用时间戳更新
      void this.providersService.markUsed(provider.id);

      this.logsService.log('ai', `AI 生成成功: ${generation.kind}`, {
        userId: generation.ownerId,
        meta: {
          generationId: generation.id,
          kind: generation.kind,
          model: generation.model,
          provider: provider.name,
          costMs,
          costTokens: result.costTokens ?? null,
          promptPreview: generation.prompt.slice(0, 80),
        },
      });

      // 计费结算
      const modelTypeMap: Record<string, string> = {
        image: 'image', video: 'video', audio: 'audio',
      };
      const billingModelType = modelTypeMap[generation.kind] ?? generation.kind;
      const unitCount = 1;
      try {
        await this.billingService.afterGenerate(generation.ownerId, {
          generationId: generation.id,
          modelType: billingModelType,
          provider: provider.provider,
          modelId: generation.model,
          usageAmount: unitCount,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
      } catch (billingErr) {
        this.logger.warn(`异步生成计费结算异常(${generation.id}): ${billingErr}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // 用户取消触发的 AbortError
      const afterCancel = await this.prisma.aiGeneration.findUnique({
        where: { id: generation.id },
        select: { status: true },
      });
      if (afterCancel?.status === 'cancelled') {
        this.logger.log(
          `任务 ${generation.id} 已被用户取消(catch)，跳过 failed 写入`,
        );
        return;
      }

      this.logger.warn(
        `AI 生成失败(gen=${generation.id}, provider=${provider.name}): ${message}`,
      );

      if (afterCancel?.status !== 'cancelled') {
        try {
          await this.billingService.onGenerateFailed(generation.ownerId);
        } catch { /* 计费异常不阻塞原始错误 */ }
      }

      await this.prisma.aiGeneration.updateMany({
        where: { id: generation.id, status: 'running' },
        data: {
          status: 'failed',
          errorMessage: message.slice(0, 1000),
          costMs: Date.now() - startMs,
        },
      });
      this.logsService.log('ai', `AI 生成失败: ${generation.kind}`, {
        level: 'error',
        userId: generation.ownerId,
        meta: {
          generationId: generation.id,
          kind: generation.kind,
          model: generation.model,
          provider: provider.name,
          error: message.slice(0, 200),
          promptPreview: generation.prompt.slice(0, 80),
        },
      });
    } finally {
      this.abortControllers.delete(generation.id);
    }
  }

  /**
   * 列出当前用户可用的 AI 渠道(不含 apiKey,仅返回配置信息)
   */
  async listChannels(_userId: string, capability?: string) {
    const providers = await this.prisma.apiProvider.findMany({
      where: { type: 'ai', enabled: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    const items = await Promise.all(
      providers.map(async (p) => {
        const cfg = (p.config as Record<string, any>) || {};
        const baseUrl = cfg.baseUrl ?? getDefaultBaseUrl(this.config, p.provider);
        const apiFormat = (cfg.apiFormat as string) ?? 'openai';
        const modelIcons = (cfg.modelIcons as Record<string, string>) || {};

        let rawModels: Array<{ name: string; capabilities?: string[] }> = [];

        // 优先从 cfg.models 读取
        if (Array.isArray(cfg.models)) {
          rawModels = cfg.models as Array<{ name: string; capabilities?: string[] }>;
        }
        // 其次从 cfg.fetchedModels 读取
        else if (cfg.fetchedModels && typeof cfg.fetchedModels === 'object') {
          const fetched = cfg.fetchedModels as Record<string, string[]>;
          const capabilityMap: Record<string, string[]> = {
            llm: ['llm'],
            image: ['image'],
            video: ['video'],
            audio: ['audio'],
            unclassified: [],
          };
          for (const [type, modelList] of Object.entries(fetched)) {
            if (Array.isArray(modelList)) {
              for (const modelName of modelList) {
                rawModels.push({
                  name: modelName,
                  capabilities: capabilityMap[type] || [],
                });
              }
            }
          }
        }

        let filteredModels = rawModels;
        const enabledSet = Array.isArray(cfg.enabledModels)
          ? new Set(cfg.enabledModels as string[])
          : null;
        if (enabledSet) {
          filteredModels = rawModels.filter((m) => enabledSet.has(m.name));
        }
        if (capability) {
          filteredModels = filteredModels.filter((m) =>
            Array.isArray(m.capabilities) && m.capabilities.includes(capability),
          );
        }

        return {
          id: p.id,
          name: p.name,
          provider: p.provider,
          baseUrl,
          enabled: p.enabled,
          isDefault: p.isDefault,
          apiFormat,
          modelIcons,
          models: filteredModels,
        };
      }),
    );
    return { items };
  }

  /** 查询当前用户的生成历史(游标分页,可按 status/kind 过滤) */
  async list(
    userId: string,
    cursor?: string,
    limit?: number,
    status?: string,
    kind?: string,
  ) {
    const take = Math.min(Math.max(limit ?? 20, 1), 100);
    const where: Record<string, unknown> = { ownerId: userId };
    if (status && status.trim()) where.status = status.trim();
    if (kind && kind.trim()) where.kind = kind.trim();

    const [total, items] = await Promise.all([
      this.prisma.aiGeneration.count({ where }),
      this.prisma.aiGeneration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    ]);
    const hasMore = items.length > take;
    const data = hasMore ? items.slice(0, take) : items;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.id : null;
    return { items: data, nextCursor, total };
  }

  /** 获取单个生成记录(仅限所有者) */
  async findOne(userId: string, id: string) {
    const gen = await this.prisma.aiGeneration.findUnique({ where: { id } });
    if (!gen || gen.ownerId !== userId) {
      throw notFound(
        ErrorCode.AI_GENERATION_NOT_FOUND,
        'Generation record not found or no access',
      );
    }
    return gen;
  }

  /** 删除单条生成记录(仅限所有者) */
  async remove(userId: string, id: string) {
    const gen = await this.prisma.aiGeneration.findUnique({ where: { id } });
    if (!gen || gen.ownerId !== userId) {
      throw notFound(
        ErrorCode.AI_GENERATION_NOT_FOUND,
        'Generation record not found or no access',
      );
    }
    await this.prisma.aiGeneration.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** 批量删除生成记录(仅限所有者) */
  async batchRemove(userId: string, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw badRequest(ErrorCode.BAD_REQUEST, 'ids must not be empty');
    }
    if (ids.length > 100) {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        'At most 100 records can be deleted at once',
      );
    }

    const { count } = await this.prisma.aiGeneration.deleteMany({
      where: { ownerId: userId, id: { in: ids } },
    });

    this.logger.log(
      `用户 ${userId} 批量删除 ${count} 条生成记录(请求 ${ids.length} 条)`,
    );

    return { deletedCount: count };
  }

  /**
   * 取消生成任务(仅限所有者,仅 pending/running 可取消)
   */
  async cancelTask(userId: string, taskId: string) {
    const gen = await this.prisma.aiGeneration.findUnique({
      where: { id: taskId },
    });
    if (!gen || gen.ownerId !== userId) {
      throw notFound(
        ErrorCode.AI_GENERATION_NOT_FOUND,
        'Generation record not found or no access',
      );
    }
    if (gen.status === 'running') {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        'Task has been submitted to the provider and cannot be cancelled',
      );
    }
    if (gen.status !== 'pending') {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        `Task in current status ${gen.status} cannot be cancelled`,
      );
    }

    // pending 任务：从队列移除，标记为 cancelled（无成本）
    const { count } = await this.prisma.aiGeneration.updateMany({
      where: { id: taskId, status: 'pending' },
      data: { status: 'cancelled', errorMessage: '用户取消' },
    });

    if (count === 0) {
      const current = await this.prisma.aiGeneration.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      if (current?.status === 'cancelled') {
        this.logger.log(`任务 ${taskId} 重复取消请求，按 cancelled 返回`);
      } else if (current?.status === 'running') {
        throw badRequest(
          ErrorCode.BAD_REQUEST,
          'Task was just picked up and submitted to the provider; cannot be cancelled',
        );
      } else {
        throw badRequest(
          ErrorCode.BAD_REQUEST,
          `Task has finished (status: ${current?.status ?? 'unknown'}) and cannot be cancelled`,
        );
      }
    }

    this.aiEventsService.broadcast({
      type: 'ai_generation_completed',
      userId,
      resourceId: taskId,
      timestamp: Date.now(),
      meta: { status: 'cancelled', generationId: taskId, stage: 'queued' },
    });

    // 成功取消后设置提交冷却
    const cooldownMs =
      this.config.get<number>('ai.cancelCooldownMs') ?? 15000;
    this.cancelCooldowns.set(userId, Date.now() + cooldownMs);

    this.logger.log(
      `任务 ${taskId} 已被用户 ${userId} 取消(stage=queued)，提交冷却 ${cooldownMs}ms`,
    );
    return { id: taskId, status: 'cancelled', stage: 'queued' as const };
  }
}