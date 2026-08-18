import {
  AiProviderAdapter,
  AdapterContext,
  GenerateRequest,
  GenerateResult,
} from './adapter.interface';
import { applyParamMapping } from './adapter.factory';
import { createAbortController, isUserCancelled } from './abort-utils';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * OpenAI 适配器 - P3.3
 * 支持:
 *   - image: dall-e-3 / gpt-image-1 (Responses API)
 *   - text:  gpt-4o / gpt-4o-mini (Chat Completions)
 *   - audio: tts-1 / tts-1-hd (Speech API)
 *   - video: 暂未支持(抛 BadRequest)
 */
export class OpenAiAdapter implements AiProviderAdapter {
  async generate(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    switch (req.kind) {
      case 'image':
        return this.generateImage(req, ctx);
      case 'text':
        return this.generateText(req, ctx);
      case 'audio':
        return this.generateAudio(req, ctx);
      case 'video':
        throw badRequest(ErrorCode.BAD_REQUEST, 'OpenAI video generation is not supported yet');
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `Unsupported generation type: ${req.kind}`);
    }
  }

  /** DALL-E 3 图像生成 */
  private async generateImage(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const url = `${ctx.baseUrl.replace(/\/$/, '')}/images/generations`;
    // 支持三种尺寸输入：
    // 1. size 直接提供（自定义模式）如 "2048x2048"
    // 2. resolution + aspectRatio（预设模式）
    // 3. 只有 resolution（预设模式+auto宽高比）
    let size = req.params.size as string | undefined;
    const resolution = req.params.resolution as string | undefined;
    const aspectRatio = req.params.aspectRatio as string | undefined;

    if (!size) {
      if (resolution) {
        const resLower = resolution.toLowerCase();
        // OpenAI 常用尺寸映射
        const resMap: Record<string, number> = {
          '1k': 1024, '1024': 1024,
          '2k': 1792, '1792': 1792,
        };
        const longEdge = resMap[resLower] || 1024;
        if (aspectRatio && aspectRatio !== 'auto') {
          const [w, h] = aspectRatio.split(':').map(Number);
          const ratio = w / h;
          if (ratio >= 1) {
            size = `${longEdge}x${Math.round(longEdge / ratio)}`;
          } else {
            size = `${Math.round(longEdge * ratio)}x${longEdge}`;
          }
        } else {
          // auto 或无宽高比时用正方形
          size = `${longEdge}x${longEdge}`;
        }
      }
      if (!size) {
        size = '1024x1024';
      }
    }

    // ─── 构造中间参数（前端 key + 计算后的 size + 默认值） ───
    const intermediateParams: Record<string, any> = {
      ...req.params,
      size,
      n: req.params.n ?? 1,
      quality: req.params.quality ?? 'standard',
      response_format: req.params.response_format ?? 'b64_json',
    };
    delete intermediateParams.referenceImages;

    // ─── 应用 paramMapping（前端 key → API key + value 映射） ───
    const mapped = applyParamMapping(intermediateParams, req.template);

    // ─── 构造请求体 ───
    const body: Record<string, any> = {
      model: req.model,
      prompt: req.prompt,
      ...mapped,
    };
    const json = await this.postJson(url, body, ctx);
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('OpenAI 响应缺失 b64_json');
    }
    const buffer = Buffer.from(b64, 'base64');
    const [w, h] = size.split('x').map((n) => Number(n));
    return {
      kind: 'image',
      buffer,
      mimeType: 'image/png',
      ext: 'png',
      width: w,
      height: h,
    };
  }

  /** Chat Completions 文本生成 */
  private async generateText(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const url = `${ctx.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: req.model,
      messages: [{ role: 'user', content: req.prompt }],
      max_tokens: (req.params.maxTokens as number) ?? 8192,
      temperature: (req.params.temperature as number) ?? 0.7,
    };
    const json = await this.postJson(url, body, ctx);
    const text = json?.choices?.[0]?.message?.content;
    if (!text) {
      // 记录完整响应结构辅助调试
      const preview = JSON.stringify(json).slice(0, 500);
      throw new Error(
        `OpenAI 响应缺失 choices[0].message.content (响应预览: ${preview})`,
      );
    }
    return {
      kind: 'text',
      text,
      costTokens: (json?.usage?.total_tokens as number) ?? undefined,
      inputTokens: (json?.usage?.prompt_tokens as number) ?? undefined,
      outputTokens: (json?.usage?.completion_tokens as number) ?? undefined,
    };
  }

  /** TTS 音频生成 */
  private async generateAudio(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const url = `${ctx.baseUrl.replace(/\/$/, '')}/audio/speech`;
    const body = {
      model: req.model,
      input: req.prompt,
      voice: (req.params.voice as string) ?? 'alloy',
      response_format: (req.params.audioFormat as string) ?? 'mp3',
    };
    const fmt = body.response_format;
    const buffer = await this.postBinary(url, body, ctx);
    return {
      kind: 'audio',
      buffer,
      mimeType: fmt === 'mp3' ? 'audio/mpeg' : `audio/${fmt}`,
      ext: fmt,
    };
  }

  /** POST JSON 并解析 JSON 响应 */
  protected async postJson(
    url: string,
    body: unknown,
    ctx: AdapterContext,
  ): Promise<any> {
    const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return await res.json();
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

  /** POST JSON 并返回二进制 Buffer */
  protected async postBinary(
    url: string,
    body: unknown,
    ctx: AdapterContext,
  ): Promise<Buffer> {
    const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
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
