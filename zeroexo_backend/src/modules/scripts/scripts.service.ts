import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { AppException, badRequest, notFound } from '../../common/errors/app-exception.js';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { buildApiUrl } from '../api-providers/adapters/build-api-url';
import { findPricingCatalogEntriesByModelId } from '../pricing/catalog';
import type {
  ChapterUnitResult,
  FormatChaptersResult,
} from './dto/format-chapters.dto';

/** 单单元内容最大字符数 */
const MAX_UNIT_CHARS = 100_000;
/** 默认并发数 */
const DEFAULT_CONCURRENCY = 5;
/** 最大并发数 */
const MAX_CONCURRENCY = 10;
/** LLM 请求超时(ms) */
const LLM_TIMEOUT_MS = 120_000;
/** 输出 token 上限 */
const MAX_OUTPUT_TOKENS = 8192;
/** 缓存 TTL: 7 天(ms) */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
/** 中文 token 估算系数(字符数 × 系数 ≈ token 数) */
const CHARS_TO_TOKENS_RATIO = 2.0;

/**
 * 基于 (zeroexoTextAssetId, unitIndex, modelId) 的内存缓存
 */
interface CacheEntry {
  result: { title: string; content: string };
  expiresAt: number;
}

/**
 * 简单 Semaphore 实现 — 控制并发数
 */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrency) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.current--;
    }
  }
}

/**
 * 剧本服务 — 格式化章节、缓存、重试
 */
@Injectable()
export class ScriptsService {
  private readonly logger = new Logger(ScriptsService.name);

  /**
   * 内存缓存: key = `${zeroexoTextAssetId}:${unitIndex}:${modelId}`
   */
  private readonly chapterCache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly providersService: ApiProvidersService,
  ) {}

  /**
   * 格式化章节 — 主入口
   */
  async formatChapters(
    userId: string,
    dto: {
      zeroexoTextAssetId: string;
      modelId: string;
      concurrency?: number;
      unitIndices: number[];
      skipCache?: boolean;
    },
  ): Promise<FormatChaptersResult> {
    const { zeroexoTextAssetId, modelId, unitIndices, skipCache } = dto;
    const concurrency = Math.min(
      dto.concurrency ?? DEFAULT_CONCURRENCY,
      MAX_CONCURRENCY,
    );

    // 1. 加载 zeroexo-text 资产
    const asset = await this.prisma.asset.findUnique({
      where: { id: zeroexoTextAssetId },
    });
    if (!asset || asset.ownerId !== userId) {
      throw notFound('NOT_FOUND', 'zeroexo-text asset not found or no access');
    }
    if (asset.kind !== 'zeroexo-text') {
      throw badRequest('BAD_REQUEST', 'Asset type is not zeroexo-text');
    }
    if (!asset.text) {
      throw badRequest('BAD_REQUEST', 'zeroexo-text asset content is empty');
    }

    // 2. 解析 units
    let units: Array<{ title?: string; content: string }>;
    try {
      const parsed = JSON.parse(asset.text);
      units = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.units)
          ? parsed.units
          : [];
    } catch {
      throw badRequest('BAD_REQUEST', 'zeroexo-text asset content is not valid JSON');
    }
    if (units.length === 0) {
      throw badRequest('BAD_REQUEST', 'No units found in zeroexo-text asset');
    }

    // 3. 验证 unitIndices
    if (!unitIndices || unitIndices.length === 0) {
      throw badRequest('BAD_REQUEST', 'unitIndices must not be empty');
    }
    const invalidIndex = unitIndices.find(
      (idx) => idx < 0 || idx >= units.length,
    );
    if (invalidIndex !== undefined) {
      throw badRequest(
        'BAD_REQUEST',
        `Invalid unit index: ${invalidIndex}, valid range 0-${units.length - 1}`,
      );
    }
    // 去重
    const uniqueIndices = [...new Set(unitIndices)].sort((a, b) => a - b);

    // 4. 检查单单元内容上限
    for (const idx of uniqueIndices) {
      const unit = units[idx]!;
      const content = unit.content || '';
      if (content.length > MAX_UNIT_CHARS) {
        throw badRequest(
          'BAD_REQUEST',
          `Unit ${idx} content exceeds the ${MAX_UNIT_CHARS} character limit (currently ${content.length} characters)`,
        );
      }
    }

    // 5. 成本上限校验
    await this.checkCostCap(userId, modelId, units, uniqueIndices);

    // 6. 获取 AI 渠道
    const provider = await this.providersService.getDefaultRaw('ai');
    if (!provider) {
      throw badRequest('BAD_REQUEST', 'No AI provider configured');
    }
    const apiKey = await this.providersService.getDecryptedApiKey(provider.id);
    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = cfg.baseUrl || '';
    if (!baseUrl || !apiKey) {
      throw badRequest('BAD_REQUEST', 'AI provider API base URL or key not configured');
    }
    const url = `${buildApiUrl(baseUrl, provider.provider)}/chat/completions`;

    // 7. 创建 AiGeneration 记录
    const generation = await this.prisma.aiGeneration.create({
      data: {
        ownerId: userId,
        providerId: provider.id,
        providerName: provider.name,
        model: modelId,
        kind: 'format_chapters',
        prompt: `格式化章节: ${zeroexoTextAssetId}, ${uniqueIndices.length} 单元`,
        status: 'running',
        params: {
          zeroexoTextAssetId,
          unitIndices: uniqueIndices,
          totalUnits: uniqueIndices.length,
          completedUnits: 0,
          failedUnits: 0,
          results: [],
          costTokens: 0,
          concurrency,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // 8. 并行执行 — 带并发控制
    const semaphore = new Semaphore(concurrency);
    const results: ChapterUnitResult[] = [];
    let totalCostTokens = 0;
    let completedCount = 0;
    let failedCount = 0;

    const tasks = uniqueIndices.map(async (unitIndex) => {
      await semaphore.acquire();
      try {
        const unit = units[unitIndex]!;
        const cacheKey = `${zeroexoTextAssetId}:${unitIndex}:${modelId}`;

        // 缓存检查
        if (!skipCache) {
          const cached = this.getCache(cacheKey);
          if (cached) {
            completedCount++;
            totalCostTokens += 0;
            results.push({
              unitIndex,
              title: cached.title,
              content: cached.content,
              cached: true,
              costTokens: 0,
            });
            await this.updateProgress(generation.id, completedCount, failedCount, totalCostTokens, results);
            return;
          }
        }

        // 调用 LLM
        const chapterResult = await this.callLlmForChapter(
          url,
          apiKey,
          modelId,
          provider.provider,
          unit,
          unitIndex,
          uniqueIndices.length,
          generation.id,
        );

        // 写入缓存
        this.setCache(cacheKey, {
          title: chapterResult.title,
          content: chapterResult.content,
        });

        completedCount++;
        totalCostTokens += chapterResult.costTokens;
        results.push({
          unitIndex,
          title: chapterResult.title,
          content: chapterResult.content,
          cached: false,
          costTokens: chapterResult.costTokens,
        });
        await this.updateProgress(generation.id, completedCount, failedCount, totalCostTokens, results);
      } catch (err) {
        failedCount++;
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          unitIndex,
          title: '',
          content: '',
          cached: false,
          error: message,
        });
        this.logger.warn(`格式化章节单元 ${unitIndex} 失败: ${message}`);
        await this.updateProgress(generation.id, completedCount, failedCount, totalCostTokens, results);
      } finally {
        semaphore.release();
      }
    });

    await Promise.allSettled(tasks);

    // 9. 聚合结果 — 生成剧本 JSON
    const allCompleted = failedCount === 0;
    const allFailed = completedCount === 0;
    let scriptAssetId: string | undefined;

    if (!allFailed) {
      // 按原始 unitIndices 顺序排列
      const orderedResults = uniqueIndices.map((idx) => {
        const found = results.find((r) => r.unitIndex === idx);
        return found;
      }).filter(Boolean) as ChapterUnitResult[];

      const scriptJson = JSON.stringify({
        chapters: orderedResults.map((r) => ({
          unitIndex: r.unitIndex,
          title: r.title || `第 ${r.unitIndex + 1} 章`,
          content: r.content || '',
        })),
        totalUnits: uniqueIndices.length,
        completedUnits: completedCount,
        failedUnits: failedCount,
        modelId,
        generatedAt: new Date().toISOString(),
      });

      // 通过 assetsService.createScriptAsset 存储为 script 类型 Asset
      const scriptAsset = await this.assetsService.createScriptAsset(userId, {
        filename: `format-chapters-${nanoid(8)}.json`,
        text: scriptJson,
        tags: ['format-chapters', modelId],
      });
      scriptAssetId = scriptAsset.id;
    }

    // 10. 更新 AiGeneration 记录
    const status = allCompleted ? 'success' : allFailed ? 'failed' : 'partial';
    await this.prisma.aiGeneration.update({
      where: { id: generation.id },
      data: {
        status,
        resultAssetId: scriptAssetId ?? null,
        costTokens: totalCostTokens,
        params: {
          zeroexoTextAssetId,
          unitIndices: uniqueIndices,
          totalUnits: uniqueIndices.length,
          completedUnits: completedCount,
          failedUnits: failedCount,
          results,
          costTokens: totalCostTokens,
          concurrency,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      generationId: generation.id,
      status,
      scriptAssetId,
      totalUnits: uniqueIndices.length,
      completedUnits: completedCount,
      failedUnits: failedCount,
      results,
      costTokens: totalCostTokens,
      createdAt: generation.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 查询进度
   */
  async getProgress(
    userId: string,
    generationId: string,
  ): Promise<{
    status: string;
    totalUnits: number;
    completedUnits: number;
    failedUnits: number;
    costTokens: number;
    results: ChapterUnitResult[];
    scriptAssetId?: string;
    errorMessage?: string;
  }> {
    const gen = await this.prisma.aiGeneration.findUnique({
      where: { id: generationId },
    });
    if (!gen || gen.ownerId !== userId) {
      throw notFound('NOT_FOUND', 'Generation record not found or no access');
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
    };
  }

  /**
   * 重试失败的单元
   */
  async retryFailedUnits(
    userId: string,
    dto: { generationId: string; unitIndices?: number[] },
  ): Promise<FormatChaptersResult> {
    const { generationId, unitIndices: retryIndices } = dto;

    // 1. 查找原记录
    const original = await this.prisma.aiGeneration.findUnique({
      where: { id: generationId },
    });
    if (!original || original.ownerId !== userId) {
      throw notFound('NOT_FOUND', 'Original generation record not found or no access');
    }
    if (original.kind !== 'format_chapters') {
      throw badRequest('BAD_REQUEST', 'This record is not a format-chapters task');
    }

    const origParams = (original.params as Record<string, any>) || {};
    const zeroexoTextAssetId = origParams.zeroexoTextAssetId as string;
    const modelId = original.model;
    const origResults: ChapterUnitResult[] = origParams.results ?? [];

    // 2. 确定要重试的单元
    let targetIndices: number[];
    if (retryIndices && retryIndices.length > 0) {
      targetIndices = retryIndices;
    } else {
      // 重试所有失败单元
      targetIndices = origResults
        .filter((r) => r.error)
        .map((r) => r.unitIndex);
    }
    if (targetIndices.length === 0) {
      throw badRequest('BAD_REQUEST', 'No failed units to retry');
    }

    // 3. 调用 formatChapters（仅处理失败的单元，跳过缓存）
    return this.formatChapters(userId, {
      zeroexoTextAssetId,
      modelId,
      concurrency: origParams.concurrency ?? DEFAULT_CONCURRENCY,
      unitIndices: targetIndices,
      skipCache: true,
    });
  }

  /**
   * 构建章节提示词
   */
  private buildChapterPrompt(
    unit: { title?: string; content: string },
    unitIndex: number,
    totalUnits: number,
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你是一个专业的剧本格式化助手。你将收到一段原始的剧本/故事内容，需要将其格式化为结构化的章节。

要求：
1. 提取或生成一个合适的章节标题（简洁、有吸引力）
2. 将内容整理为清晰的章节正文，保持原意和风格
3. 输出格式必须为严格的 JSON：{"title":"章节标题","content":"章节正文"}
4. content 中的换行必须使用 \\n 转义序列，不得使用实际换行符
5. 确保 JSON 是合法的单行 JSON`;

    const userPrompt = [
      `## 单元信息`,
      `单元索引: ${unitIndex + 1}/${totalUnits}`,
      unit.title ? `原始标题: ${unit.title}` : '',
      '',
      `## 原始内容`,
      '',
      unit.content || '',
      '',
      '请将以上内容格式化为一个完整的章节，输出严格为一行 JSON。',
    ]
      .filter(Boolean)
      .join('\n');

    return { systemPrompt, userPrompt };
  }

  /**
   * 调用 LLM 生成章节
   */
  private async callLlmForChapter(
    url: string,
    apiKey: string,
    modelId: string,
    _provider: string,
    unit: { title?: string; content: string },
    unitIndex: number,
    totalUnits: number,
    _generationId: string,
  ): Promise<{ title: string; content: string; costTokens: number }> {
    const { systemPrompt, userPrompt } = this.buildChapterPrompt(
      unit,
      unitIndex,
      totalUnits,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`LLM 调用失败 (${response.status}): ${errText.slice(0, 200)}`);
    }

    const respJson = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    };

    const rawContent = respJson?.choices?.[0]?.message?.content || '';
    const costTokens =
      respJson?.usage?.total_tokens ?? 0;

    // 解析 JSON 结果
    const parsed = this.parseChapterJson(rawContent);
    if (!parsed) {
      throw new Error(`LLM 返回的章节内容无法解析: ${rawContent.slice(0, 200)}`);
    }

    return {
      title: parsed.title,
      content: parsed.content,
      costTokens,
    };
  }

  /**
   * 解析章节 JSON（兼容 ```json 代码块包装）
   */
  private parseChapterJson(text: string): { title: string; content: string } | null {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = codeBlock ? codeBlock[1]! : text;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.title === 'string' && typeof obj.content === 'string') {
        return { title: obj.title, content: obj.content };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 更新进度到 AiGeneration 记录
   */
  private async updateProgress(
    generationId: string,
    completedUnits: number,
    failedUnits: number,
    costTokens: number,
    results: ChapterUnitResult[],
  ): Promise<void> {
    try {
      const existing = await this.prisma.aiGeneration.findUnique({
        where: { id: generationId },
        select: { params: true },
      });
      const params = ((existing?.params as Record<string, any>) || {});
      await this.prisma.aiGeneration.update({
        where: { id: generationId },
        data: {
          costTokens,
          params: {
            ...params,
            completedUnits,
            failedUnits,
            results: results as any,
            costTokens,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // 进度持久化失败不阻塞主流程
    }
  }

  /**
   * 成本上限校验
   */
  private async checkCostCap(
    userId: string,
    modelId: string,
    units: Array<{ title?: string; content: string }>,
    uniqueIndices: number[],
  ): Promise<void> {
    // 估算总字符数
    let totalChars = 0;
    for (const idx of uniqueIndices) {
      const unit = units[idx]!;
      totalChars += (unit.content || '').length;
    }

    // 估算最大 token 消耗: input tokens ≈ chars × ratio, output tokens ≈ MAX_OUTPUT_TOKENS
    const estimatedInputTokens = Math.ceil(totalChars * CHARS_TO_TOKENS_RATIO);
    const estimatedOutputTokens = MAX_OUTPUT_TOKENS * uniqueIndices.length;
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

    // 查找定价 — 按 modelId 模糊匹配
    const pricingEntries = findPricingCatalogEntriesByModelId('llm', modelId);
    const pricingEntry = pricingEntries.length > 0 ? pricingEntries[0] : null;

    let estimatedCostUsd = 0;
    if (pricingEntry && pricingEntry.pricing) {
      const inputPerMillion = pricingEntry.pricing.inputPerMillion ?? 2;
      const outputPerMillion = pricingEntry.pricing.outputPerMillion ?? 8;
      estimatedCostUsd =
        (estimatedInputTokens / 1_000_000) * inputPerMillion +
        (estimatedOutputTokens / 1_000_000) * outputPerMillion;
    }

    // 检查用户月度预算（从 settings 或 UserAiPreference 读取）
    // 由于当前没有统一的月度预算配置，使用 AiGeneration 记录估算当月已用 token
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyUsage = await this.prisma.aiGeneration.aggregate({
      where: {
        ownerId: userId,
        status: 'success',
        createdAt: { gte: monthStart },
      },
      _sum: { costTokens: true },
    });
    const monthlyTokens = monthlyUsage._sum.costTokens ?? 0;

    // 单次任务上限: 5,000,000 tokens (近似值)
    const MAX_TASK_TOKENS = 5_000_000;
    // 月度上限: 50,000,000 tokens
    const MAX_MONTHLY_TOKENS = 50_000_000;

    if (estimatedTotalTokens > MAX_TASK_TOKENS) {
      throw new AppException(
        HttpStatus.PAYMENT_REQUIRED,
        'CREDIT_INSUFFICIENT',
        `Task token estimate (${estimatedTotalTokens}) exceeds the per-task limit (${MAX_TASK_TOKENS}); estimated cost $${estimatedCostUsd.toFixed(2)}`,
      );
    }

    if (monthlyTokens + estimatedTotalTokens > MAX_MONTHLY_TOKENS) {
      throw new AppException(
        HttpStatus.PAYMENT_REQUIRED,
        'CREDIT_INSUFFICIENT',
        `Monthly tokens already used (${monthlyTokens}) plus this estimate (${estimatedTotalTokens}) would exceed the monthly limit (${MAX_MONTHLY_TOKENS}); estimated cost $${estimatedCostUsd.toFixed(2)}`,
      );
    }
  }

  /**
   * 缓存读取
   */
  private getCache(key: string): { title: string; content: string } | null {
    const entry = this.chapterCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.chapterCache.delete(key);
      return null;
    }
    return entry.result;
  }

  /**
   * 缓存写入
   */
  private setCache(
    key: string,
    result: { title: string; content: string },
  ): void {
    this.chapterCache.set(key, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
}