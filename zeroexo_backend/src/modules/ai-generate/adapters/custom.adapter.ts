import { OpenAiAdapter } from './openai.adapter';
import {
  AiProviderAdapter,
  AdapterContext,
  GenerateRequest,
  GenerateResult,
} from './adapter.interface';
import { buildApiUrl } from '../../api-providers/adapters/build-api-url';
import { applyParamMapping } from './adapter.factory';
import { createAbortController, isUserCancelled } from './abort-utils';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/**
 * 中转 API(Custom)适配器 - P3.3
 * 适用于所有兼容 OpenAI 协议的中转 API 服务商(如 oneapi / newapi / OpenRouter / Grsai 等)。
 *
 * 与 OpenAiAdapter 的差异:
 * - 图像生成响应兼容 url 与 b64_json 两种格式(中转服务常仅返回 url)
 * - 支持图生图: 当传入 referenceImages 时,作为 image 数组发送(中转服务通用字段)
 * - size 参数兼容像素值(1024x1024)与比例值(16:9)
 *
 * 仅支持 image/text/audio,视频生成抛 BadRequest。
 */
export class CustomAdapter extends OpenAiAdapter implements AiProviderAdapter {
  async generate(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    if (req.kind === 'video') {
      throw badRequest(ErrorCode.BAD_REQUEST, 'Relay API video generation is not supported yet');
    }
    if (req.kind === 'image') {
      return this.generateImageCustom(req, ctx);
    }
    return super.generate(req, ctx);
  }

  /**
   * 中转 API 图像生成
   * - 请求 /images/generations(OpenAI 兼容)
   * - 响应可为 data[0].url(需远程拉取)或 data[0].b64_json(直接解码)
   * - 图生图:将参考图解析为 base64 数组,通过 JSON 请求发送
   */
  private async generateImageCustom(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const apiBase = buildApiUrl(ctx.baseUrl, 'custom');
    const url = `${apiBase}/images/generations`;

    const explicitSize = req.params.size as string | undefined;
    const aspectRatio = req.params.aspectRatio as string | undefined;
    const size = explicitSize || aspectRatio || '1024x1024';

    // ─── 构造中间参数（前端 key + 计算后的 size） ───
    const intermediateParams: Record<string, any> = {
      ...req.params,
      size,
      n: req.params.n ?? 1,
      response_format: req.params.response_format ?? 'url',
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

    // ─── 参考图特殊处理（base64 转换 + paramMapping 映射） ───
    const refImages = req.params.referenceImages;
    if (Array.isArray(refImages) && refImages.length > 0) {
      const refApiField = req.template?.paramMapping?.referenceImages ?? 'image';
      const base64Images: string[] = [];
      for (const imageUrl of refImages as string[]) {
        const b64 = await this.resolveImageToBase64(imageUrl, ctx);
        base64Images.push(b64);
      }
      body[refApiField] = base64Images.map((b) => `data:image/png;base64,${b}`);
    }

    const json = await this.postJson(url, body, ctx);

    const item = json?.data?.[0];
    if (!item) {
      throw new Error('中转 API 响应缺失 data[0]');
    }

    let buffer: Buffer;
    if (item.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      buffer = await this.fetchBinary(String(item.url), ctx);
    } else {
      throw new Error('中转 API 响应缺失 b64_json 与 url');
    }

    let width = 1024;
    let height = 1024;
    const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
    if (m) {
      width = Number(m[1]);
      height = Number(m[2]);
    }

    return {
      kind: 'image',
      buffer,
      mimeType: 'image/png',
      ext: 'png',
      width,
      height,
      costTokens: (json?.usage?.total_tokens as number) ?? undefined,
      inputTokens: (json?.usage?.prompt_tokens as number) ?? undefined,
      outputTokens: (json?.usage?.completion_tokens as number) ?? undefined,
    };
  }

  /**
   * 将图像 URL 解析为 base64 字符串
   * - 本地存储 URL: 提取 storageKey 读取文件
   * - 外部 URL: 远程拉取
   * - 已是 base64 格式: 去除 data URI 前缀后返回
   */
  private async resolveImageToBase64(imageUrl: string, ctx: AdapterContext): Promise<string> {
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (!match) {
        throw new Error('无效的 base64 图片格式');
      }
      return match[1];
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

    return buffer.toString('base64');
  }

  /** 从 URL 中提取 storageKey */
  private extractStorageKey(url: string): string | null {
    const match = url.match(/[/?&]key=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }

  /** 拉取远程图片为 Buffer(中转服务返回 url 时使用) */
  private async fetchBinary(
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
}
