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
 * 校验图片 URL 列表，防止 SSRF 攻击
 * - 只允许 http/https 协议
 * - 禁止内网地址（127.0.0.1, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, localhost 等）
 * @throws Error 如果 URL 非法
 */
function validateImageUrls(urls: string[]): void {
  for (const url of urls) {
    // 跳过 data: 协议(base64 内嵌图片)
    if (url.startsWith('data:')) continue;

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

function assertNotInternalUrl(url: string): void {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
  ) {
    throw new Error(`禁止访问内网地址: ${hostname}`);
  }
}

/**
 * 火山引擎(豆包)适配器 - P3.3
 * 火山方舟 Ark API 兼容 OpenAI 协议,直接复用 OpenAI 风格调用。
 * 支持:
 *   - text:  doubao-pro / doubao-lite (chat/completions)
 *   - image: doubao-seedream-3-0-t2i (images/generations)
 *   - audio: doubao-tts (OpenAI Speech 协议兼容)
 *   - video: 暂未支持(异步任务,需轮询)
 * 端点: https://ark.cn-beijing.volces.com/api/v3
 * 鉴权: Authorization: Bearer
 */
export class VolcengineAdapter implements AiProviderAdapter {
  /**
   * 火山引擎 API 官方尺寸映射表（方式 1：指定分辨率档位）
   * 来源：https://www.volcengine.com/docs/6791/1397048
   * 仅覆盖 API 文档中定义的 1K/2K 分辨率 + 标准宽高比组合。
   */
  private static readonly SIZE_MAP: Record<string, Record<string, { width: number; height: number }>> = {
    '1k': {
      '1:1': { width: 1024, height: 1024 },
      '4:3': { width: 1152, height: 864 },
      '3:4': { width: 864, height: 1152 },
      '16:9': { width: 1424, height: 800 },
      '9:16': { width: 800, height: 1424 },
      '3:2': { width: 1248, height: 832 },
      '2:3': { width: 832, height: 1248 },
      '21:9': { width: 1568, height: 672 },
    },
    '2k': {
      '1:1': { width: 2048, height: 2048 },
      '4:3': { width: 2368, height: 1776 },
      '3:4': { width: 1776, height: 2368 },
      '16:9': { width: 2816, height: 1584 },
      '9:16': { width: 1584, height: 2816 },
      '3:2': { width: 2496, height: 1664 },
      '2:3': { width: 1664, height: 2496 },
      '21:9': { width: 3136, height: 1344 },
    },
  };
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
        return this.generateAudio(req, ctx);
      case 'video':
        return this.generateVideo(req, ctx);
      default:
        throw badRequest(ErrorCode.BAD_REQUEST, `Unsupported generation type: ${req.kind}`);
    }
  }

  /** 豆包文本生成(OpenAI Chat 协议) */
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
        `火山引擎响应缺失 choices[0].message.content (响应预览: ${preview})`,
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

  /** 豆包图像生成(火山 Ark API) */
  private async generateImage(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const url = `${ctx.baseUrl.replace(/\/$/, '')}/images/generations`;

    // ─── 计算 size ───
    // 防御性处理：size 可能是 {width, height} 对象（前端联动逻辑遗留），转为 "WxH" 字符串
    const rawSize = req.params.size;
    let size: string | undefined;
    if (typeof rawSize === 'string') {
      size = rawSize;
    } else if (rawSize && typeof rawSize === 'object' && 'width' in rawSize && 'height' in rawSize) {
      size = `${rawSize.width}x${rawSize.height}`;
    }
    const resolution = req.params.resolution as string | undefined;
    const aspectRatio = req.params.aspectRatio as string | undefined;

    // 预设模式：优先使用 resolution + aspectRatio 计算火山预设 size（如 "2k"/"3k"/"4k"）
    // 仅当 size 为空时才走预设计算，避免具体像素值覆盖预设值
    if (!size && resolution) {
      const res = resolution.toLowerCase();
      // 优先使用火山预设 size 值（如 "2k", "4k"）,宽高比 1:1 时直接用预设
      if (aspectRatio === '1:1' || !aspectRatio) {
        if (res === '2k' || res === '2048') size = '2k';
        else if (res === '3k') size = '3k';
        else if (res === '4k' || res === '4096') size = '4k';
      }

      // 非 1:1 宽高比: 计算具体像素(硬编码映射表已满足所有 seedream 模型的最小像素要求)
      if (!size && aspectRatio) {
        // AUTO 模式：无需特定宽高比时使用 1:1 作为默认比
        const effectiveAspect = aspectRatio === 'auto' ? '1:1' : aspectRatio;
        const dims = this.calculateDimensions(resolution, effectiveAspect, req.template?.bounds);
        if (dims) {
          size = `${dims.width}x${dims.height}`;
        }
      }
    }
    if (!size) {
      size = '2k'; // 默认 2k 预设,满足火山最小像素要求
    }

    // ─── 防御性校验：确保 WxH 格式的 size 满足 minTotalPixels ───
    // 即使前端因约束未传入而发送了过小的尺寸（如 1024x576），后端也能自动放大
    if (size.includes('x')) {
      const [wStr, hStr] = size.split('x');
      const w = parseInt(wStr, 10);
      const h = parseInt(hStr, 10);
      if (!isNaN(w) && !isNaN(h)) {
        const minPixels = req.template?.bounds?.minTotalPixels ?? 921600;
        if (w * h < minPixels) {
          const scale = Math.sqrt(minPixels / (w * h));
          size = `${Math.round(w * scale)}x${Math.round(h * scale)}`;
        }
      }
    }

    // ─── 构造中间参数（前端 key + 计算后的 size） ───
    // 参考图单独处理（需要 base64 转换），从中间参数中移除
    const intermediateParams: Record<string, any> = {
      ...req.params,
      size,
      response_format: req.params.response_format ?? 'url',
    };
    delete intermediateParams.referenceImages;

    // ─── 应用 paramMapping（前端 key → API key + value 映射） ───
    // UI 参数（sizeMode/resolution/aspectRatio）自动被排除
    const mapped = applyParamMapping(intermediateParams, req.template);

    // Seedream 等模型不支持 output_format，移除该参数避免 400 错误
    delete mapped.output_format;

    // ─── 构造请求体 ───
    const body: Record<string, any> = {
      model: req.model,
      prompt: req.prompt,
      ...mapped,
      stream: false,
    };

    // ─── 参考图特殊处理（base64 转换 + paramMapping 映射） ───
    const refImages = req.params.referenceImages as string[] | undefined;
    if (refImages && refImages.length > 0) {
      // SSRF 防护：校验所有 URL 只允许 http/https 协议，禁止内网地址
      validateImageUrls(refImages);
      const refApiField = req.template?.paramMapping?.referenceImages ?? 'image';

      const base64Images: string[] = [];
      for (const imageUrl of refImages) {
        const b64 = await this.resolveImageToBase64(imageUrl, ctx);
        base64Images.push(b64);
      }
      body[refApiField] = base64Images.map((b) => `data:image/png;base64,${b}`);
    }

    const json = await this.postJson(url, body, ctx);

    // 解析尺寸（优先从 API 响应读取真实值）
    let width: number | undefined;
    let height: number | undefined;
    const item = json?.data?.[0];
    if (item?.width && item?.height) {
      width = Number(item.width);
      height = Number(item.height);
    } else if (size.includes('x')) {
      // 自定义尺寸: 从请求的 size 解析
      const [w, h] = size.split('x').map((n) => Number(n));
      width = w || undefined;
      height = h || undefined;
    } else if (aspectRatio && resolution) {
      // 预设尺寸 + 非1:1宽高比: 按分辨率和宽高比计算
      const dims = this.calculateDimensions(resolution, aspectRatio, req.template?.bounds);
      if (dims) {
        width = dims.width;
        height = dims.height;
      }
    } else {
      // 预设尺寸 + 1:1: 按档位估算
      const sizeLower = size.toLowerCase();
      if (sizeLower === '2k') { width = 2048; height = 2048; }
      else if (sizeLower === '3k') { width = 3072; height = 3072; }
      else if (sizeLower === '4k') { width = 4096; height = 4096; }
    }

    // 尝试从 url 获取
    const imageUrl = item?.url;
    if (imageUrl) {
      const buffer = await this.fetchBinary(String(imageUrl), ctx);
      return {
        kind: 'image',
        buffer,
        mimeType: 'image/png',
        ext: 'png',
        width,
        height,
      };
    }

    // 降级: b64_json
    const b64 = item?.b64_json;
    if (b64) {
      const buffer = Buffer.from(b64, 'base64');
      return {
        kind: 'image',
        buffer,
        mimeType: 'image/png',
        ext: 'png',
        width,
        height,
      };
    }

    throw new Error('火山引擎响应中未找到图像数据');
  }

  /** 根据分辨率档位和宽高比计算像素尺寸 */
  private calculateDimensions(
    resolution: string,
    aspectRatio: string,
    bounds?: { maxEdgeLength?: number; minTotalPixels?: number; maxTotalPixels?: number },
  ): { width: number; height: number } | null {
    const res = resolution.toLowerCase();

    // 1. 查火山引擎官方尺寸映射表（1K/2K + 标准宽高比）
    const resMap = VolcengineAdapter.SIZE_MAP[res];
    if (resMap?.[aspectRatio]) {
      return { ...resMap[aspectRatio] };
    }

    // 2. 表中无匹配：使用数学计算（如 3K/4K 或非标准宽高比）
    const maxEdge = bounds?.maxEdgeLength ?? 4096;
    const minPixels = bounds?.minTotalPixels ?? 921600;
    const maxPixels = bounds?.maxTotalPixels;

    // 根据分辨率确定长边目标
    let targetLong: number;
    if (res === '4k' || res === '4096') {
      targetLong = Math.min(4096, maxEdge);
    } else if (res === '3k') {
      targetLong = Math.min(3072, maxEdge);
    } else if (res === '2k' || res === '2048') {
      targetLong = Math.min(2048, maxEdge);
    } else {
      targetLong = Math.max(1024, Math.round(maxEdge / 4));
    }

    // 解析宽高比为数值比
    const parts = aspectRatio.split(':').map(Number);
    if (parts.length !== 2 || parts[0] <= 0 || parts[1] <= 0) return null;
    const ratio = parts[0] / parts[1];

    let w: number, h: number;
    if (ratio >= 1) {
      w = targetLong;
      h = Math.round(targetLong / ratio);
    } else {
      h = targetLong;
      w = Math.round(targetLong * ratio);
    }

    // 确保像素数 >= minPixels
    const totalPixels = w * h;
    if (totalPixels < minPixels) {
      const scale = Math.sqrt(minPixels / totalPixels);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      if (w > maxEdge || h > maxEdge) {
        const limitEdge = Math.min(maxEdge, Math.max(w, h));
        let newW: number, newH: number;
        if (ratio >= 1) {
          newW = limitEdge;
          newH = Math.round(limitEdge / ratio);
        } else {
          newH = limitEdge;
          newW = Math.round(limitEdge * ratio);
        }
        // 若回退后仍低于 minPixels，说明 maxEdge 限制导致无法同时满足约束，保留溢出值
        if (newW * newH >= minPixels) {
          w = newW;
          h = newH;
        }
        // 否则保持放大后的 w/h（虽然超出 maxEdge，但能保证 minPixels 满足）
      }
    }

    // 确保像素数不超过 maxTotalPixels
    if (maxPixels && w * h > maxPixels) {
      const scale = Math.sqrt(maxPixels / (w * h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    return { width: w, height: h };
  }

  /** 豆包 TTS(OpenAI Speech 协议) */
  private async generateAudio(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const url = `${ctx.baseUrl.replace(/\/$/, '')}/audio/speech`;
    const fmt = (req.params.audioFormat as string) ?? 'mp3';
    const body = {
      model: req.model,
      input: req.prompt,
      voice: (req.params.voice as string) ?? 'BV001_streaming',
      response_format: fmt,
      ...(req.params.audioSpeed
        ? { speed: Number(req.params.audioSpeed) }
        : {}),
    };
    const buffer = await this.postBinary(url, body, ctx);
    return {
      kind: 'audio',
      buffer,
      mimeType: fmt === 'mp3' ? 'audio/mpeg' : `audio/${fmt}`,
      ext: fmt,
    };
  }

  /** 视频生成(异步任务:提交 → 轮询 → 下载) - Seedance 2.0 风格 */
  private async generateVideo(
    req: GenerateRequest,
    ctx: AdapterContext,
  ): Promise<GenerateResult> {
    const baseUrl = ctx.baseUrl.replace(/\/$/, '');
    const submitUrl = `${baseUrl}/contents/generations/tasks`;

    // ─── 1. 构建 content 数组 ──────────────────────────────────
    const content: any[] = [{ type: 'text', text: req.prompt }];

    // 参考图(base64 data-url)
    const refImages = req.params.referenceImages as string[] | undefined;
    if (refImages?.length) {
      for (const img of refImages) {
        content.push({ type: 'image_url', image_url: { url: img }, role: 'reference_image' });
      }
    }
    // 参考视频
    const refVideos = req.params.referenceVideos as string[] | undefined;
    if (refVideos?.length) {
      for (const vid of refVideos) {
        content.push({ type: 'video_url', video_url: { url: vid }, role: 'reference_video' });
      }
    }
    // 参考音频
    const refAudio = req.params.referenceAudio as string[] | undefined;
    if (refAudio?.length) {
      for (const aud of refAudio) {
        content.push({ type: 'audio_url', audio_url: { url: aud }, role: 'reference_audio' });
      }
    }

    // ─── 2. 映射参数并构建请求体 ────────────────────────────────
    const intermediateParams: Record<string, any> = { ...req.params };
    delete intermediateParams.referenceImages;
    delete intermediateParams.referenceVideos;
    delete intermediateParams.referenceAudio;
    delete intermediateParams.mode;           // UI 参数
    delete intermediateParams.maxReferenceImages;
    delete intermediateParams.maxReferenceVideos;
    delete intermediateParams.maxReferenceAudios;
    delete intermediateParams.referenceImagesEnabled;
    delete intermediateParams.referenceVideosEnabled;
    delete intermediateParams.referenceAudiosEnabled;

    const mapped = applyParamMapping(intermediateParams, req.template);

    const body: Record<string, any> = {
      model: req.model,
      content,
      ...mapped,
    };

    // ─── 3. 提交生成任务 ────────────────────────────────────────
    const createResult = await this.postJson(submitUrl, body, ctx);
    const taskId = createResult?.id;
    if (!taskId) {
      throw new Error('火山引擎视频生成任务创建失败：未返回任务 ID');
    }

    // ─── 4. 轮询任务状态 ──────────────────────────────────────
    const taskUrl = `${submitUrl}/${taskId}`;
    const pollStart = Date.now();
    const maxPollMs = 10 * 60 * 1000; // 最长 10 分钟
    const pollIntervalMs = 5000;       // 每 5 秒查询一次

    while (Date.now() - pollStart < maxPollMs) {
      if (ctx.signal?.aborted) {
        throw new Error('用户取消');
      }

      // 每次轮询使用单独的 30 秒超时，不占用 ctx.timeoutMs
      const taskResult = await this.getJson(taskUrl, 30_000, ctx.apiKey, ctx.signal);
      const status = taskResult?.status;

      if (status === 'succeeded') {
        const videoUrl = taskResult?.content?.video_url;
        if (!videoUrl) {
          throw new Error('火山引擎视频生成成功但未返回视频 URL');
        }
        // 下载视频
        const buffer = await this.fetchBinary(videoUrl, ctx);
        return {
          kind: 'video',
          buffer,
          mimeType: 'video/mp4',
          ext: 'mp4',
        };
      }

      if (status === 'failed') {
        throw new Error(`火山引擎视频生成失败: ${taskResult?.error || '未知错误'}`);
      }

      // 仍在处理中，等待后继续轮询
      await this.delay(pollIntervalMs);
    }

    throw new Error('火山引擎视频生成超时（超过 10 分钟）');
  }

  private async getJson(
    url: string,
    timeoutMs: number,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<any> {
    const { controller, cleanup } = createAbortController(timeoutMs, signal);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`请求超时(超过 ${timeoutMs / 1000} 秒),请稍后重试`);
      }
      throw err;
    } finally {
      cleanup();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        headers: {
          Authorization: `Bearer ${ctx.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // 404: 模型不存在或未开通 — 火山引擎每个模型需在控制台单独开通
        if (res.status === 404) {
          const modelId = (body as any)?.model as string | undefined;
          throw new Error(
            `模型 ${modelId ?? ''} 不存在或未开通(HTTP 404)。火山引擎的图像/视频模型需在方舟控制台「开通模型」后才能调用,旧版本模型可能已下线。原始错误: ${text.slice(0, 200)}`,
          );
        }
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

  private async postBinary(
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
        if (res.status === 404) {
          const modelId = (body as any)?.model as string | undefined;
          throw new Error(
            `模型 ${modelId ?? ''} 不存在或未开通(HTTP 404)。火山引擎的图像/视频模型需在方舟控制台「开通模型」后才能调用,旧版本模型可能已下线。原始错误: ${text.slice(0, 200)}`,
          );
        }
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

  private async fetchBinary(imageUrl: string, ctx: AdapterContext): Promise<Buffer> {
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
      assertNotInternalUrl(imageUrl);
      buffer = await this.fetchBinary(imageUrl, ctx);
    }

    return buffer.toString('base64');
  }

  private extractStorageKey(url: string): string | null {
    const match = url.match(/[/?&]key=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return null;
  }
}
