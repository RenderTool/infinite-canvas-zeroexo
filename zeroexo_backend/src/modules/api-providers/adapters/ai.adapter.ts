import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { decrypt } from '../../../common/crypto/crypto-aes.util';
import { BaseApiAdapter, HealthResult } from './base.adapter';
import { buildApiUrl } from './build-api-url';
import {
  getFetchStrategy,
  renderHeaders,
  renderQueryParams,
  extractModelIds,
} from '../presets/fetch-strategies';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * AI 渠道连通性测试的逐步骤结果(供前端展示测试流程)
 * 步骤名:解析 baseUrl / 校验 API Key / Mock 渠道检查 / 构造请求 URL / 调用 models 端点 / 解析响应
 */
export interface ProviderTestStep {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
  durationMs?: number;
}

/**
 * AI 渠道连通性测试的最终结果
 */
export interface ProviderTestResult {
  ok: boolean;
  message: string;
  models?: string[];
  steps?: ProviderTestStep[];
}

/**
 * AI 渠道支持的服务商标识
 * - openai:      OpenAI 官方
 * - anthropic:   Anthropic Claude
 * - gemini:      Google Gemini
 * - stability:   Stability AI(图像)
 * - volcengine:  火山引擎方舟
 * - bailian:     阿里百炼(OpenAI 兼容)
 * - deepseek:    DeepSeek(OpenAI 兼容)
 * - siliconflow: SiliconFlow 硅基流动(OpenAI 兼容)
 * - mock:        本地 mock(不发起真实请求)
 * - custom:      兼容 OpenAI 协议的中转/自建服务
 */
const SUPPORTED = [
  'openai',
  'anthropic',
  'gemini',
  'gemini-cn',
  'stability',
  'volcengine',
  'bailian',
  'deepseek',
  'siliconflow',
  'mock',
  'custom',
] as const;

type ProviderType = (typeof SUPPORTED)[number];

/**
 * 渠道余额查询结果
 * - supported=false: 该渠道无官方余额 API(DB 中 balanceError 记 UNSUPPORTED 哨兵)
 * - ok=false + message: 支持查询但本次失败(脱敏后的错误描述)
 */
export interface BalanceResult {
  supported: boolean;
  ok?: boolean;
  balance?: number;
  currency?: string;
  message?: string;
}

/**
 * 各渠道商官方余额 API 配置表(仅登记有官方接口的渠道)
 * - deepseek:    GET {base}/user/balance        → balance_infos[].total_balance(实测为复数数组)
 * - siliconflow: GET {base}/v1/user/info        → data.balance
 * - stability:   GET {base}/v1/user/balance     → credits
 * - moonshot:    GET {base}/v1/users/me/balance → data[].balance(按 cash_type 汇总)
 * - openrouter:  GET {base}/api/v1/auth/key     → data.limit - data.usage
 * 未登记的渠道(openai/gemini/anthropic/volcengine/bailian/custom 等)
 * 普通 key 无官方余额接口,返回 supported:false。
 */
const BALANCE_ENDPOINTS: Record<
  string,
  {
    path: string;
    extract: (json: Record<string, any>) => { balance: number | null; currency?: string };
  }
> = {
  deepseek: {
    path: '/user/balance',
    extract: (json) => {
      // 实测响应: { is_available, balance_infos: [{ currency, total_balance, ... }] }
      const list = Array.isArray(json?.balance_infos)
        ? json.balance_infos
        : json?.balance_info
          ? [json.balance_info]
          : [];
      let total = 0;
      let currency = 'CNY';
      let matched = false;
      for (const item of list) {
        const v = Number(item?.total_balance);
        if (Number.isFinite(v)) {
          total += v;
          currency = item?.currency || currency;
          matched = true;
        }
      }
      return matched ? { balance: total, currency } : { balance: null };
    },
  },
  siliconflow: {
    path: '/v1/user/info',
    extract: (json) => {
      const v = Number(json?.data?.balance);
      return Number.isFinite(v) ? { balance: v, currency: 'CNY' } : { balance: null };
    },
  },
  stability: {
    path: '/v1/user/balance',
    extract: (json) => {
      const v = Number(json?.credits);
      return Number.isFinite(v) ? { balance: v, currency: 'credits' } : { balance: null };
    },
  },
  moonshot: {
    path: '/v1/users/me/balance',
    extract: (json) => {
      const list = Array.isArray(json?.data) ? json.data : [];
      const total = list.reduce((sum: number, item: any) => sum + (Number(item?.balance) || 0), 0);
      return list.length > 0 ? { balance: total, currency: 'CNY' } : { balance: null };
    },
  },
  openrouter: {
    path: '/api/v1/auth/key',
    extract: (json) => {
      const d = json?.data ?? {};
      const usage = Number(d.usage) || 0;
      const limit =
        d.limit === null || d.limit === undefined ? Number(d.total_credits) : Number(d.limit);
      // 无额度上限(limit=null)时以负消耗表示已用量
      return Number.isFinite(limit) ? { balance: limit - usage, currency: 'USD' } : { balance: -usage, currency: 'USD' };
    },
  },
};

/** 余额错误信息哨兵: 渠道无官方余额接口 */
export const BALANCE_UNSUPPORTED = 'UNSUPPORTED';

/**
 * AI 适配器 - 统一 AI 渠道的连接校验与操作
 *
 * 实现:
 * - 原 ai-providers.service.ts 的 testConnectivity 逻辑(逐步骤)已整体迁移至此
 * - Stage E 统一从 ApiProvider(type='ai') 读取
 */
@Injectable()
export class AiAdapter extends BaseApiAdapter {
  readonly type = 'ai' as const;
  readonly supportedProviders: string[] = [...SUPPORTED];

  private readonly aiConfig: {
    openaiBaseUrl?: string;
    geminiBaseUrl?: string;
    stabilityBaseUrl?: string;
    volcengineBaseUrl?: string;
    requestTimeoutMs: number;
  };

  constructor(private readonly config: ConfigService) {
    super();
    this.aiConfig = {
      openaiBaseUrl: config.get<string>('ai.openaiBaseUrl'),
      geminiBaseUrl: config.get<string>('ai.geminiBaseUrl'),
      stabilityBaseUrl: config.get<string>('ai.stabilityBaseUrl'),
      volcengineBaseUrl: config.get<string>('ai.volcengineBaseUrl'),
      requestTimeoutMs: config.get<number>('ai.requestTimeoutMs') ?? 60000,
    };
  }

  /** 加密密钥 getter - 子类按需调用 */
  private get encryptionKey(): string {
    const key = this.config.get<string>('ai.encryptionKey');
    if (!key) {
      throw new Error('Missing required config: ai.encryptionKey');
    }
    return key;
  }

  /**
   * 校验公开配置(非凭证字段)
   * provider 已在 ApiProvidersService.create 中由 validateTypeAndProvider 校验,此处配置特定校验暂不启用
   */
  async validateConfig(_config: Record<string, any>): Promise<string | null> {
    // provider 已在 ApiProvidersService.create 中由 validateTypeAndProvider 校验,此处无须重复
    return null;
  }

  /**
   * 健康检查 - 入口
   * 流程:
   * 1. 禁用渠道直接返回 down
   * 2. mock 渠道直接通过
   * 3. 解密 apiKey + 解析 baseUrl
   * 4. 调用 testConnectivity 走逐步骤流程
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();

    if (!provider.enabled) {
      return { ok: false, status: 'down', error: '渠道已禁用', checkedAt };
    }

    let apiKey = '';
    try {
      const creds = (provider.credentials as any) ?? {};
      apiKey = decrypt(creds.apiKey ?? '', this.encryptionKey);
    } catch (err) {
      return {
        ok: false,
        status: 'down',
        latencyMs: Date.now() - start,
        error: `凭证解密失败: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt,
      };
    }

    const cfg = (provider.config as any) ?? {};
    const baseUrl = cfg.baseUrl ?? this.getDefaultBaseUrl(provider.provider);

    // Mock 渠道直接通过
    if (provider.provider === 'mock') {
      return {
        ok: true,
        status: 'healthy',
        latencyMs: 0,
        checkedAt,
        details: { mock: true, baseUrl },
      };
    }

    try {
      const result = await this.testConnectivity(
        provider.provider as ProviderType,
        baseUrl,
        apiKey,
      );
      return {
        ok: result.ok,
        status: result.ok ? 'healthy' : 'down',
        latencyMs: Date.now() - start,
        error: result.ok ? undefined : result.message,
        checkedAt,
        details: { models: result.models, steps: result.steps, baseUrl },
      };
    } catch (err) {
      return {
        ok: false,
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        checkedAt,
      };
    }
  }

  /**
   * AI 类型业务动作分发
   * - test: 走 testConnectivity 流程并返回逐步骤结果
   * - chat-completions / generate / list-models: 留给调用方实现(本适配器只做健康/连通性)
   */
  async invokeAction(
    provider: ApiProvider,
    action: string,
    _params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'test': {
        const apiKey = decrypt(
          (provider.credentials as any).apiKey ?? '',
          this.encryptionKey,
        );
        const baseUrl =
          (provider.config as any)?.baseUrl ?? this.getDefaultBaseUrl(provider.provider);
        return this.testConnectivity(
          provider.provider as ProviderType,
          baseUrl,
          apiKey,
        );
      }
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `AI adapter does not support action: ${action}`);
    }
  }

  /**
   * 获取指定 provider 的模型列表并按类型分类
   *
   * 直接通过策略配置的 models 端点发起请求，
   * 不经过 testConnectivity（后者可能用 healthEndpoint 做连通性测试）。
   */
  async fetchModels(
    apiKey: string,
    baseUrl: string,
    provider: string,
    config?: Record<string, any>,
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
    const strategy = getFetchStrategy(provider);
    if (!strategy) {
      return {
        ok: false,
        message: `不支持的渠道类型: ${provider}`,
        models: { llm: [], image: [], video: [], audio: [], unclassified: [] },
      };
    }

    // Mock 渠道返回空（无实际模型列表）
    if (provider === 'mock') {
      return {
        ok: true,
        message: 'Mock 渠道无远程模型列表',
        models: { llm: [], image: [], video: [], audio: [], unclassified: [] },
      };
    }

    // 构造请求
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const apiBase = buildApiUrl(normalizedBase, provider);
    const url = `${apiBase}${strategy.endpoint}`;
    const headers = renderHeaders(strategy.headers, apiKey);
    const queryParams = renderQueryParams(strategy.queryParams, apiKey);
    let fullUrl = url;
    if (queryParams && Object.keys(queryParams).length > 0) {
      fullUrl += '?' + new URLSearchParams(queryParams).toString();
    }

    const timeoutMs = this.aiConfig.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(fullUrl, {
        method: strategy.method,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Custom 渠道(中转 API)常不实现 /models 端点(返回 404/405)。
        // 此时不返回任何预设模型,由用户在渠道详情中手动添加模型 ID。
        if (
          provider === 'custom' &&
          (res.status === 404 || res.status === 405)
        ) {
          return {
            ok: false,
            message: `/models 端点不可用(HTTP ${res.status}),请点击「添加模型」手动录入模型 ID`,
            models: { llm: [], image: [], video: [], audio: [], unclassified: [] },
          };
        }
        return {
          ok: false,
          message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
          models: { llm: [], image: [], video: [], audio: [], unclassified: [] },
        };
      }

      const json = (await res.json()) as Record<string, any>;
      const modelIds = extractModelIds(json, strategy);

      return this.categorizeModels(modelIds, provider, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `网络请求失败: ${msg}`,
        models: { llm: [], image: [], video: [], audio: [], unclassified: [] },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 渠道余额查询 - 按渠道类型路由到官方余额 API
   *
   * 错误脱敏: 错误信息截断 200 字符且不包含凭证;
   * 单渠道失败不抛异常,以 ok=false + message 返回。
   */
  async fetchBalance(provider: string, baseUrl: string, apiKey: string): Promise<BalanceResult> {
    const spec = BALANCE_ENDPOINTS[provider];
    if (!spec) {
      return { supported: false, message: BALANCE_UNSUPPORTED };
    }
    if (!apiKey) {
      return { supported: true, ok: false, message: 'API Key 未配置' };
    }
    if (!baseUrl) {
      return { supported: true, ok: false, message: 'baseUrl 未配置' };
    }

    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const url = `${normalizedBase}${spec.path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.aiConfig.requestTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          supported: true,
          ok: false,
          message: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const json = (await res.json()) as Record<string, any>;
      const parsed = spec.extract(json);
      if (parsed.balance === null) {
        return { supported: true, ok: false, message: '余额响应解析失败: 未找到有效余额字段' };
      }
      return { supported: true, ok: true, balance: parsed.balance, currency: parsed.currency };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: true,
        ok: false,
        message: `余额查询请求失败: ${msg.slice(0, 200)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 将模型 ID 列表按类型分类
   *
   * 分类规则（从高到低）：
   * 1. modelTypes 用户手动归类（config.modelTypes）- 最高优先级
   * 2. 未分类（unclassified）- 其余全部放这里，由用户手动归类
   *
   * 不再依赖预设硬编码 model ID 做自动分类或补充，
   * 所有模型类型归类均由用户手动完成。
   */
  private categorizeModels(
    modelIds: string[],
    _provider: string,
    config?: Record<string, any>,
  ): {
    ok: boolean;
    message: string;
    models: { llm: string[]; image: string[]; video: string[]; audio: string[]; unclassified: string[] };
    rawModelIds?: string[];
  } {
    const userModelTypes = (config?.modelTypes as Record<string, string>) || {};
    const categorized: {
      llm: string[];
      image: string[];
      video: string[];
      audio: string[];
      unclassified: string[];
    } = {
      llm: [],
      image: [],
      video: [],
      audio: [],
      unclassified: [],
    };

    for (const id of modelIds) {
      // ① 用户手动归类（最高优先级）
      const userType = userModelTypes[id.toLowerCase()];
      if (userType && ['llm', 'image', 'video', 'audio'].includes(userType)) {
        categorized[userType as keyof typeof categorized].push(id);
        continue;
      }

      // ② 未分类 - 全部放这里，由用户手动归类
      categorized.unclassified.push(id);
    }

    const unclassifiedCount = categorized.unclassified.length;
    return {
      ok: true,
      message:
        `获取到 ${modelIds.length} 个模型` +
        (unclassifiedCount > 0 ? `，${unclassifiedCount} 个待归类` : ''),
      models: categorized,
      rawModelIds: modelIds,
    };
  }

  /** AI 渠道支持的上报指标 */
  getUsageMetrics(): string[] {
    return ['token', 'request', 'image_generated', 'video_generated'];
  }

  /**
   * AI 公开配置字段 - 供前端动态表单
   * - baseUrl: 自定义网关
   * - model: 默认模型名
   * - apiFormat: 协议格式(openai/anthropic/...)
   */
  getConfigFields() {
    return [
      {
        key: 'baseUrl',
        label: '网关地址',
        type: 'text' as const,
        placeholder: 'https://api.openai.com/v1',
        description: '自定义中转 API 时填写,默认走服务端配置',
      },
      {
        key: 'defaultModel',
        label: '默认模型',
        type: 'text' as const,
        placeholder: 'gpt-4o',
        description: '未在请求中指定模型时使用',
      },
      {
        key: 'apiFormat',
        label: 'API 协议',
        type: 'select' as const,
        options: [
          { value: 'openai', label: 'OpenAI 兼容' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Gemini' },
        ],
      },
    ];
  }

  /** AI 凭证字段 - 仅 apiKey 一项 */
  getCredentialsFields() {
    return [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password' as const,
        required: true,
        placeholder: 'sk-...',
        description: '加密落库,前端不回显明文',
      },
    ];
  }

  // ===== 私有方法 =====



  /**
   * 渠道默认 baseUrl - 当 ApiProvider.config.baseUrl 为空时回退
   */
  getDefaultBaseUrl(provider: string): string {
    switch (provider) {
      case 'openai':
        return this.aiConfig.openaiBaseUrl ?? 'https://api.openai.com';
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'gemini':
        return this.aiConfig.geminiBaseUrl ?? 'https://generativelanguage.googleapis.com';
      case 'stability':
        return this.aiConfig.stabilityBaseUrl ?? 'https://api.stability.ai';
      case 'volcengine':
        return this.aiConfig.volcengineBaseUrl ?? 'https://ark.cn-beijing.volces.com';
      case 'bailian':
        return 'https://dashscope.aliyuncs.com/compatible-mode';
      case 'deepseek':
        return 'https://api.deepseek.com';
      case 'siliconflow':
        return 'https://api.siliconflow.cn';
      case 'mock':
        return 'http://mock';
      default:
        throw badRequest(ErrorCode.CHANNEL_BASE_URL_MISSING, `Provider type ${provider} requires baseUrl configuration`);
    }
  }

  /**
   * 核心连通性测试 - 从原 AiProvidersService.testConnectivity 整体迁移
   *
   * 流程(6 步骤):
   * 1. 解析 baseUrl
   * 2. 校验 API Key
   * 3. Mock 渠道短路
   * 4. 构造请求 URL
   * 5. 调用 models 端点
   * 6. 解析响应
   */
  private async testConnectivity(
    provider: ProviderType,
    baseUrl: string,
    apiKey: string,
  ): Promise<ProviderTestResult> {
    const steps: ProviderTestStep[] = [];
    const pushStep = (
      name: string,
      status: 'pass' | 'fail' | 'skip',
      detail?: string,
      durationMs?: number,
    ) => {
      steps.push({ name, status, detail, durationMs });
    };

    // Step 1: 解析 baseUrl
    const step1Start = Date.now();
    let normalizedBase: string;
    try {
      normalizedBase = baseUrl.replace(/\/$/, '');
      if (!normalizedBase) throw new Error('baseUrl 为空');
      pushStep('解析 baseUrl', 'pass', normalizedBase, Date.now() - step1Start);
    } catch (err) {
      pushStep(
        '解析 baseUrl',
        'fail',
        err instanceof Error ? err.message : String(err),
        Date.now() - step1Start,
      );
      return { ok: false, message: 'baseUrl 无效', steps };
    }

    // Step 2: 校验 API Key
    const step2Start = Date.now();
    if (!apiKey || apiKey.length < 4) {
      pushStep('校验 API Key', 'fail', 'API Key 长度不足', Date.now() - step2Start);
      return { ok: false, message: 'API Key 无效', steps };
    }
    pushStep('校验 API Key', 'pass', `长度 ${apiKey.length}`, Date.now() - step2Start);

    // Step 3: Mock 渠道短路
    if (provider === 'mock') {
      pushStep('Mock 渠道检查', 'pass', '无需外部调用,直接通过', 0);
      return { ok: true, message: 'Mock 渠道就绪(无需外部连通性测试)', steps };
    }

    // Step 4: 从策略配置构造请求 URL
    const step3Start = Date.now();
    const strategy = getFetchStrategy(provider);
    let url: string;
    let headers: Record<string, string> = {};
    let requestBody: string | undefined;
    let usingHealthEndpoint = false;
    try {
      if (!strategy) {
        throw new Error(`不支持的渠道类型: ${provider}`);
      }

      const apiBase = buildApiUrl(normalizedBase, provider);

      // 如果存在 healthEndpoint（如 Anthropic），用 health 端点做连通性测试
      // models 端点用于 fetchModels，health 端点只验证连通性
      if (strategy.healthEndpoint && strategy.healthBody) {
        url = `${apiBase}${strategy.healthEndpoint}`;
        headers = renderHeaders(strategy.headers, apiKey);
        headers['content-type'] = 'application/json';
        requestBody = JSON.stringify(strategy.healthBody);
        usingHealthEndpoint = true;
      } else {
        url = `${apiBase}${strategy.endpoint}`;
        headers = renderHeaders(strategy.headers, apiKey);
      }

      // 查询参数（如 Gemini 的 ?key=xxx）
      const queryParams = renderQueryParams(strategy.queryParams, apiKey);
      if (queryParams && Object.keys(queryParams).length > 0) {
        const qs = new URLSearchParams(queryParams).toString();
        url += (url.includes('?') ? '&' : '?') + qs;
      }

      pushStep('构造请求 URL', 'pass', url, Date.now() - step3Start);
    } catch (err) {
      pushStep(
        '构造请求 URL',
        'fail',
        err instanceof Error ? err.message : String(err),
        Date.now() - step3Start,
      );
      return { ok: false, message: '请求构造失败', steps };
    }

    // Step 5: 发起 HTTP 请求（支持策略配置的 GET/POST）
    const timeoutMs = this.aiConfig.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const step4Start = Date.now();
    let res: Response;
    try {
      const fetchMethod = usingHealthEndpoint
        ? strategy.healthMethod ?? 'GET'
        : strategy.method;
      const fetchInit: RequestInit = {
        method: fetchMethod,
        headers,
        signal: controller.signal,
      };
      if (fetchMethod === 'POST' && requestBody) {
        fetchInit.body = requestBody;
      }
      res = await fetch(url, fetchInit);
      pushStep(
        '调用 models 端点',
        'pass',
        `HTTP ${res.status}`,
        Date.now() - step4Start,
      );
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      pushStep('调用 models 端点', 'fail', msg, Date.now() - step4Start);
      return { ok: false, message: `网络请求失败: ${msg}`, steps };
    }

    // Step 6: 根据策略配置解析响应
    const step5Start = Date.now();
    try {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const detail = text.slice(0, 200);
        // Custom 渠道(中转 API)常不实现 /models 端点(404/405)。
        // 服务本身可达且 API Key 已通过长度校验,视为连通正常,
        // 但不返回任何预设模型,由用户在渠道详情中手动添加。
        if (
          provider === 'custom' &&
          (res.status === 404 || res.status === 405)
        ) {
          pushStep(
            '解析响应',
            'pass',
            `HTTP ${res.status} (/models 端点不可用,中转服务常见)`,
            Date.now() - step5Start,
          );
          return {
            ok: true,
            message: '连接成功(/models 端点不可用,请在详情页手动添加模型)',
            steps,
          };
        }
        pushStep(
          '解析响应',
          'fail',
          `HTTP ${res.status}: ${detail}`,
          Date.now() - step5Start,
        );
        return { ok: false, message: `HTTP ${res.status}: ${detail}`, steps };
      }

      const json = (await res.json()) as Record<string, any>;
      let models: string[] = [];

      // 如果是 healthEndpoint（如 Anthropic），无模型列表返回
      if (!usingHealthEndpoint && strategy) {
        models = extractModelIds(json, strategy);
      }

      pushStep('解析响应', 'pass', `解析到 ${models.length} 个模型`, Date.now() - step5Start);
      return {
        ok: true,
        message: '连接成功',
        models: models.slice(0, 50),
        steps,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushStep('解析响应', 'fail', msg, Date.now() - step5Start);
      return { ok: false, message: `响应解析失败: ${msg}`, steps };
    } finally {
      clearTimeout(timer);
    }
  }
}
