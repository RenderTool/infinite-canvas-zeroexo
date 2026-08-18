import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvider } from '@prisma/client';
import { BaseApiAdapter, HealthResult } from '../base.adapter';
import { ApiProviderError } from '../api-provider.error';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

/**
 * 阿里云百炼(原 DashScope)模型平台适配器
 *
 * 端点:
 * - OpenAI 兼容: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
 * - 图像(wanx): https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis
 * - 视频: https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
 * - 语音(cosyvoice): https://dashscope.aliyuncs.com/api/v1/services/aigc/text2voice/voice
 *
 * 配置(config):
 * - baseUrl:     默认 https://dashscope.aliyuncs.com
 * - defaultModel:默认文本模型(qwen-plus)
 *
 * 凭证(加密):
 * - apiKey: DashScope API Key
 *
 * 能力声明: ['text', 'image', 'video', 'audio']
 */
@Injectable()
export class AliyunBailianAdapter extends BaseApiAdapter {
  readonly type = 'ai' as const;
  readonly supportedProviders: string[] = ['aliyun-bailian'];

  protected readonly logger = new Logger(AliyunBailianAdapter.name);
  private static readonly DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com';
  private static readonly COMPATIBLE_PATH = '/compatible-mode/v1';
  static readonly TEXT_MODELS = [
    'qwen-plus',
    'qwen-turbo',
    'qwen-max',
    'qwen-long',
    'qwen-coder-plus',
  ] as const;
  static readonly IMAGE_MODELS = [
    'wanx-v1',
    'wanx2.1-t2i-turbo',
    'wanx2.1-t2i-plus',
  ] as const;
  static readonly VIDEO_MODELS = [
    'wanx2.1-t2v-turbo',
    'wanx2.1-t2v-plus',
  ] as const;
  static readonly AUDIO_MODELS = [
    'cosyvoice-v1',
    'sambert-zhichu-v1',
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
    return null;
  }

  /**
   * 健康检查
   * - 调 OpenAI 兼容端点的 /models(轻量)
   */
  async healthCheck(provider: ApiProvider): Promise<HealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const creds = (provider.credentials as any) ?? {};
    if (!creds.apiKey) {
      return { ok: false, status: 'down', error: '缺少 apiKey', checkedAt };
    }
    const cfg = (provider.config as any) ?? {};
    const baseUrl = (cfg.baseUrl ?? AliyunBailianAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);

    try {
      const res = await fetch(`${baseUrl}${AliyunBailianAdapter.COMPATIBLE_PATH}/models`, {
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
      return {
        ok: true,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt,
        meta: { baseUrl, defaultModel: cfg.defaultModel ?? 'qwen-plus' },
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
      case 'textToImage':
        return this.textToImage(provider, params as any);
      case 'textToVideo':
        return this.textToVideo(provider, params as any);
      case 'textToSpeech':
        return this.textToSpeech(provider, params as any);
      case 'listModels':
        return {
          text: [...AliyunBailianAdapter.TEXT_MODELS],
          image: [...AliyunBailianAdapter.IMAGE_MODELS],
          video: [...AliyunBailianAdapter.VIDEO_MODELS],
          audio: [...AliyunBailianAdapter.AUDIO_MODELS],
        };
      default:
        throw new ApiProviderError(`Aliyun Bailian 适配器不支持 action: ${action}`, {
          provider: provider.provider,
          action,
        });
    }
  }

  getUsageMetrics(): string[] {
    return ['token', 'request', 'image_generated', 'video_generated'];
  }

  // ============================================================
  // 业务方法
  // ============================================================

  /**
   * 文本对话(走 OpenAI 兼容端点)
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
    const baseUrl = (cfg.baseUrl ?? AliyunBailianAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = params.model ?? cfg.defaultModel ?? 'qwen-plus';

    try {
      const res = await fetch(`${baseUrl}${AliyunBailianAdapter.COMPATIBLE_PATH}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: params.messages,
          max_tokens: params.maxTokens ?? 1024,
          temperature: params.temperature,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiProviderError(`百炼 chat 失败: ${data?.error?.message ?? res.status}`, {
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
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `百炼 chat 异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'chat', upstream: err },
      );
    }
  }

  /**
   * 文生图(wanx)
   * 注意: 百炼图像走异步任务,此函数会轮询直到完成或超时
   */
  async textToImage(
    provider: ApiProvider,
    params: { prompt: string; model?: string; style?: string; size?: string; n?: number; pollIntervalMs?: number; timeoutMs?: number },
  ): Promise<{ images: string[]; taskId: string; model: string }> {
    if (!params?.prompt) {
      throw new ApiProviderError('prompt 必填', { provider: provider.provider, action: 'textToImage' });
    }
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const baseUrl = (cfg.baseUrl ?? AliyunBailianAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = params.model ?? 'wanx-v1';

    try {
      // 1. 提交任务
      const submitRes = await fetch(`${baseUrl}/api/v1/services/aigc/text2image/image-synthesis`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model,
          input: {
            prompt: params.prompt,
            ...(params.style ? { style: params.style } : {}),
          },
          parameters: {
            size: params.size ?? '1024*1024',
            n: params.n ?? 1,
          },
        }),
      });
      const submitData: any = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok || !submitData?.output?.task_id) {
        throw new ApiProviderError(`百炼 图像提交失败: ${submitData?.message ?? submitRes.status}`, {
          provider: provider.provider,
          action: 'textToImage',
          upstream: submitData,
        });
      }
      const taskId = submitData.output.task_id;
      // 2. 轮询
      const pollInterval = params.pollIntervalMs ?? 2000;
      const timeout = params.timeoutMs ?? 60000;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollInterval));
        const queryRes = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const queryData: any = await queryRes.json().catch(() => ({}));
        const status = queryData?.output?.task_status;
        if (status === 'SUCCEEDED') {
          const urls = (queryData?.output?.results ?? []).map((r: any) => r.url).filter(Boolean);
          return { images: urls, taskId, model };
        }
        if (status === 'FAILED' || status === 'CANCELED') {
          throw new ApiProviderError(`百炼 图像任务失败: ${status} ${queryData?.output?.message ?? ''}`, {
            provider: provider.provider,
            action: 'textToImage',
            upstream: queryData,
          });
        }
      }
      throw new ApiProviderError('百炼 图像任务超时', {
        provider: provider.provider,
        action: 'textToImage',
      });
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `百炼 图像异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'textToImage', upstream: err },
      );
    }
  }

  /**
   * 文生视频(wanx)
   */
  async textToVideo(
    provider: ApiProvider,
    params: { prompt: string; model?: string; size?: string; duration?: number; pollIntervalMs?: number; timeoutMs?: number },
  ): Promise<{ videoUrl: string; taskId: string; model: string }> {
    if (!params?.prompt) {
      throw new ApiProviderError('prompt 必填', { provider: provider.provider, action: 'textToVideo' });
    }
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const baseUrl = (cfg.baseUrl ?? AliyunBailianAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = params.model ?? 'wanx2.1-t2v-turbo';

    try {
      const submitRes = await fetch(`${baseUrl}/api/v1/services/aigc/video-generation/video-synthesis`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model,
          input: { prompt: params.prompt },
          parameters: {
            size: params.size ?? '1280*720',
            duration: params.duration ?? 5,
          },
        }),
      });
      const submitData: any = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok || !submitData?.output?.task_id) {
        throw new ApiProviderError(`百炼 视频提交失败: ${submitData?.message ?? submitRes.status}`, {
          provider: provider.provider,
          action: 'textToVideo',
          upstream: submitData,
        });
      }
      const taskId = submitData.output.task_id;
      const pollInterval = params.pollIntervalMs ?? 3000;
      const timeout = params.timeoutMs ?? 300000; // 视频更长
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollInterval));
        const queryRes = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const queryData: any = await queryRes.json().catch(() => ({}));
        const status = queryData?.output?.task_status;
        if (status === 'SUCCEEDED') {
          const url = queryData?.output?.video_url;
          return { videoUrl: url, taskId, model };
        }
        if (status === 'FAILED' || status === 'CANCELED') {
          throw new ApiProviderError(`百炼 视频任务失败: ${status} ${queryData?.output?.message ?? ''}`, {
            provider: provider.provider,
            action: 'textToVideo',
            upstream: queryData,
          });
        }
      }
      throw new ApiProviderError('百炼 视频任务超时', {
        provider: provider.provider,
        action: 'textToVideo',
      });
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `百炼 视频异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'textToVideo', upstream: err },
      );
    }
  }

  /**
   * 语音合成(cosyvoice / sambert)
   * 同步端点,直接返回音频二进制
   */
  async textToSpeech(
    provider: ApiProvider,
    params: { text: string; voice?: string; model?: string; format?: 'wav' | 'mp3' | 'pcm' },
  ): Promise<{ audioBase64: string; contentType: string; model: string }> {
    if (!params?.text) {
      throw new ApiProviderError('text 必填', { provider: provider.provider, action: 'textToSpeech' });
    }
    const cfg = (provider.config as any) ?? {};
    const creds = (provider.credentials as any) ?? {};

    const apiKey = decrypt(creds.apiKey, this.encryptionKey);
    const baseUrl = (cfg.baseUrl ?? AliyunBailianAdapter.DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = params.model ?? 'cosyvoice-v1';
    const format = params.format ?? 'wav';

    try {
      const res = await fetch(`${baseUrl}/api/v1/services/aigc/text2voice/voice`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: { text: params.text, voice: params.voice ?? 'longxiaochun' },
          parameters: { format },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ApiProviderError(`百炼 语音失败: HTTP ${res.status} ${text.slice(0, 200)}`, {
          provider: provider.provider,
          action: 'textToSpeech',
        });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        audioBase64: buf.toString('base64'),
        contentType: format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        model,
      };
    } catch (err) {
      if (err instanceof ApiProviderError) throw err;
      throw new ApiProviderError(
        `百炼 语音异常: ${err instanceof Error ? err.message : String(err)}`,
        { provider: provider.provider, action: 'textToSpeech', upstream: err },
      );
    }
  }
}
