import {
  AiProviderAdapter,
  AdapterContext,
  GenerateRequest,
  GenerateResult,
} from './adapter.interface';
import { createAbortController, isUserCancelled } from './abort-utils';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * Stability AI 适配器 - P3.3
 * 支持:
 *   - image: stable-image-generate / stable-image-core (multipart/form-data)
 *   - video: 暂未支持(异步任务,需轮询,后续扩展)
 *   - audio: 暂未支持
 *   - text:  暂未支持
 * 端点: https://api.stability.ai/v2beta/stable-image/generate/{engine}
 * 鉴权: Authorization: Bearer + Accept: application/json(返回 base64)
 */
export class StabilityAdapter implements AiProviderAdapter {
  async generate(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    switch (req.kind) {
      case 'image':
        return this.generateImage(req, ctx);
      case 'video':
        throw badRequest(ErrorCode.BAD_REQUEST, 'Stability video generation is not supported yet (requires async polling)');
      case 'audio':
        throw badRequest(ErrorCode.BAD_REQUEST, 'Stability audio generation is not supported yet');
      case 'text':
        throw badRequest(ErrorCode.BAD_REQUEST, 'Stability text generation is not supported yet');
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `Unsupported generation type: ${req.kind}`);
    }
  }

  /** Stable Image 生成(multipart + base64 响应) */
  private async generateImage(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const engine = req.model || 'stable-image-generate';
    const url = `${ctx.baseUrl.replace(/\/$/, '')}/generate/${engine}`;

    const form = new FormData();
    form.append('prompt', req.prompt);
    form.append('output_format', (req.params.format as string) ?? 'png');
    if (req.params.negativePrompt) {
      form.append('negative_prompt', req.params.negativePrompt as string);
    } else if (req.negativePrompt) {
      form.append('negative_prompt', req.negativePrompt);
    }
    if (req.params.aspectRatio) {
      form.append('aspect_ratio', req.params.aspectRatio as string);
    }
    if (req.params.seed) {
      form.append('seed', String(req.params.seed));
    }
    form.append('accept', 'application/json');

    const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.apiKey}`,
          Accept: 'application/json',
        },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        image?: string;
        finish_reason?: string;
      };
      const b64 = json.image;
      if (!b64) {
        throw new Error('Stability 响应缺失 image 字段');
      }
      const buffer = Buffer.from(b64, 'base64');
      const fmt = (req.params.format as string) ?? 'png';
      return {
        kind: 'image',
        buffer,
        mimeType: fmt === 'jpeg' ? 'image/jpeg' : `image/${fmt}`,
        ext: fmt,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          isUserCancelled(err, ctx.signal)
            ? '用户取消'
            : `请求超时(超过 ${ctx.timeoutMs / 1000} 秒),请稍后重试`,
        );
      }
      throw err;
    } finally {
      cleanup();
    }
  }
}
