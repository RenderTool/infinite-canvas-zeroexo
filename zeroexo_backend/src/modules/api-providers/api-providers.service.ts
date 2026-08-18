import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { badRequest, notFound } from '../../common/errors/app-exception.js';
import { ApiProvider, Prisma } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from './adapters/base.adapter';
import { AiAdapter } from './adapters/ai.adapter';
import { EmailAdapter } from './adapters/email.adapter';
import { OAuthAdapter } from './adapters/oauth.adapter';
import { StorageAdapter } from './adapters/storage.adapter';
import { PaymentAdapter } from './adapters/payment.adapter';
import { encrypt, decrypt, maskApiKey } from '../../common/crypto/crypto-aes.util';
import { ConfigService } from '@nestjs/config';
import { LogsService } from '../logs/logs.service';
import { recommendTemplate } from '../ai-generate/templates/built-in-templates';

/**
 * API Provider 统一服务 - 阶段 A 核心入口
 *
 * 职责:
 * - 统一 CRUD: 增/删/改/查/列表
 * - 凭证加密: 写入时 encrypt,读取时按需 decrypt(默认返回脱敏)
 * - Adapter 路由: 根据 type 字段选择对应适配器
 * - 默认切换: 切换 isDefault 时自动取消同 type 下的旧默认
 * - 健康检查: 触发单次 check,返回 HealthResult
 *
 * 设计原则:
 * - 业务代码只通过本 service 操作 ApiProvider 表,不解耦到具体 adapter
 * - 凭证默认不返回明文,只有 invokeAction 时才解密
 * - 切换默认操作需 super_admin 角色
 */
@Injectable()
export class ApiProvidersService {
  /** type -> adapter 路由表(全部用 BaseApiAdapter 类型以避免联合类型问题) */
  private readonly adapters: Map<string, BaseApiAdapter>;
  /** AiAdapter 单独持有，用于 AI 专属操作（如 fetchModels） */
  private readonly aiAdapter: AiAdapter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logsService: LogsService,
    aiAdapter: AiAdapter,
    emailAdapter: EmailAdapter,
    oauthAdapter: OAuthAdapter,
    storageAdapter: StorageAdapter,
    paymentAdapter: PaymentAdapter,
  ) {
    this.aiAdapter = aiAdapter;
    this.adapters = new Map<string, BaseApiAdapter>([
      ['ai', aiAdapter],
      ['email', emailAdapter],
      ['oauth', oauthAdapter],
      ['storage', storageAdapter],
      ['payment', paymentAdapter],
    ]);
  }

  // ============================================================
  // 加密密钥
  // ============================================================

  private get encryptionKey(): string {
    const key = this.config.get<string>('ai.encryptionKey');
    if (!key) {
      throw new Error('Missing required config: ai.encryptionKey');
    }
    return key;
  }

  // ============================================================
  // 列表与查询
  // ============================================================

  /**
   * 列出所有 API Provider(支持按 type / provider / enabled 过滤)
   * 返回时 credentials 自动脱敏
   */
  async list(filter: { type?: string; provider?: string; enabled?: boolean } = {}): Promise<any[]> {
    const where: Prisma.ApiProviderWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.provider) where.provider = filter.provider;
    if (filter.enabled !== undefined) where.enabled = filter.enabled;

    const items = await this.prisma.apiProvider.findMany({
      where,
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });

    return items.map((item) => this.maskProvider(item));
  }

  /**
   * 按 ID 查询单个,不存在则抛 404
   */
  async getById(id: string): Promise<any> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    return this.maskProvider(provider);
  }

  /**
   * 取出指定 type 的默认 Provider
   */
  async getDefault(type: string): Promise<any | null> {
    const provider = await this.prisma.apiProvider.findFirst({
      where: { type, isDefault: true, enabled: true },
    });
    return provider ? this.maskProvider(provider) : null;
  }

  // ============================================================
  // 创建
  // ============================================================

  /**
   * 创建 API Provider
   * 自动加密 credentials,生成脱敏摘要
   */
  async create(input: {
    name: string;
    provider: string;
    type: string;
    config?: Record<string, any>;
    credentials?: Record<string, any>;
    capabilities?: string[];
    quota?: Record<string, any>;
    enabled?: boolean;
    isDefault?: boolean;
    notes?: string;
  }): Promise<any> {
    this.validateTypeAndProvider(input.type, input.provider);

    const adapter = this.adapters.get(input.type);
    if (!adapter) {
      throw badRequest(ErrorCode.BAD_REQUEST, `Unknown type: ${input.type}`);
    }
    const configError = await adapter.validateConfig(input.config || {});
    if (configError) {
      throw badRequest(ErrorCode.BAD_REQUEST, `Config validation failed: ${configError}`);
    }

    const encryptedCreds = this.encryptCredentials(input.credentials || {});
    const mask = this.buildMaskSummary(input.credentials || {});

    // 事务: 创建 + 默认切换
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.apiProvider.updateMany({
          where: { type: input.type, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await tx.apiProvider.create({
        data: {
          name: input.name,
          provider: input.provider,
          type: input.type,
          config: (input.config || {}) as Prisma.JsonObject,
          credentials: encryptedCreds as Prisma.JsonObject,
          credentialsMask: mask,
          capabilities: input.capabilities || [],
          quota: (input.quota || {}) as Prisma.JsonObject,
          enabled: input.enabled ?? true,
          isDefault: input.isDefault ?? false,
          notes: input.notes,
        },
      });
      this.logsService.log('system', `创建 API Provider: ${input.name} (${input.provider})`, {
        meta: { type: input.type, enabled: input.enabled ?? true, isDefault: input.isDefault ?? false },
      });
      return this.maskProvider(created);
    });
  }

  // ============================================================
  // 更新
  // ============================================================

  /**
   * 更新 API Provider(部分字段)
   * 凭证若提供则重新加密,否则保留
   */
  async update(
    id: string,
    input: {
      name?: string;
      config?: Record<string, any>;
      credentials?: Record<string, any>;
      capabilities?: string[];
      quota?: Record<string, any>;
      enabled?: boolean;
      isDefault?: boolean;
      notes?: string;
    },
  ): Promise<any> {
    const existing = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!existing) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }

    const data: Prisma.ApiProviderUpdateInput = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.config !== undefined) data.config = input.config as Prisma.JsonObject;
    if (input.capabilities !== undefined) data.capabilities = input.capabilities;
    if (input.quota !== undefined) data.quota = input.quota as Prisma.JsonObject;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.notes !== undefined) data.notes = input.notes;

    if (input.credentials && Object.keys(input.credentials).length > 0) {
      data.credentials = this.encryptCredentials(input.credentials) as Prisma.JsonObject;
      data.credentialsMask = this.buildMaskSummary(input.credentials);
    }

    return this.prisma.$transaction(async (tx) => {
      // 默认切换: 先取消同 type 下的其他默认
      if (input.isDefault === true) {
        await tx.apiProvider.updateMany({
          where: { type: existing.type, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
        data.isDefault = true;
      } else if (input.isDefault === false) {
        data.isDefault = false;
      }

      const updated = await tx.apiProvider.update({
        where: { id },
        data,
      });
      this.logsService.log('system', `更新 API Provider: ${updated.name} (${updated.id})`, {
        meta: { type: updated.type, enabled: updated.enabled, isDefault: updated.isDefault },
      });
      return this.maskProvider(updated);
    });
  }

  // ============================================================
  // 删除
  // ============================================================

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!existing) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    if (existing.isDefault) {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Cannot delete the default provider, please switch the default first');
    }
    await this.prisma.apiProvider.delete({ where: { id } });
    this.logsService.log('system', `删除 API Provider: ${existing.name} (${existing.provider})`, {
      meta: { type: existing.type, id: existing.id },
    });
  }

  // ============================================================
  // 设为默认(独立操作,敏感)
  // ============================================================

  async setDefault(id: string): Promise<any> {
    const existing = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!existing) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    if (!existing.enabled) {
      throw badRequest(ErrorCode.BAD_REQUEST, 'A disabled provider cannot be set as default');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.apiProvider.updateMany({
        where: { type: existing.type, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      const updated = await tx.apiProvider.update({
        where: { id },
        data: { isDefault: true },
      });
      this.logsService.log('system', `设置默认 API Provider: ${updated.name} (${updated.provider})`, {
        meta: { type: updated.type, id: updated.id },
      });
      return this.maskProvider(updated);
    });
  }

  // ============================================================
  // 健康检查(单次触发)
  // ============================================================

  async checkHealth(id: string): Promise<HealthResult> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    const adapter = this.adapters.get(provider.type);
    if (!adapter) {
      throw badRequest(ErrorCode.BAD_REQUEST, `Unknown type: ${provider.type}`);
    }

    const result = await adapter.healthCheck(provider);

    await this.prisma.apiProvider.update({
      where: { id },
      data: {
        health: result.status,
        healthLatencyMs: result.latencyMs,
        healthCheckedAt: new Date(),
        healthError: result.error,
      },
    });

    await this.prisma.apiHealthLog.create({
      data: {
        providerId: id,
        status: result.status,
        latencyMs: result.latencyMs,
        errorMessage: result.error,
      },
    });

    this.logsService.log('system', `API Provider 健康检查: ${provider.name} - ${result.status}`, {
      level: result.status === 'healthy' ? 'info' : 'warn',
      meta: { providerId: id, type: provider.type, latencyMs: result.latencyMs, error: result.error },
    });

    return result;
  }

  // ============================================================
  // 执行业务动作(由调用方触发,如发邮件 / 调 AI)
  // ============================================================

  async invokeAction(
    id: string,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    if (!provider.enabled) {
      throw badRequest(ErrorCode.CHANNEL_UNAVAILABLE, 'Provider is disabled');
    }
    const adapter = this.adapters.get(provider.type);
    if (!adapter) {
      throw badRequest(ErrorCode.BAD_REQUEST, `Unknown type: ${provider.type}`);
    }

    // 解密凭证(给 adapter 临时使用)
    const decryptedCreds = this.decryptCredentials(provider.credentials as Record<string, any>);
    const decryptedProvider: ApiProvider = {
      ...provider,
      credentials: decryptedCreds as any,
    };

    const result = await adapter.invokeAction(decryptedProvider, action, params);

    // 更新最后使用时间
    await this.prisma.apiProvider.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });

    return result;
  }

  /**
   * 获取 AI provider 的模型列表并分类写入 config
   *
   * 1. 获取 provider 并解密凭证
   * 2. 调用 AiAdapter.fetchModels 获取分类模型
   * 3. 将结果写入 provider.config.fetchedModels
   *
   * @param configOverride 可选的配置覆盖（如表单中的 baseUrl），优先级高于 DB 保存值
   */
  async fetchModels(
    id: string,
    configOverride?: Record<string, any>,
  ): Promise<{
    ok: boolean;
    message: string;
    models: {
      llm: string[];
      image: string[];
      video: string[];
      audio: string[];
      unclassified: string[];
    };
    rawModelIds?: string[];
  }> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    if (provider.type !== 'ai') {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Only AI type providers support fetching models');
    }

    // 解密凭证
    const decryptedCreds = this.decryptCredentials(provider.credentials as Record<string, any>);
    const apiKey = (decryptedCreds.apiKey as string) ?? '';

    // baseUrl: 表单覆盖 > DB 保存 > 默认地址
    const cfg = (provider.config as Record<string, any>) ?? {};
    const baseUrl =
      configOverride?.baseUrl ||
      (cfg.baseUrl as string) ||
      this.aiAdapter.getDefaultBaseUrl(provider.provider);

    // 合并 config（包含 modelTypes 等用户配置），传递给 adapter 做分类
    const mergedConfig = { ...cfg, ...configOverride };

    // 调用 adapter
    const result = await this.aiAdapter.fetchModels(apiKey, baseUrl, provider.provider, mergedConfig);

    // 把自定义模型（customModels）合并到分类结果中
    if (result.ok) {
      const customModels = (cfg.customModels as Array<{ id: string; name?: string; type: string }>) || [];
      for (const cm of customModels) {
        const type = cm.type as keyof typeof result.models;
        if (type && result.models[type] && !result.models[type].includes(cm.id)) {
          result.models[type].push(cm.id);
        }
      }
    }

    // 写回 config.fetchedModels（如有 configOverride 同时更新 baseUrl）
    if (result.ok) {
      const updatedConfig = {
        ...cfg,
        ...configOverride,
        fetchedModels: result.models,
        fetchedAt: new Date().toISOString(),
      };
      await this.prisma.apiProvider.update({
        where: { id },
        data: { config: updatedConfig as any },
      });
      const totalModels = Object.values(result.models).reduce((sum, arr) => sum + arr.length, 0);
      this.logsService.log('system', `获取模型列表成功: ${provider.name} - ${totalModels} 个模型`, {
        meta: { providerId: id, llm: result.models.llm.length, image: result.models.image.length, video: result.models.video.length, audio: result.models.audio.length },
      });
    } else {
      this.logsService.log('system', `获取模型列表失败: ${provider.name} - ${result.message}`, {
        level: 'error',
        meta: { providerId: id, type: provider.type },
      });
    }

    return result;
  }

  /**
   * 更新模型分类（用户手动归类）
   * 保存到 config.modelTypes
   */
  async updateModelTypes(
    id: string,
    modelTypes: Record<string, 'llm' | 'image' | 'video' | 'audio'>,
  ): Promise<{ ok: boolean; message: string }> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    if (provider.type !== 'ai') {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Only AI type providers support model classification');
    }

    const cfg = (provider.config as Record<string, any>) ?? {};
    const existingTypes = (cfg.modelTypes as Record<string, string>) || {};

    // 合并：小写 key 存储
    const merged: Record<string, string> = { ...existingTypes };
    for (const [modelId, type] of Object.entries(modelTypes)) {
      merged[modelId.toLowerCase()] = type;
    }

    const updatedConfig = {
      ...cfg,
      modelTypes: merged,
    };

    await this.prisma.apiProvider.update({
      where: { id },
      data: { config: updatedConfig as any },
    });

    this.logsService.log('system', `更新模型分类: ${provider.name}`, {
      meta: { providerId: id, count: Object.keys(modelTypes).length },
    });

    return { ok: true, message: '分类已保存' };
  }

  /**
   * 自动归类模型（基于模型名称模式匹配）
   *
   * 根据模型 ID 的名称特征尝试自动判断模型类型：
   * - 含 gpt/claude/gemini/llama 等 → llm
   * - 含 dall-e/stable-diffusion/flux 等 → image
   * - 含 sora/kling/runway 等 → video
   * - 含 tts/whisper/audio 等 → audio
   * 匹配成功的自动保存到 config.modelTypes，未匹配的保留原分类。
   */
  async autoClassifyModels(
    id: string,
    modelIds: string[],
  ): Promise<{ classifications: Record<string, string>; message: string }> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    if (provider.type !== 'ai') {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Only AI type providers support model categorization');
    }

    // 模型名称模式匹配规则（优先级从高到低）
    const patterns: Array<{ regex: RegExp; type: string }> = [
      // ── LLM ──
      { regex: /\b(gpt|o1|o3)\b/i, type: 'llm' },
      { regex: /\b(claude|sonnet|haiku)\b/i, type: 'llm' },
      { regex: /\b(gemini|gemma)\b/i, type: 'llm' },
      { regex: /\b(llama|mistral|mixtral|qwen|deepseek)\b/i, type: 'llm' },
      { regex: /\b(glm|chatglm|baichuan|yi-|command|phi)\b/i, type: 'llm' },
      { regex: /\b(llava|vicuna|falcon|dbrx|olmo|solar)\b/i, type: 'llm' },
      { regex: /\b(cohere|aya|nemotron|ministral|granite)\b/i, type: 'llm' },
      { regex: /\b(reflection|nvidia|llama-3|internlm|moe)\b/i, type: 'llm' },
      { regex: /^(spark|ernie|hunyuan|doubao)\b/i, type: 'llm' },
      // ── Image ──
      { regex: /\b(dall-e|dall-e|stable-diffusion|sdxl)\b/i, type: 'image' },
      { regex: /\b(midjourney|pixart|flux|cogview|imagen)\b/i, type: 'image' },
      { regex: /\b(firefly|image|draw|illustrate|wanx|tongyi)\b/i, type: 'image' },
      // ── Video ──
      { regex: /\b(sora|kling|runway|pika|veo)\b/i, type: 'video' },
      { regex: /\b(make-video|video-gen|movie|animate)\b/i, type: 'video' },
      // ── Audio ──
      { regex: /\b(tts|whisper|voice|audio|speech)\b/i, type: 'audio' },
      { regex: /\b(hifi|bark|vall-e|suno|elevenlabs|fish)\b/i, type: 'audio' },
      { regex: /\b(cosyvoice|sensvoice|spark-tts)\b/i, type: 'audio' },
    ];

    const cfg = (provider.config as Record<string, any>) ?? {};
    const existingTypes = (cfg.modelTypes as Record<string, string>) || {};
    const classifications: Record<string, string> = {};

    for (const modelId of modelIds) {
      let matched = false;
      for (const { regex, type } of patterns) {
        if (regex.test(modelId)) {
          classifications[modelId.toLowerCase()] = type;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 保留现有分类或标记为未分类
        classifications[modelId.toLowerCase()] = existingTypes[modelId.toLowerCase()] || 'unclassified';
      }
    }

    // 合并：仅覆盖成功匹配的
    const merged: Record<string, string> = { ...existingTypes };
    for (const [modelId, type] of Object.entries(classifications)) {
      if (type !== 'unclassified') {
        merged[modelId.toLowerCase()] = type;
      }
    }

    await this.prisma.apiProvider.update({
      where: { id },
      data: { config: { ...cfg, modelTypes: merged } as any },
    });

    this.logsService.log('system', `自动归类模型: ${provider.name}`, {
      meta: { providerId: id, count: modelIds.length },
    });

    const classified = Object.entries(classifications).filter(([, t]) => t !== 'unclassified').length;
    const unclassified = Object.entries(classifications).filter(([, t]) => t === 'unclassified').length;

    return {
      classifications,
      message:
        `自动匹配完成：${classified} 个模型已归类` +
        (unclassified > 0 ? `，${unclassified} 个未匹配到类型` : ''),
    };
  }

  /**
   * 手动添加自定义模型
   * 保存到 config.customModels 数组
   */
  async addCustomModel(
    id: string,
    input: {
      modelId: string;
      modelName?: string;
      type: 'llm' | 'image' | 'video' | 'audio';
    },
  ): Promise<{ ok: boolean; message: string }> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    if (provider.type !== 'ai') {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Only AI type providers support adding models');
    }

    const cfg = (provider.config as Record<string, any>) ?? {};
    const customModels = (cfg.customModels as Array<{ id: string; name?: string; type: string }>) || [];

    // 检查是否已存在
    if (customModels.some(m => m.id.toLowerCase() === input.modelId.toLowerCase())) {
      return { ok: false, message: '该模型已存在' };
    }

    customModels.push({
      id: input.modelId,
      name: input.modelName || input.modelId,
      type: input.type,
    });

    // 同时更新 modelTypes，确保分类生效
    const existingTypes = (cfg.modelTypes as Record<string, string>) || {};
    const updatedTypes = {
      ...existingTypes,
      [input.modelId.toLowerCase()]: input.type,
    };

    const updatedConfig = {
      ...cfg,
      customModels,
      modelTypes: updatedTypes,
    };

    await this.prisma.apiProvider.update({
      where: { id },
      data: { config: updatedConfig as any },
    });

    this.logsService.log('system', `添加自定义模型: ${provider.name} - ${input.modelId}`, {
      meta: { providerId: id, modelId: input.modelId, type: input.type },
    });

    return { ok: true, message: '模型已添加' };
  }

  /**
   * 删除自定义模型
   */
  async removeCustomModel(
    id: string,
    modelId: string,
  ): Promise<{ ok: boolean; message: string }> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }

    const cfg = (provider.config as Record<string, any>) ?? {};
    const customModels = (cfg.customModels as Array<{ id: string; name?: string; type: string }>) || [];
    const filtered = customModels.filter(m => m.id.toLowerCase() !== modelId.toLowerCase());

    const updatedConfig = {
      ...cfg,
      customModels: filtered,
    };

    await this.prisma.apiProvider.update({
      where: { id },
      data: { config: updatedConfig as any },
    });

    return { ok: true, message: '模型已删除' };
  }

  // ============================================================
  // 模型 Capability / Schema 查询与保存
  // ============================================================

  /**
   * 获取指定模型的 capability
   * 从 provider.config.modelSchemas 和模板系统推导
   */
  async getModelCapability(
    id: string,
    modelId: string,
  ): Promise<{
    maxEdgeLength: number;
    minTotalPixels: number;
    maxReferenceImages: number;
    supportsImageToImage: boolean;
  } | null> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider || provider.type !== 'ai') return null;

    const cfg = (provider.config as Record<string, any>) ?? {};

    // 1. 尝试从模板推荐获取 capability
    const lowerId = modelId.toLowerCase();
    const modelType = (cfg.modelTypes as Record<string, string>)?.[lowerId] || 'image';

    try {
      const template = recommendTemplate(lowerId, modelType);
      const bounds = template?.channelConstraints?.bounds;
      if (bounds) {
        return {
          maxEdgeLength: bounds.maxEdgeLength ?? 4096,
          minTotalPixels: bounds.minTotalPixels ?? 262144,
          maxReferenceImages: bounds.maxReferenceImages ?? 4,
          supportsImageToImage: bounds.supportsImageToImage ?? false,
        };
      }
    } catch {
      // fallback
    }

    // 2. 兜底
    return {
      maxEdgeLength: 2048,
      minTotalPixels: 262144,
      maxReferenceImages: 4,
      supportsImageToImage: false,
    };
  }

  /**
   * 保存模型的参数配置
   * 写入 provider.config.modelSchemas
   * 存储格式为 PersistedParamConfig
   */
  async saveModelSchema(
    id: string,
    modelId: string,
    config: Record<string, any>,
  ): Promise<{ ok: boolean; message: string }> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }

    const cfg = (provider.config as Record<string, any>) ?? {};
    const modelSchemas = (cfg.modelSchemas as Record<string, any>) || {};

    // 存储 PersistedParamConfig 结构
    modelSchemas[modelId.toLowerCase()] = config;

    await this.prisma.apiProvider.update({
      where: { id },
      data: {
        config: {
          ...cfg,
          modelSchemas,
        } as any,
      },
    });

    this.logsService.log('system', `保存模型参数配置: ${provider.name} - ${modelId}`, {
      meta: { providerId: id, modelId },
    });

    return { ok: true, message: '参数配置已保存' };
  }

  // ============================================================
  // 独立连通性测试(无需 DB 记录,用于前端"测试连接"按钮)
  // ============================================================

  /**
   * 使用前端传入的原始凭证进行连通性测试 + 模型拉取
   * 不查询 DB,不加密,不持久化
   */
  async testConnectivityDirect(input: {
    provider: string;
    config?: Record<string, any>;
    credentials?: Record<string, any>;
  }): Promise<{
    ok: boolean;
    message: string;
    models: {
      llm: string[];
      image: string[];
      video: string[];
      audio: string[];
      unclassified: string[];
    };
  }> {
    const apiKey =
      (input.credentials?.apiKey as string) ||
      (input.config?.apiKey as string) ||
      '';
    const cfg = input.config || {};
    const baseUrl =
      (cfg.baseUrl as string) || this.aiAdapter.getDefaultBaseUrl(input.provider);

    const result = await this.aiAdapter.fetchModels(apiKey, baseUrl, input.provider, input.config);

    if (result.ok) {
      const totalModels = Object.values(result.models).reduce((sum, arr) => sum + arr.length, 0);
      this.logsService.log('system', `连通性测试成功: ${input.provider} - ${totalModels} 个模型`, {
        meta: { baseUrl, llm: result.models.llm.length, image: result.models.image.length },
      });
    } else {
      this.logsService.log('system', `连通性测试失败: ${input.provider} - ${result.message}`, {
        level: 'error',
        meta: { baseUrl },
      });
    }

    return result;
  }

  // ============================================================
  // 凭证解密(供业务模块调用,如 AI 生成)
  // ============================================================

  /**
   * 取出指定 type 的默认 Provider 原始记录(含密文 credentials)
   * 业务方自行解密 + 使用,避免依赖 service 内部的 mask 逻辑
   */
  async getDefaultRaw(type: string): Promise<ApiProvider | null> {
    return this.prisma.apiProvider.findFirst({
      where: { type, isDefault: true, enabled: true },
    });
  }

  /**
   * 取出指定 type 的所有 Provider 原始记录(含密文 credentials,不过滤 isDefault)
   * 业务方自行过滤和使用
   */
  async findAllRaw(type: string): Promise<ApiProvider[]> {
    return this.prisma.apiProvider.findMany({
      where: { type },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * 按 id 取出原始记录(含密文 credentials)
   */
  async getRawById(id: string): Promise<ApiProvider> {
    const provider = await this.prisma.apiProvider.findUnique({ where: { id } });
    if (!provider) {
      throw notFound(ErrorCode.CHANNEL_NOT_FOUND, `API provider not found: ${id}`);
    }
    return provider;
  }

  /**
   * 解密 apiKey 字段(约定 credentials.json 中 apiKey 字段)
   * 业务模块(如 ai-generate)调用以发起真实请求
   */
  async getDecryptedApiKey(id: string): Promise<string> {
    const provider = await this.getRawById(id);
    const creds = (provider.credentials as Record<string, any>) || {};
    if (creds.apiKey && typeof creds.apiKey === 'string') {
      return decrypt(creds.apiKey, this.encryptionKey);
    }
    return '';
  }

  /**
   * 标记最近使用时间(轻量更新,fire-and-forget 也可)
   */
  async markUsed(id: string): Promise<void> {
    await this.prisma.apiProvider.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {
      // 更新失败不影响业务
    });
  }

  // ============================================================
  // 内部辅助
  // ============================================================

  /**
   * 验证 type 与 provider 的匹配
   */
  private validateTypeAndProvider(type: string, provider: string): void {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw badRequest(ErrorCode.BAD_REQUEST, `Unsupported type: ${type}`);
    }
    if (!adapter.supportedProviders.includes(provider)) {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        `${type} does not support provider ${provider}, only: ${adapter.supportedProviders.join(', ')}`,
      );
    }
  }

  /**
   * 加密凭证 - 递归扫描对象
   */
  private encryptCredentials(creds: Record<string, any>): Record<string, any> {
    const encrypted: Record<string, any> = {};
    for (const [k, v] of Object.entries(creds)) {
      const isSensitive = /pass|secret|token|key/i.test(k);
      if (isSensitive && typeof v === 'string' && v.length > 0) {
        encrypted[k] = encrypt(v, this.encryptionKey);
      } else {
        encrypted[k] = v;
      }
    }
    return encrypted;
  }

  /**
   * 解密凭证 - 递归扫描对象
   */
  private decryptCredentials(creds: Record<string, any>): Record<string, any> {
    if (!creds || typeof creds !== 'object') return creds;
    const decrypted: Record<string, any> = {};
    for (const [k, v] of Object.entries(creds)) {
      const isSensitive = /pass|secret|token|key/i.test(k);
      if (isSensitive && typeof v === 'string' && v.length > 0) {
        try {
          decrypted[k] = decrypt(v, this.encryptionKey);
        } catch {
          decrypted[k] = '';
        }
      } else {
        decrypted[k] = v;
      }
    }
    return decrypted;
  }

  /**
   * 构造脱敏摘要(如 "sk-***XkAb | 4 keys")
   */
  private buildMaskSummary(creds: Record<string, any>): string | null {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(creds)) {
      const isSensitive = /pass|secret|token|key/i.test(k);
      if (isSensitive && typeof v === 'string' && v.length > 0) {
        parts.push(`${k}=${maskApiKey(v)}`);
      }
    }
    return parts.length > 0 ? parts.join(' | ') : null;
  }

  /**
   * 返回前端可用的脱敏记录
   */
  private maskProvider(provider: ApiProvider): any {
    const creds = (provider.credentials as Record<string, any>) || {};
    return {
      ...provider,
      // 凭证保持密文,前端不接触明文
      credentials: this.maskCredentialsForFrontend(creds),
      hasCredentials: Object.keys(creds).length > 0,
    };
  }

  /**
   * 前端脱敏 - 把所有敏感字段标记为 [encrypted]
   * 前端如需查看明文,必须重新输入凭证
   */
  private maskCredentialsForFrontend(creds: Record<string, any>): Record<string, any> {
    if (!creds || typeof creds !== 'object') return {};
    const masked: Record<string, any> = {};
    for (const [k, v] of Object.entries(creds)) {
      const isSensitive = /pass|secret|token|key/i.test(k);
      if (isSensitive) {
        masked[k] = '[encrypted]';
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }
}
