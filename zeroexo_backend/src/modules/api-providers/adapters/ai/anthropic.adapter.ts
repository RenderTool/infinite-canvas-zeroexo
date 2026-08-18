import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from '../base.adapter';
import { ApiProviderError } from '../api-provider.error';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

/**
 * Anthropic Claude 适配器
 *
 * 协议说明:
 * - 默认走 Anthropic 原生 /v1/messages(x-api-key + anthropic-version 头)
 * - 同时支持 OpenAI 兼容端点 /v1/chat/completions(Anthropic 官方提供)
 *
 * 配置(config):
 * - baseUrl:     兼容中转或自建网关(默认 https://api.anthropic.com)
 * - defaultModel:默认模型(如 claude-3-5-sonnet-latest / claude-3-haiku-20240307)
 * - apiFormat:   'anthropic' | 'openai' 决定调用哪个端点
 *
 * 凭证(加密):
 * - apiKey: x-api-key(原生) 或 Authorization Bearer(OpenAI 兼容)
 *
 * 能力声明: ['text']
 */
@Injectable()
export class AnthropicAdapter extends BaseApiAdapter {
  readonly type = 'ai' as const;
  readonly supportedProviders: string[] = ['anthropic'];

  protected readonly logger = new Logger(AnthropicAdapter.name);
  private static readonly DEFAULT_BASE_URL = 'https://api.anthropic.com';
  private static readonly ANTHROPIC_VERSION = '2023-06-01';
  /** 常见模型列表,用于健康检查或前端展示 */
  static readonly MODELS = [
    'claude-3-5-sonnet-latest',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-latest',
    'claude-3-haiku-20240307',
    'claude-3-opus-20240229',
  ] as const;

  constructor(private readonly config: ConfigService) {
    super();
  }

  private get encryptionKey(): string {
    const key = this.config.get<string>('ai.encryptionKey');
    if (!key) {
      throw new Error('Missing required config: ai.encryptionKey');
    }
    return key;
  }

  // ============================================================
  // 抽象方法
  // ============================================================

  async validateConfig(config: Record<string, any>): Promise<string | null> {
    if (!config || typeof config !== 'object') return '配置必须是对象';
    if (config.apiFormat && !['anthropic', 'openai'].includes(config.apiFormat)) {
      return `不支持的 apiFormat: ${config.apiFormat}`;
    }
    return null;
  }

  /**
   * 健康检查
   * - 原生协议: 发 1 次最小 messages 请求(只问一个 1 token 的问题)
   * - OpenAI 兼容: GET /v1/models
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();

    if (!provider.enabled) {
      return { ok: false, status: 'down', error: '渠道已禁用', checkedAt };
    }
    const creds = (provider.credentials as any) ?? {};
    if (!creds.apiKey) {
      return { ok: false, status: 'down', error: '缺少 apiKey', checkedAt };
    }
    const cfg = (provider.config as any) ?? {};
    const baseUrl = (cfg.baseUrl ?? AnthropicAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');
    const apiFormat: 'anthropic' | 'openai' = cfg.apiFormat ?? 'anthropic';

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);

    try {
      if (apiFormat === 'openai') {
        const res = await fetch(`${baseUrl}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
          return {
            ok: false,
            status: 'down',
            latencyMs: Date.now() - start,
            error: `HTTP ${res.status}`,
            checkedAt,
          };
        }
      } else {
        // Anthropic 原生: 1 token 的最小 messages 请求
        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': AnthropicAdapter.ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: cfg.defaultModel ?? 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return {
            ok: false,
            status: 'down',
            latencyMs: Date.now() - start,
            error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
            checkedAt,
          };
        }
      }
      return {
        ok: true,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt,
        meta: { baseUrl, apiFormat, defaultModel: cfg.defaultModel },
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

  async invokeAction(
    provider: ApiProvider,
    action: string,
    params: Record<string, any>,
  ): Promise<any> {
    switch (action) {
      case 'chat':
        return this.chat(provider, params as any);
      case 'listModels':
        return { models: [...AnthropicAdapter.MODELS] };
      default:
        throw new ApiProviderError(`Anthropic 适配器不支持 action: ${action}`, {
          provider: provider.provider,
          action,
        });
    }
  }

  getUsageMetrics(): string[] {
    return ['token', 'request'];
  }

  // ============================================================
  // 业务方法
  // ============================================================

  /**
   * 通用对话
   * - params.messages: OpenAI 格式消息数组
   * - params.model:    可选,缺省 config.defaultModel
   * - params.max_tokens: 可选,默认 1024
   */
  async chat(
    provider: ApiProvider,
    params: {
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    },
  ): Promise<{ content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
    if (!params?.messages?.length) {
      throw new ApiProviderError('messages 必填', { provider: provider.provider, action: 'chat' });
    }
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const baseUrl = (cfg.baseUrl ?? AnthropicAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');
    const apiFormat: 'anthropic' | 'openai' = cfg.apiFormat ?? 'anthropic';
    const model = params.model ?? cfg.defaultModel ?? 'claude-3-5-sonnet-latest';
    const maxTokens = params.maxTokens ?? 1024;

    try {
      if (apiFormat === 'openai') {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: params.messages,
            max_tokens: maxTokens,
            temperature: params.temperature,
          }),
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new ApiProviderError(`Anthropic OpenAI 兼容调用失败: ${data?.error?.message ?? res.status}`, {
            provider: provider.provider,
            action: 'chat',
            upstream: data,
          });
        }
        return {
          content: data.choices?.[0]?.message?.content ?? '',
          model,
          usage: data.usage && {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          },
        };
      }
      // Anthropic 原生协议
      const sys = params.messages.find((m) => m.role === 'system')?.content;
      const msgs = params.messages.filter((m) => m.role !== 'system');
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': AnthropicAdapter.ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          system: sys,
          messages: msgs,
          max_tokens: maxTokens,
          temperature: params.temperature,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiProviderError(`Anthropic 调用失败: ${data?.error?.message ?? res.status}`, {
          provider: provider.provider,
          action: 'chat',
          upstream: data,
        });
      }
      const text = (data.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      return {
        content: text,
        model,
        usage: data.usage && {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
        },
      };
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `Anthropic 调用异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'chat', upstream: err },
      );
    }
  }
}
