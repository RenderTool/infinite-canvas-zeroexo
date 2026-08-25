import { OpenAiAdapter } from './openai.adapter';
import {
  AiProviderAdapter,
  AdapterContext,
  GenerateRequest,
  GenerateResult,
} from './adapter.interface';
import { buildApiUrl } from '../../api-providers/adapters/build-api-url';
import { applyParamMapping } from './adapter.factory';
import { executeVideoByTemplate } from './video-executor';
import { sniffImageMime } from './image-utils';
import sharp from 'sharp';

/**
 * 中转 API(Custom)适配器 - P3.3
 * 适用于所有兼容 OpenAI 协议的中转 API 服务商(如 oneapi / newapi / OpenRouter / Grsai 等)。
 *
 * 与 OpenAiAdapter 的差异:
 * - 图像生成响应兼容 url 与 b64_json 两种格式(中转服务常仅返回 url)
 * - 支持图生图: 当传入 referenceImages 时,作为 image 数组发送(中转服务通用字段)
 * - size 参数兼容像素值(1024x1024)与比例值(16:9)
 *
 * 支持 image/text/audio/video;视频生成按模板 DSL 执行,
 * 无 DSL 时按 OpenAI 兼容兜底(POST /videos/generations)。
 */
export class CustomAdapter extends OpenAiAdapter implements AiProviderAdapter {
  async generate(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    if (req.kind === 'video') {
      return executeVideoByTemplate(req, ctx, req.template);
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

    // ─── 参考图 buffer 提前解析 ───
    // AUTO 宽高比计算需要真实宽高(sharp 读元数据),base64 提交复用同一批 buffer,避免二次读取(2026-08-25)
    const refImages = req.params.referenceImages;
    const refBuffers: Buffer[] = [];
    if (Array.isArray(refImages) && refImages.length > 0) {
      for (const imageUrl of refImages as string[]) {
        refBuffers.push(await this.resolveImageBuffer(imageUrl, ctx));
      }
    }

    const explicitSize = req.params.size as string | undefined;
    const aspectRatio = req.params.aspectRatio as string | undefined;
    // auto 不是合法 size 值:显式 size 优先,其次固定宽高比,auto 回退 1:1(2026-08-25 修复)
    let size = explicitSize || (aspectRatio && aspectRatio !== 'auto' ? aspectRatio : undefined) || '1024x1024';
    // AUTO + 参考图:按参考图比例 + 分辨率档位计算(用户拍板:auto=跟随输入图片比例输出)
    if (!explicitSize && aspectRatio === 'auto' && refBuffers.length > 0) {
      const meta = await sharp(refBuffers[0]).metadata();
      if (meta.width && meta.height) {
        const res = String(req.params.resolution ?? '').toLowerCase();
        const resMap: Record<string, number> = { '1k': 1024, '1024': 1024, '2k': 1792, '1792': 1792 };
        const longEdge = resMap[res] || 1024;
        const ratio = meta.width / meta.height;
        size = ratio >= 1
          ? `${longEdge}x${Math.round(longEdge / ratio)}`
          : `${Math.round(longEdge * ratio)}x${longEdge}`;
      }
    }

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
    if (refBuffers.length > 0) {
      const refApiField = req.template?.paramMapping?.referenceImages ?? 'image';
      // 按字节魔数探测真实 MIME,避免硬编码 png 导致 JPEG 图被误标(2026-08-25 seedream-4.5 实测)
      body[refApiField] = refBuffers.map(
        (b) => `data:${sniffImageMime(b)};base64,${b.toString('base64')}`,
      );
    }

    const json = await this.postJson(url, body, ctx);

    const item = json?.data?.[0];
    if (!item) {
      // 提取网关错误信息(new-api 等中转常返回 { error: { message } } 或 { code, message })
      const errInfo =
        json?.error?.message ??
        json?.error?.msg ??
        json?.message ??
        json?.msg ??
        '';
      const preview = JSON.stringify(json).slice(0, 500);
      throw new Error(
        errInfo
          ? `中转 API 返回错误: ${errInfo}`
          : `中转 API 响应缺失 data[0] (响应预览: ${preview})`,
      );
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

  // resolveImageBuffer / extractStorageKey / fetchBinary 复用父类 OpenAiAdapter 的 protected 实现
  // (2026-08-25:父类补齐图生图支持后删除子类重复实现,消除 TS2415 同名 private 冲突)
}
