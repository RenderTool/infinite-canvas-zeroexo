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
      // DashScope 原生接口模板(如 qwen-image):不支持 OpenAI compatible 模式,
      // 走 input.messages + parameters 契约(征集 #83 验收修复)
      if ((req.template as Record<string, any>)?.request?.bodyStyle === 'dashscope') {
        return this.generateImageDashscope(req, ctx);
      }
      return this.generateImageCustom(req, ctx);
    }
    return super.generate(req, ctx);
  }

  /**
   * DashScope 原生文生图/图生图(千问 Qwen-Image 系列)
   * - 请求: POST { model, input: { messages: [{ role, content: [{ text } / { image }] }] }, parameters: {...} }
   * - 响应: output.choices[0].message.content[0].image(24h 有效 URL)
   * - 参数映射: paramMapping(size/watermark/prompt_extend/negative_prompt 等)写入 parameters
   */
  private async generateImageDashscope(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const tpl = req.template as Record<string, any> | undefined;
    const endpoint = tpl?.endpoint || '/services/aigc/multimodal-generation/generation';
    const baseUrl = (() => {
      const b = ctx.baseUrl.endsWith('/') ? ctx.baseUrl.slice(0, -1) : ctx.baseUrl;
      // DashScope 原生接口在 api/v1 下;渠道 baseUrl 多为 compatible-mode/v1(OpenAI 兼容),
      // 此处自动归一为 api/v1(征集 #83:兼容百炼渠道共用配置)
      return b.replace(/\/compatible-mode(?:\/v\d+)?$/i, '/api/v1');
    })();
    const url = `${baseUrl}${endpoint}`;

    // 参考图(图生图):base64 data URL 写入 messages.content
    const refImages = req.params.referenceImages;
    const refEntries: Array<Record<string, string>> = [];
    if (Array.isArray(refImages) && refImages.length > 0) {
      for (const imageUrl of refImages as string[]) {
        const buf = await this.resolveImageBuffer(imageUrl, ctx);
        refEntries.push({ image: `data:${sniffImageMime(buf)};base64,${buf.toString('base64')}` });
      }
    }

    // 参数映射:前端 key → DashScope parameters(size 归一为 "宽*高" 字符串)
    const mapped = applyParamMapping(req.params, req.template);
    delete mapped.referenceImages;
    if (typeof mapped.size === 'string') {
      mapped.size = mapped.size.replace(/[x×]/i, '*');
    } else if (mapped.size && typeof mapped.size === 'object') {
      const s = mapped.size as { width?: number; height?: number };
      if (s.width && s.height) mapped.size = `${s.width}*${s.height}`;
      else delete mapped.size;
    }

    const body = {
      model: req.model,
      input: {
        messages: [
          { role: 'user', content: [...refEntries, { text: req.prompt }] },
        ],
      },
      parameters: mapped,
    };

    const json = await this.postJson(url, body, ctx);

    // 响应提取: output.choices[0].message.content[].image
    const content = json?.output?.choices?.[0]?.message?.content;
    const imageItem = Array.isArray(content) ? content.find((c: Record<string, unknown>) => !!c?.image) : undefined;
    const imageUrl = imageItem?.image as string | undefined;
    if (!imageUrl) {
      const errInfo = json?.message ?? json?.code ?? '';
      const preview = JSON.stringify(json).slice(0, 500);
      throw new Error(
        errInfo
          ? `DashScope 返回错误: ${errInfo}`
          : `DashScope 响应缺失 output.choices[0].message.content[].image (响应预览: ${preview})`,
      );
    }

    const buffer = await this.fetchBinary(imageUrl, ctx);

    // 尺寸:优先 usage.output_width/height,其次解析 size 参数(“宽*高”)
    let width = Number(json?.usage?.output_width) || 0;
    let height = Number(json?.usage?.output_height) || 0;
    if (!width || !height) {
      const m = /^(\d+)\s*[*x×]\s*(\d+)$/i.exec(String(mapped.size ?? ''));
      if (m) {
        width = Number(m[1]);
        height = Number(m[2]);
      } else {
        width = 1328;
        height = 1328;
      }
    }

    return {
      kind: 'image',
      buffer,
      mimeType: 'image/png',
      ext: 'png',
      width,
      height,
      costTokens: (json?.usage?.total_tokens as number) ?? undefined,
      inputTokens: (json?.usage?.input_tokens as number) ?? undefined,
      outputTokens: (json?.usage?.output_tokens as number) ?? undefined,
    };
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
