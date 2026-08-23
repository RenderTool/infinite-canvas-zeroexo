/**
 * ProxyProvider - AI Provider 的后端代理实现(P3.4 + P3.5)
 *
 * 通过后端 /api/ai/generate 调用 AI 服务,所有 API Key 在后端加密存储。
 * 产物自动落 Asset,本 provider 负责拉取产物并构造节点视图所需的返回类型。
 *
 * 解耦: 不直接依赖 app 层的 apiFetch,通过 ProxyFetch 函数注入。
 * app 层负责注入带 JWT 鉴权 + 401 自动刷新的 fetcher。
 *
 * P3.5 增强:
 * - 超时控制(image 60s / text 30s / video 10min / audio 60s)
 * - 自动重试(网络错误 3 次指数退避 / 5xx 2 次 / 429 读 Retry-After)
 * - 错误分类(抛出 AiError,含 errorType 供前端展示错误图标)
 */

import type { AIProvider } from './provider.js';
import type {
  AudioGenerationRequest,
  GeneratedAudio,
  GeneratedImage,
  GeneratedVideo,
  GenerationInputRef,
  ImageEditRequest,
  ImageGenerationRequest,
  TextGenerationRequest,
  VideoGenerationRequest,
} from './types.js';
import { blobToDataUrl } from './lib/http-utils.js';
import { readVideoMetaFromBlob } from './lib/video-api.js';
import { readAudioMetaFromBlob } from './lib/audio-api.js';
import {
  AiError,
  classifyError,
  isRetryable,
  maxRetryCount,
  retryDelayMs,
  timeoutMsByKind,
} from './ai-error.js';

/** 后端代理调用函数(由 app 层注入 apiFetch) */
export type ProxyFetch = <T>(
  path: string,
  options?: RequestInit,
) => Promise<T>;

/** 语言获取函数(由 app 层注入,返回当前用户语言 zh/en/ja) */
export type LocaleGetter = () => string;

/** JWT token 获取函数(由 app 层注入,供私有资源下载携带 Authorization) */
export type TokenGetter = () => string | null;

/** 后端 /api/ai/generate 响应 */
interface GenerateResponse {
  generationId: string;
  assetId?: string;
  kind: 'text' | 'image' | 'video' | 'audio';
  text?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  costTokens?: number;
  costMs?: number;
  url?: string;
}

/** /api/ai/generations/:id 响应(轮询异步任务时使用) */
interface GenerationRecord {
  id: string;
  status: string;
  kind: string;
  errorMessage?: string | null;
  resultAssetId?: string | null;
  params?: Record<string, any>;
}

/** /api/assets/:id/download 响应 */
interface DownloadUrlResponse {
  url: string;
}

/** 通用 GET → Blob(可选携带 JWT:后端私有资源 /api/storage/get 需 Authorization) */
async function fetchBlob(
  url: string,
  signal?: AbortSignal,
  token?: string | null,
): Promise<Blob> {
  const res = await fetch(url, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new AiError(
      classifyError(null, res.status),
      `下载失败: HTTP ${res.status}`,
      { statusCode: res.status },
    );
  }
  return await res.blob();
}

/** sleep 工具(可被 AbortSignal 中断) */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiError('TIMEOUT', '已取消', { cause: signal.reason }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AiError('TIMEOUT', '已取消', { cause: signal.reason }));
      },
      { once: true },
    );
  });
}

/**
 * 从错误对象提取 HTTP 状态码
 * app 层的 ApiError 含 status 字段;原生 fetch 错误无 status
 */
function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; statusCode?: number };
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
  }
  return undefined;
}

/** 从错误对象提取 Retry-After(秒),仅 429 时有意义 */
function extractRetryAfterSec(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as { retryAfter?: string; headers?: Headers };
    if (typeof e.retryAfter === 'string') {
      const n = Number(e.retryAfter);
      if (!Number.isNaN(n)) return n;
    }
    if (e.headers && typeof e.headers.get === 'function') {
      const ra = e.headers.get('retry-after');
      if (ra) {
        const n = Number(ra);
        if (!Number.isNaN(n)) return n;
      }
    }
  }
  return undefined;
}

/** 渠道模型编码分隔符(与 ai-config 的 encodeChannelModel 契约一致) */
const CHANNEL_MODEL_SEPARATOR = '::';

/**
 * 解析 "channelId::model" 编码值 → providerId + 真实模型名。
 * 非编码格式(不含分隔符)视为纯模型名,providerId 为空(后端用默认渠道)。
 * 不解码会把整串当模型名发给默认渠道,导致 404/模型不存在。
 */
function splitChannelModel(model: string): { providerId?: string; model: string } {
  const index = model.indexOf(CHANNEL_MODEL_SEPARATOR);
  if (index < 0) return { model };
  const providerId = model.slice(0, index);
  const realModel = model.slice(index + CHANNEL_MODEL_SEPARATOR.length);
  return {
    providerId: providerId || undefined,
    model: realModel || model,
  };
}

export class ProxyProvider implements AIProvider {
  id = 'ai-provider' as const;

  constructor(
    private readonly fetcher: ProxyFetch,
    private readonly localeGetter?: LocaleGetter,
    private readonly tokenGetter?: TokenGetter,
  ) {}

  install(): void {
    // 无状态,无需 install 钩子
  }
  activate(): void {
    // nothing
  }
  deactivate(): void {
    // nothing
  }
  uninstall(): void {
    // nothing
  }

  /**
   * 检查是否已配置 - 始终返回 true
   * 真正的渠道状态由 AI 设置页查询 /api/ai/channels,
   * 若用户未配置渠道,后端 generate 接口会抛"未配置 AI 渠道"错误,前端展示给用户。
   */
  isConfigured(): boolean {
    return true;
  }

  /** 文生图 */
  async generateImage(req: ImageGenerationRequest): Promise<GeneratedImage[]> {
    const { providerId, model } = splitChannelModel(req.model);
    const result = await this.callGenerateWithRetry(
      {
        kind: 'image',
        prompt: req.prompt,
        model,
        providerId,
        inputs: req.inputs,
        params: {
          size: req.size,
          quality: req.quality,
          count: req.count,
        },
      },
      req.signal,
    );
    const completed = await this.waitForTask(result.generationId, 'image', req.signal);
    const downloadUrl = completed.url ?? (await this.getAssetDownloadUrl(completed.assetId ?? '', req.signal));
    const blob = await fetchBlob(downloadUrl, req.signal, this.tokenGetter?.());
    const dataUrl = await blobToDataUrl(blob);
    return [
      {
        dataUrl,
        width: completed.width ?? 0,
        height: completed.height ?? 0,
        mimeType: completed.mimeType ?? 'image/png',
        bytes: blob.size,
        generationId: result.generationId,
      },
    ];
  }

  /** 图生图/图片编辑(后端目前不支持,直接抛错) */
  async editImage(_req: ImageEditRequest): Promise<GeneratedImage[]> {
    throw new AiError('VALIDATION_ERROR', '图生图/图片编辑暂未支持,请使用文生图');
  }

  /** 文本生成 */
  async generateText(
    req: TextGenerationRequest,
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    const decoded = splitChannelModel(req.model);
    console.log('[ProxyProvider.generateText] request:', { model: decoded.model, providerId: decoded.providerId ?? req.providerId, promptLength: req.prompt.length });
    const result = await this.callGenerateWithRetry(
      {
        kind: 'text',
        prompt: req.prompt,
        model: decoded.model,
        providerId: decoded.providerId ?? req.providerId,
        params: req.params ?? {},
      },
      req.signal,
    );
    const text = result.text ?? '';
    console.log('[ProxyProvider.generateText] response:', { textLength: text.length, textPreview: text.substring(0, 200) });
    // 非流式响应，将完整文本通过 onDelta 回调传递一次，确保进度回调能触发
    if (onDelta && text) {
      onDelta(text);
    }
    return text;
  }

  /** 视频生成 */
  async generateVideo(req: VideoGenerationRequest): Promise<GeneratedVideo> {
    const { providerId, model } = splitChannelModel(req.model);
    const result = await this.callGenerateWithRetry(
      {
        kind: 'video',
        prompt: req.prompt,
        model,
        providerId,
        inputs: req.inputs,
        params: {
          size: req.size,
          seconds: req.seconds,
          vquality: req.vquality,
          generateAudio: req.generateAudio,
          watermark: req.watermark,
        },
      },
      req.signal,
    );
    const completed = await this.waitForTask(result.generationId, 'video', req.signal);
    const downloadUrl = completed.url ?? (await this.getAssetDownloadUrl(completed.assetId ?? '', req.signal));
    const blob = await fetchBlob(downloadUrl, req.signal, this.tokenGetter?.());
    const video = await readVideoMetaFromBlob(blob);
    return { ...video, generationId: result.generationId };
  }

  /** 音频生成 */
  async generateAudio(req: AudioGenerationRequest): Promise<GeneratedAudio> {
    const { providerId, model } = splitChannelModel(req.model);
    const result = await this.callGenerateWithRetry(
      {
        kind: 'audio',
        prompt: req.prompt,
        model,
        providerId,
        inputs: req.inputs,
        params: {
          voice: req.voice,
          audioFormat: req.format,
          audioSpeed: req.speed,
          audioInstructions: req.instructions,
        },
      },
      req.signal,
    );
    const completed = await this.waitForTask(result.generationId, 'audio', req.signal);
    const downloadUrl = completed.url ?? (await this.getAssetDownloadUrl(completed.assetId ?? '', req.signal));
    const blob = await fetchBlob(downloadUrl, req.signal, this.tokenGetter?.());
    const audio = await readAudioMetaFromBlob(blob);
    return { ...audio, generationId: result.generationId };
  }

  /**
   * 调用 POST /api/ai/generate(带超时 + 重试 + 错误分类)
   *
   * 超时: 根据 kind 决定(image 60s / text 30s / video 10min / audio 60s)
   * 重试: NETWORK_ERROR 3 次 / PROVIDER_ERROR 2 次 / RATE_LIMIT 1 次(读 Retry-After)
   * 错误: 抛出 AiError,含 errorType 字段供前端展示
   *
   * @param payload 请求体
   * @param externalSignal 外部传入的 AbortSignal(用户主动取消)
   */
  private async callGenerateWithRetry(
    payload: {
      kind: 'text' | 'image' | 'video' | 'audio';
      prompt: string;
      model: string;
      providerId?: string;
      /** 生成引用快照(后端写 params._inputs,供一键同款) */
      inputs?: GenerationInputRef[];
      params?: Record<string, unknown>;
      locale?: string;
    },
    externalSignal?: AbortSignal,
  ): Promise<GenerateResponse> {
    // 透传用户语言,供后端控制文本生成输出语言
    payload.locale = this.localeGetter?.() ?? 'zh';
    const timeoutMs = timeoutMsByKind(payload.kind);
    // 内部超时控制器(与外部 signal 合并)
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(
      () => timeoutController.abort(new Error('AI_REQUEST_TIMEOUT')),
      timeoutMs,
    );

    // 合并外部 signal 与内部超时 signal
    const mergedSignal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutController.signal])
      : timeoutController.signal;

    // 外部取消时,清理超时
    externalSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeoutTimer);
      },
      { once: true },
    );

    try {
      let attempt = 0;

      // 首次调用 + 重试循环
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const result = await this.fetcher<GenerateResponse>('/ai/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: mergedSignal,
          });
          return result;
        } catch (err) {
          // 外部取消优先
          if (externalSignal?.aborted) {
            throw new AiError('TIMEOUT', '已取消', { cause: err });
          }
          // 超时
          if (timeoutController.signal.aborted) {
            throw new AiError(
              'TIMEOUT',
              `请求超时(${timeoutMs / 1000}s),请稍后重试`,
              { cause: err },
            );
          }

          const status = extractStatus(err);
          const errorType = classifyError(err, status);

          // 不可重试:直接抛出
          if (!isRetryable(errorType)) {
            const message = err instanceof Error ? err.message : String(err);
            throw new AiError(errorType, message, {
              statusCode: status,
              cause: err,
            });
          }

          // 已达最大重试次数:抛出
          const maxRetry = maxRetryCount(errorType);
          if (attempt >= maxRetry) {
            const message = err instanceof Error ? err.message : String(err);
            throw new AiError(errorType, message, {
              statusCode: status,
              cause: err,
            });
          }

          // 计算重试延迟
          let delay: number;
          if (errorType === 'RATE_LIMIT') {
            const retryAfterSec = extractRetryAfterSec(err) ?? 5;
            delay = retryAfterSec * 1000;
          } else {
            delay = retryDelayMs(errorType, attempt);
          }

          await sleep(delay, externalSignal);
          attempt++;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  /**
   * 轮询等待异步生成任务完成(非 text 任务 POST /ai/generate 仅返回 generationId，
   * 由后端 Worker 异步处理，完成后需轮询 GET /ai/generations/:id 获取产物 URL)
   *
   * @param generationId 任务 ID
   * @param kind 生成类型(用于超时判断)
   * @param signal 外部取消信号
   * @returns 含产物 url/assetId/元信息的响应(供下载)
   */
  private async waitForTask(
    generationId: string,
    kind: 'image' | 'video' | 'audio',
    signal?: AbortSignal,
  ): Promise<GenerateResponse> {
    const timeoutMs = timeoutMsByKind(kind);
    const startedAt = Date.now();
    while (true) {
      if (signal?.aborted) throw new AiError('TIMEOUT', '已取消');
      const record = await this.fetcher<GenerationRecord>(
        `/ai/generations/${generationId}`,
        { method: 'GET', signal },
      );
      if (record.status === 'success') {
        const p = record.params ?? {};
        return {
          generationId,
          kind,
          url: (p._resultUrl as string | undefined) ?? undefined,
          assetId: record.resultAssetId ?? undefined,
          mimeType: (p._resultMime as string | undefined) ?? undefined,
          width: (p._resultWidth as number | undefined) ?? undefined,
          height: (p._resultHeight as number | undefined) ?? undefined,
        };
      }
      if (record.status === 'failed') {
        throw new AiError('PROVIDER_ERROR', record.errorMessage || '生成失败，请重试');
      }
      if (record.status === 'cancelled') {
        throw new AiError('TIMEOUT', '任务已取消');
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new AiError('TIMEOUT', `生成超时(${timeoutMs / 1000}s)，请稍后重试`);
      }
      await sleep(1000, signal);
    }
  }

  /** 获取 Asset 下载 URL(GET /api/assets/:id/download) */
  private async getAssetDownloadUrl(
    assetId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.fetcher<DownloadUrlResponse>(
      `/assets/${assetId}/download`,
      { method: 'GET', signal },
    );
    return result.url;
  }
}
