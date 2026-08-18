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
 * Gemini 适配器 - P3.3
 * 支持:
 *   - text:  gemini-2.0-flash-exp (generateContent)
 *   - image: imagen-3.0-generate / gemini-2.0-flash-exp-image (predict)
 *   - audio: 暂未支持(抛 BadRequest)
 *   - video: 暂未支持(抛 BadRequest)
 * 鉴权方式: URL 查询参数 ?key=API_KEY
 */
export class GeminiAdapter implements AiProviderAdapter {
  async generate(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    switch (req.kind) {
      case 'text':
        return this.generateText(req, ctx);
      case 'image':
        return this.generateImage(req, ctx);
      case 'audio':
        throw badRequest(ErrorCode.BAD_REQUEST, 'Gemini audio generation is not supported yet');
      case 'video':
        throw badRequest(ErrorCode.BAD_REQUEST, 'Gemini video generation is not supported yet');
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `Unsupported generation type: ${req.kind}`);
    }
  }

  /** generateContent 文本生成 */
  private async generateText(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const baseUrl = ctx.baseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/v1beta/models/${req.model}:generateContent?key=${ctx.apiKey}`;
    const body = {
      contents: [{ parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: (req.params.temperature as number) ?? 0.7,
        maxOutputTokens: (req.params.maxTokens as number) ?? 2048,
      },
    };
    const json = await this.postJson(url, body, ctx);
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini 响应缺失 candidates[0].content.parts[0].text');
    }
    return {
      kind: 'text',
      text,
      costTokens: (json?.usageMetadata?.totalTokenCount as number) ?? undefined,
      inputTokens: (json?.usageMetadata?.promptTokenCount as number) ?? undefined,
      outputTokens: (json?.usageMetadata?.candidatesTokenCount as number) ?? undefined,
    };
  }

  /** 图像生成：根据模型 ID 自动路由 */
  private async generateImage(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const baseUrl = ctx.baseUrl.replace(/\/$/, '');
    const isImagen = req.model.toLowerCase().includes('imagen');

    if (isImagen) {
      return this.generateImageImagen(req, ctx, baseUrl);
    }
    return this.generateImageNanoBanana(req, ctx, baseUrl);
  }

  /** Imagen 图像生成(v1beta models/:model:predict) */
  private async generateImageImagen(
    req: GenerateRequest,
    ctx: AdapterContext,
    baseUrl: string,
  ): Promise<GenerateResult> {
    const url = `${baseUrl}/v1beta/models/${req.model}:predict?key=${ctx.apiKey}`;
    const sampleCount = Number(req.params.count ?? 1);
    const body = {
      instances: [{ prompt: req.prompt }],
      parameters: {
        sampleCount,
        ...(req.params.aspectRatio
          ? { aspectRatio: req.params.aspectRatio }
          : {}),
        ...(req.negativePrompt
          ? { negativePrompt: req.negativePrompt }
          : {}),
      },
    };
    const json = await this.postJson(url, body, ctx);
    const predictions = json?.predictions ?? [];
    if (predictions.length === 0) {
      throw new Error('Gemini Imagen 响应缺失 predictions');
    }
    const b64 = predictions[0]?.bytesBase64Encoded;
    if (!b64) {
      throw new Error('Gemini Imagen 响应缺失 bytesBase64Encoded');
    }
    const buffer = Buffer.from(b64, 'base64');
    return {
      kind: 'image',
      buffer,
      mimeType: 'image/png',
      ext: 'png',
    };
  }

  /** Nano Banana 图像生成(v1beta models/:model:generateContent) */
  private async generateImageNanoBanana(
    req: GenerateRequest,
    ctx: AdapterContext,
    baseUrl: string,
  ): Promise<GenerateResult> {
    const url = `${baseUrl}/v1beta/models/${req.model}:generateContent?key=${ctx.apiKey}`;

    // 构建 generationConfig
    const generationConfig: Record<string, any> = {
      responseModalities: ['Text', 'Image'],
    };

    // 处理尺寸参数
    const size = req.params.size as string | undefined; // 自定义模式
    const resolution = req.params.resolution as string | undefined; // 预设模式
    const aspectRatio = req.params.aspectRatio as string | undefined;

    if (size && size.includes('x')) {
      // 自定义模式：传入 WxH（Imagen 兼容，Nano Banana 可能不支持）
      generationConfig.response_format = {
        image: { imageSize: '1K' }, // 默认 1K 兜底
      };
    } else {
      // 预设模式
      const imageConfig: Record<string, string> = {};
      if (resolution) {
        // 将分辨率转为 Nano Banana 格式（如 "2k" → "2K"）
        const resUpper = resolution.toUpperCase().replace('K', 'K');
        imageConfig.image_size = resUpper.includes('K')
          ? resUpper
          : `${resUpper}K`;
      }
      if (aspectRatio && aspectRatio !== 'auto') {
        imageConfig.aspect_ratio = aspectRatio;
      }
      if (Object.keys(imageConfig).length > 0) {
        generationConfig.response_format = { image: imageConfig };
      }
    }

    // 参考图处理
    const parts: Array<Record<string, any>> = [{ text: req.prompt }];
    const refImages = req.params.referenceImages as string[] | undefined;
    if (refImages && refImages.length > 0) {
      for (const img of refImages) {
        if (img.startsWith('data:')) {
          const mimeMatch = img.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (mimeMatch) {
            parts.push({
              inlineData: {
                mimeType: mimeMatch[1],
                data: mimeMatch[2],
              },
            });
          }
        }
      }
    }

    const body = {
      contents: [{ parts }],
      generationConfig,
    };

    const json = await this.postJson(url, body, ctx);
    const parts_response = json?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts_response.find((p: any) => p.inlineData);
    if (!imagePart) {
      throw new Error(
        'Gemini Nano Banana 响应缺失 inlineData 图像数据',
      );
    }
    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    return {
      kind: 'image',
      buffer,
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      ext: 'png',
    };
  }

  private async postJson(
    url: string,
    body: unknown,
    ctx: AdapterContext,
  ): Promise<any> {
    const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
}
