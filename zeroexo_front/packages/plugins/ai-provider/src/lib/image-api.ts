/**
 * 图片生成/编辑 API
 *
 * 支持 OpenAI 与 Gemini 两种调用格式:
 * - OpenAI: POST /v1/images/generations (JSON) / POST /v1/images/edits (FormData)
 * - Gemini: POST /v1beta/models/{model}:generateContent (inlineData)
 *
 * 质量尺寸映射:16 倍数 / 最长边 3840 / 比例 ≤3:1 / 像素 655360-8294400。
 */

import axios from "axios";

import type {
  GeneratedImage,
  ImageEditRequest,
  ImageGenerationRequest,
  ResolvedConfig,
} from "../types.js";
import {
  aiApiUrl,
  aiHeaders,
  dataUrlToFile,
  geminiApiUrl,
  geminiHeaders,
  imageToDataUrl,
  readAxiosError,
} from "./http-utils.js";

// ===== 质量与尺寸映射 =====

const QUALITY_BASE: Record<string, number> = {
  low: 1024,
  medium: 2048,
  high: 2880,
  standard: 1024,
  hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
  "1k": "low",
  "2k": "medium",
  "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";

/** 将 quality 别名归一化为 low/medium/high/standard/hd */
function normalizeQuality(quality: string): string | undefined {
  const value = quality.trim().toLowerCase();
  const normalized = QUALITY_ALIASES[value] || value;
  return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** 根据 quality + ratio 计算像素尺寸,如 "3840x2160" */
function resolveSize(quality: string | undefined, ratio: string): string {
  const parsedRatio = parseImageRatio(ratio);
  const basePixels = quality ? QUALITY_BASE[quality] : undefined;
  const isLandscape = parsedRatio.width >= parsedRatio.height;
  const longRatio = isLandscape
    ? parsedRatio.width / parsedRatio.height
    : parsedRatio.height / parsedRatio.width;
  let longSide: number;
  let shortSide: number;

  if (basePixels) {
    const targetPixels = basePixels * basePixels;
    const longSideRaw = Math.sqrt(targetPixels * longRatio);
    longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
  } else {
    shortSide = DEFAULT_IMAGE_SHORT_SIDE;
    longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
  }

  const width = isLandscape ? longSide : shortSide;
  const height = isLandscape ? shortSide : longSide;
  validateImageSize(width, height);
  return `${width}x${height}`;
}

/** 解析比例字符串,如 "9:16" */
function parseImageRatio(value: string): { width: number; height: number } {
  const parts = value.split(":");
  if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    throw new Error("图像比例必须是正数，例如 9:16");
  if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO)
    throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
  return { width: w, height: h };
}

/** 解析像素尺寸字符串,如 "1024x1024" */
function parseImageDimensions(value: string): { width: number; height: number } | null {
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** 校验像素尺寸:正整数 / 16 倍数 / 最长边 3840 / 比例 3:1 / 像素范围 */
function validateImageSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
    throw new Error("图像尺寸必须是正整数，例如 1024x1024");
  if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0)
    throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
  if (Math.max(width, height) > IMAGE_MAX_EDGE)
    throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
  if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO)
    throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
  const pixels = width * height;
  if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS)
    throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

/** 解析请求尺寸:支持 auto / 9:16 / 1024x1024 */
function resolveRequestSize(quality: string | undefined, size: string): string | undefined {
  const value = size.trim();
  if (!value || value.toLowerCase() === "auto") return undefined;
  const dimensions = parseImageDimensions(value);
  if (dimensions) {
    validateImageSize(dimensions.width, dimensions.height);
    return `${dimensions.width}x${dimensions.height}`;
  }
  if (value.includes(":")) return resolveSize(quality, value);
  throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

// ===== 图片元数据读取 =====

/** 读取 dataUrl 的 width/height/mimeType(通过 Image 元素,3 秒超时兜底) */
function readImageMeta(
  dataUrl: string,
): Promise<{ width: number; height: number; mimeType: string }> {
  return new Promise((resolve) => {
    const image = new Image();
    const done = () =>
      resolve({
        width: image.naturalWidth || 1024,
        height: image.naturalHeight || 1024,
        mimeType: dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png",
      });
    image.onload = done;
    image.onerror = done;
    setTimeout(done, 3000);
    image.src = dataUrl;
  });
}

/** 计算 dataUrl 的字节大小(从 base64 长度推算) */
function getDataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.split(",", 2)[1];
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** 将 dataUrl 或 URL 转为 GeneratedImage(读取 width/height/bytes/mimeType) */
async function toGeneratedImage(dataUrlOrUrl: string): Promise<GeneratedImage> {
  const dataUrl = dataUrlOrUrl.startsWith("data:")
    ? dataUrlOrUrl
    : await imageToDataUrl(dataUrlOrUrl);
  const meta = await readImageMeta(dataUrl);
  return {
    dataUrl,
    width: meta.width,
    height: meta.height,
    mimeType: meta.mimeType,
    bytes: getDataUrlByteSize(dataUrl),
  };
}

// ===== API 响应类型 =====

type ImageApiResponse = {
  data?: Array<Record<string, unknown>>;
  error?: { message?: string };
  code?: number;
  msg?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; mimeType?: string; data?: string };
  fileData?: { mimeType?: string; fileUri?: string };
};

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
};

// ===== 响应解析 =====

/** 从 OpenAI 图片响应项提取 dataUrl 或 URL */
function resolveImageDataUrl(item: Record<string, unknown>): string | null {
  if (typeof item.b64_json === "string" && item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  if (typeof item.url === "string" && item.url) {
    return item.url;
  }
  return null;
}

/** 解析 OpenAI 图片响应 → dataUrl/URL 列表 */
function parseImagePayload(payload: ImageApiResponse): string[] {
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.msg || "请求失败");
  }
  const images =
    payload.data
      ?.map(resolveImageDataUrl)
      .filter((value): value is string => Boolean(value)) || [];
  if (images.length === 0) throw new Error("接口没有返回图片");
  return images;
}

/** 校验 Gemini 响应(错误/拒绝) */
function validateGeminiPayload(payload: GeminiPayload): void {
  if (payload.error?.message) throw new Error(payload.error.message);
  if (payload.promptFeedback?.blockReason)
    throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

/** 解析 Gemini 图片响应 → dataUrl/URL 列表 */
function parseGeminiImagePayload(payload: GeminiPayload): string[] {
  validateGeminiPayload(payload);
  const images =
    payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => {
        const inlineData = part.inlineData
          ? part.inlineData
          : part.inline_data
            ? {
                mimeType: part.inline_data.mimeType || part.inline_data.mime_type,
                data: part.inline_data.data,
              }
            : undefined;
        if (inlineData?.data)
          return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
        return part.fileData?.fileUri || null;
      })
      .filter((value): value is string => Boolean(value)) || [];
  if (!images.length) throw new Error("Gemini 接口没有返回图片");
  return images;
}

// ===== Gemini 辅助 =====

/** 将 dataUrl/URL 转为 GeminiPart(inlineData 或 fileData) */
function toGeminiImagePart(url: string): GeminiPart {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
  return { fileData: { fileUri: url, mimeType: "image/png" } };
}

// ===== 提示词辅助 =====

/** 拼接系统提示词(OpenAI 图片接口用 prompt 前置) */
function withSystemPrompt(config: ResolvedConfig, prompt: string): string {
  const systemPrompt = config.systemPrompt?.trim() || "";
  return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

/** 构建图片编辑参考图编号提示词 */
function buildImageReferencePromptText(prompt: string, referenceCount: number): string {
  const text = prompt.trim();
  if (!referenceCount) return text;
  const labels = Array.from({ length: referenceCount }, (_, index) => `图片${index + 1}`);
  return `参考图片编号：${labels.join("、")}。请按这些编号理解提示词中的图片引用。\n\n${text}`;
}

// ===== Gemini 图片请求 =====

/** 请求 Gemini 生成图片(并发 count 次,每次返回一张) */
async function requestGeminiImages(
  prompt: string,
  references: string[],
  count: number,
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const requests = Array.from({ length: count }, () =>
    requestGeminiImagesOnce(prompt, references, config, signal),
  );
  const results = await Promise.all(requests);
  return results.flat();
}

/** 单次 Gemini 图片生成请求 */
async function requestGeminiImagesOnce(
  prompt: string,
  references: string[],
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const parts: GeminiPart[] = [{ text: prompt }];
  for (const image of references) {
    parts.push(toGeminiImagePart(await imageToDataUrl(image)));
  }
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    ...(config.systemPrompt?.trim()
      ? { systemInstruction: { parts: [{ text: config.systemPrompt.trim() }] } }
      : {}),
  };
  try {
    const response = await axios.post<GeminiPayload>(
      geminiApiUrl(config, "generateContent"),
      body,
      { headers: geminiHeaders(config), signal },
    );
    const dataUrls = parseGeminiImagePayload(response.data);
    return await Promise.all(dataUrls.map(toGeneratedImage));
  } catch (error) {
    throw new Error(readAxiosError(error, "请求失败"));
  }
}

// ===== 主入口:图片生成 =====

/** 文生图(无参考图) */
export async function requestGeneration(
  req: ImageGenerationRequest,
  config: ResolvedConfig,
): Promise<GeneratedImage[]> {
  const n = Math.max(1, Math.min(15, Math.floor(Math.abs(req.count)) || 1));

  if (config.apiFormat === "gemini") {
    return requestGeminiImages(req.prompt, [], n, config, req.signal);
  }

  const quality = normalizeQuality(req.quality);
  const requestSize = resolveRequestSize(quality, req.size);
  try {
    const response = await axios.post<ImageApiResponse>(
      aiApiUrl(config, "/images/generations"),
      {
        model: config.model,
        prompt: withSystemPrompt(config, req.prompt),
        n,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        response_format: "b64_json",
        output_format: IMAGE_OUTPUT_FORMAT,
      },
      {
        headers: aiHeaders(config, "application/json"),
        signal: req.signal,
      },
    );
    const dataUrls = parseImagePayload(response.data);
    return await Promise.all(dataUrls.map(toGeneratedImage));
  } catch (error) {
    throw new Error(readAxiosError(error, "请求失败"));
  }
}

// ===== 主入口:图片编辑 =====

/** 图生图/图片编辑(有参考图) */
export async function requestEdit(
  req: ImageEditRequest,
  config: ResolvedConfig,
): Promise<GeneratedImage[]> {
  const n = Math.max(1, Math.min(15, Math.floor(Math.abs(req.count)) || 1));
  const requestPrompt = buildImageReferencePromptText(req.prompt, req.referenceImages.length);

  if (config.apiFormat === "gemini") {
    return requestGeminiImages(requestPrompt, req.referenceImages, n, config, req.signal);
  }

  const quality = normalizeQuality(req.quality);
  const requestSize = resolveRequestSize(quality, req.size);
  const formData = new FormData();
  formData.set("model", config.model);
  formData.set("prompt", withSystemPrompt(config, requestPrompt));
  formData.set("n", String(n));
  formData.set("response_format", "b64_json");
  formData.set("output_format", IMAGE_OUTPUT_FORMAT);
  if (quality) formData.set("quality", quality);
  if (requestSize) formData.set("size", requestSize);

  const files = await Promise.all(
    req.referenceImages.map(async (url) => dataUrlToFile(await imageToDataUrl(url))),
  );
  files.forEach((file) => formData.append("image", file));

  try {
    const response = await axios.post<ImageApiResponse>(
      aiApiUrl(config, "/images/edits"),
      formData,
      { headers: aiHeaders(config), signal: req.signal },
    );
    const dataUrls = parseImagePayload(response.data);
    return await Promise.all(dataUrls.map(toGeneratedImage));
  } catch (error) {
    throw new Error(readAxiosError(error, "请求失败"));
  }
}
