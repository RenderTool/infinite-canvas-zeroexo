import {
  AiProviderAdapter,
  AdapterContext,
  GenerateRequest,
  GenerateResult,
} from './adapter.interface';
import { applyParamMapping } from './adapter.factory';
import { executeVideoByTemplate } from './video-executor';
import { createAbortController, isUserCancelled } from './abort-utils';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';
import { sniffImageMime } from './image-utils';
import sharp from 'sharp';

/**
 * 校验图片 URL 列表，防止 SSRF 攻击
 * - 只允许 http/https 协议
 * - 禁止内网地址（127.0.0.1, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, localhost 等）
 * @throws Error 如果 URL 非法
 */
function validateImageUrls(urls: string[]): void {
  for (const url of urls) {
    // 跳过 data: 协议(base64 内嵌图片)与相对路径(本地存储 /api/storage/get?key=...,由 extractStorageKey 读本地文件,无 SSRF 风险)
    if (url.startsWith('data:') || url.startsWith('/')) continue;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`无效的图片 URL: ${url}`);
    }

    // 只允许 http / https 协议
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`不支持的协议: ${parsed.protocol}，只允许 http/https`);
    }
  }
}

/**
 * OpenAI 适配器 - P3.3
 * 支持:
 *   - image: dall-e-3 / gpt-image-1 (Responses API)
 *   - text:  gpt-4o / gpt-4o-mini (Chat Completions)
 *   - audio: tts-1 / tts-1-hd (Speech API)
 *   - video: 模板含 DSL 时按模板协议执行(提交→轮询),否则 OpenAI 兼容兜底
 *            (POST /videos/generations,同步解析 data[0].url / b64_json)
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
        return this.generateVideo(req, ctx);
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `Unsupported generation type: ${req.kind}`);
    }
  }

  /** 视频生成 - 通用执行器(模板 DSL 驱动,无 DSL 时 OpenAI 兼容兜底) */
  private async generateVideo(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    return executeVideoByTemplate(req, ctx, req.template);
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

    // ─── 参考图 buffer 提前解析 ───
    // AUTO 宽高比计算需要真实宽高(sharp 读元数据),base64 提交复用同一批 buffer,避免二次读取(2026-08-25)
    const refImages = req.params.referenceImages as string[] | undefined;
    const refBuffers: Buffer[] = [];
    if (refImages && refImages.length > 0) {
      validateImageUrls(refImages);
      for (const imageUrl of refImages) {
        refBuffers.push(await this.resolveImageBuffer(imageUrl, ctx));
      }
    }

    if (!size) {
      if (resolution) {
        const resLower = resolution.toLowerCase();
        // OpenAI 常用尺寸映射
        const resMap: Record<string, number> = {
          '1k': 1024, '1024': 1024,
          '2k': 1792, '1792': 1792,
        };
        const longEdge = resMap[resLower] || 1024;
        if (aspectRatio === 'auto' && refBuffers.length > 0) {
          // AUTO + 参考图:按参考图比例 + 分辨率档位计算(用户拍板:auto=跟随输入图片比例输出,2026-08-25)
          const meta = await sharp(refBuffers[0]).metadata();
          if (meta.width && meta.height) {
            const ratio = meta.width / meta.height;
            if (ratio >= 1) {
              size = `${longEdge}x${Math.round(longEdge / ratio)}`;
            } else {
              size = `${Math.round(longEdge * ratio)}x${longEdge}`;
            }
          }
        }
        if (aspectRatio && aspectRatio !== 'auto') {
          const [w, h] = aspectRatio.split(':').map(Number);
          const ratio = w / h;
          if (ratio >= 1) {
            size = `${longEdge}x${Math.round(longEdge / ratio)}`;
          } else {
            size = `${Math.round(longEdge * ratio)}x${longEdge}`;
          }
        } else if (!size) {
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
    // ─── 参考图特殊处理（base64 转换 + paramMapping 映射,对齐 CustomAdapter 图生图语义） ───
    if (refBuffers.length > 0) {
      const refApiField = req.template?.paramMapping?.referenceImages ?? 'image';
      // 按字节魔数探测真实 MIME,避免硬编码 png 导致 JPEG 图被误标(2026-08-25 seedream-4.5 实测)
      body[refApiField] = refBuffers.map(
        (b) => `data:${sniffImageMime(b)};base64,${b.toString('base64')}`,
      );
    }

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

  /** 拉取远程图片为 Buffer(参考图 URL 为外部地址时使用) */
  protected async fetchBinary(
    imageUrl: string,
    ctx: AdapterContext,
  ): Promise<Buffer> {
    const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
    try {
      const res = await fetch(imageUrl, { signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`拉取图片失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
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

  /** 将图片 URL 解析为 Buffer（data-url 直解 / 本地存储读取 / 远程拉取） */
  protected async resolveImageBuffer(imageUrl: string, ctx: AdapterContext): Promise<Buffer> {
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (!match) {
        throw new Error('无效的 base64 图片格式');
      }
      return Buffer.from(match[1], 'base64');
    }

    let buffer: Buffer;
    const storageKey = this.extractStorageKey(imageUrl);
    if (storageKey) {
      if (!ctx.readFile) {
        throw new Error('缺少读取本地文件的能力');
      }
      const fileBuffer = await ctx.readFile(storageKey);
      if (!fileBuffer) {
        throw new Error(`参考图文件不存在: ${storageKey}`);
      }
      buffer = fileBuffer;
    } else {
      buffer = await this.fetchBinary(imageUrl, ctx);
    }

    return buffer;
  }

  /** 从 URL 中提取 storageKey */
  protected extractStorageKey(url: string): string | null {
    const match = url.match(/[/?&]key=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }
}
