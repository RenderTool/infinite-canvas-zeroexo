import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from '../base.adapter';
import { ApiProviderError } from '../api-provider.error';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

/**
 * Stability AI 文生图适配器
 *
 * 端点:
 * - /v2beta/stable-image/generate/{engine}
 * - /v1/generation/{engine_id}/text-to-image(Legacy)
 *
 * 配置(config):
 * - baseUrl: 默认 https://api.stability.ai
 * - engine:  默认引擎 stable-diffusion-xl-1024-v1-0
 * - mode:    'rest' (REST 直连) | 'legacy' (走 /v1/generation)
 *
 * 凭证(加密):
 * - apiKey: Bearer token
 *
 * 能力声明: ['image']
 */
@Injectable()
export class StabilityAdapter extends BaseApiAdapter {
  readonly type = 'ai' as const;
  readonly supportedProviders: string[] = ['stability'];

  protected readonly logger = new Logger(StabilityAdapter.name);
  private static readonly DEFAULT_BASE_URL = 'https://api.stability.ai';
  static readonly ENGINES = [
    'stable-diffusion-xl-1024-v1-0',
    'stable-diffusion-3',
    'stable-diffusion-3-5-large',
    'stable-image-core',
    'stable-image-ultra',
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
    if (config.engine && !StabilityAdapter.ENGINES.includes(config.engine)) {
      // 不阻断,只警告;允许用户填入私有引擎
      this.logger.warn(`Stability 引擎 ${config.engine} 不在白名单内`);
    }
    return null;
  }

  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const creds = (provider.credentials as any) ?? {};
    if (!creds.apiKey) {
      return { ok: false, status: 'down', error: '缺少 apiKey', checkedAt };
    }
    const cfg = (provider.config as any) ?? {};
    const baseUrl = (cfg.baseUrl ?? StabilityAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);

    try {
      // GET /v1/user/account 是官方提供的轻量端点
      const res = await fetch(`${baseUrl}/v1/user/account`, {
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
      const data: any = await res.json().catch(() => ({}));
      return {
        ok: true,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt,
        meta: { baseUrl, email: data.email, credits: data.credits },
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
      case 'textToImage':
        return this.textToImage(provider, params as any);
      case 'listEngines':
        return { engines: [...StabilityAdapter.ENGINES] };
      default:
        throw new ApiProviderError(`Stability 适配器不支持 action: ${action}`, {
          provider: provider.provider,
          action,
        });
    }
  }

  getUsageMetrics(): string[] {
    return ['image_generated', 'request'];
  }

  // ============================================================
  // 业务方法
  // ============================================================

  /**
   * 文生图
   * @param params.prompt    文本提示词
   * @param params.engine    引擎(可选,默认 stable-diffusion-xl-1024-v1-0)
   * @param params.steps     步数
   * @param params.cfgScale  提示词相关性
   * @param params.width     宽
   * @param params.height    高
   * @param params.samples   出图张数
   * @returns images: data URL 数组(base64)
   */
  async textToImage(
    provider: ApiProvider,
    params: {
      prompt: string;
      engine?: string;
      negativePrompt?: string;
      steps?: number;
      cfgScale?: number;
      width?: number;
      height?: number;
      samples?: number;
    },
  ): Promise<{ images: string[]; engine: string; seeds?: number[] }> {
    if (!params?.prompt) {
      throw new ApiProviderError('prompt 必填', {
        provider: provider.provider,
        action: 'textToImage',
      });
    }
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const baseUrl = (cfg.baseUrl ?? StabilityAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');
    const engine = params.engine ?? cfg.engine ?? 'stable-diffusion-xl-1024-v1-0';
    const mode: 'rest' | 'legacy' = cfg.mode ?? 'rest';

    try {
      if (mode === 'legacy') {
        // 走 /v1/generation/{engine}/text-to-image
        const url = `${baseUrl}/v1/generation/${engine}/text-to-image`;
        const body = {
          text_prompts: [
            { text: params.prompt, weight: 1 },
            ...(params.negativePrompt ? [{ text: params.negativePrompt, weight: -1 }] : []),
          ],
          cfg_scale: params.cfgScale ?? 7,
          height: params.height ?? 1024,
          width: params.width ?? 1024,
          steps: params.steps ?? 30,
          samples: params.samples ?? 1,
        };
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new ApiProviderError(`Stability legacy 调用失败: ${data?.message ?? res.status}`, {
            provider: provider.provider,
            action: 'textToImage',
            upstream: data,
          });
        }
        return {
          images: (data.artifacts ?? []).map((a: any) =>
            a.base64 ? `data:image/png;base64,${a.base64}` : '',
          ),
          engine,
          seeds: (data.artifacts ?? []).map((a: any) => a.seed).filter((x: any) => typeof x === 'number'),
        };
      }
      // REST v2beta 端点
      const url = `${baseUrl}/v2beta/stable-image/generate/${engine === 'stable-image-ultra' ? 'ultra' : 'core'}`;
      const form = new FormData();
      form.append('prompt', params.prompt);
      if (params.negativePrompt) form.append('negative_prompt', params.negativePrompt);
      if (params.samples) form.append('samples', String(params.samples));
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'image/*',
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ApiProviderError(`Stability REST 调用失败: HTTP ${res.status} ${text.slice(0, 200)}`, {
          provider: provider.provider,
          action: 'textToImage',
        });
      }
      // 直接返回二进制图片 -> 转为 base64 data URL
      const buf = Buffer.from(await res.arrayBuffer());
      const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      return { images: [dataUrl], engine };
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `Stability 调用异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'textToImage', upstream: err },
      );
    }
  }
}
