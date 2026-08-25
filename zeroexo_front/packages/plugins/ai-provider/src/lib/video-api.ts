/**
 * 视频生成 API + HTTP 短轮询
 *
 * - Seedance(火山方舟):POST /v1/contents/generations/tasks (JSON, content 数组)
 * - OpenAI:POST /v1/videos (FormData, prompt + seconds + size + input_reference[])
 * - 轮询 120 次:Seedance 5s / OpenAI 2.5s
 * - Seedance:GET /tasks/{id} → status=succeeded → video_url → fetch blob
 * - OpenAI:GET /videos/{id} → status=completed → GET /videos/{id}/content → blob
 */

import axios from "axios";

import type {
  GeneratedVideo,
  ReferenceAudio,
  ReferenceVideo,
  ResolvedConfig,
  VideoGenerationRequest,
} from "../types.js";
import {
  aiApiUrl,
  aiHeaders,
  blobToDataUrl,
  buildApiUrl,
  dataUrlToFile,
  delay,
  isPublicMediaUrl,
  readAxiosError,
} from "./http-utils.js";

// ===== Seedance 常量与辅助 =====

const SEEDANCE_REFERENCE_LIMITS = {
  images: 9,
  videos: 3,
  audios: 3,
} as const;

const seedanceRatioOptions = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
  "adaptive",
] as const;

/** 判断是否为 Seedance 模型(模型名含 seedance/doubao-seedance) */
function isSeedanceVideoModel(model: string): boolean {
  const value = model.toLowerCase();
  return value.includes("seedance") || value.includes("doubao-seedance");
}

/** 判断 baseUrl 是否为火山方舟 Agent Plan */
function isArkPlanBaseUrl(baseUrl: string): boolean {
  return baseUrl.toLowerCase().includes("/api/plan/v3");
}

/** 判断当前配置是否走 Seedance 流程 */
export function isSeedanceVideoConfig(config: ResolvedConfig): boolean {
  return isSeedanceVideoModel(config.model) || isArkPlanBaseUrl(config.baseUrl);
}

/** 归一化 Seedance 分辨率:low→480p,auto/high/medium→720p */
function normalizeSeedanceResolution(value: string, model: string): string {
  const normalized = normalizeResolutionToken(value);
  if (isSeedanceFastModel(model) && normalized === "1080p") return "720p";
  return ["480p", "720p", "1080p"].includes(normalized) ? normalized : "720p";
}

function normalizeResolutionToken(value: string): string {
  if (value === "low") return "480p";
  if (value === "auto" || value === "high" || value === "medium") return "720p";
  const resolution = String(value || "").replace(/p$/i, "") || "720";
  return `${resolution}p`;
}

function isSeedanceFastModel(model: string): boolean {
  return isSeedanceVideoModel(model) && model.toLowerCase().includes("fast");
}

/** 归一化 Seedance 时长:-1 表示自适应,否则 4-15 秒 */
function normalizeSeedanceDuration(seconds: number): number {
  if (seconds === -1) return -1;
  return Math.max(4, Math.min(15, Math.floor(seconds || 5)));
}

/** 归一化 Seedance 宽高比:支持 auto/adaptive/比例字符串/像素字符串 */
function normalizeSeedanceRatio(value: string): string {
  if (!value || value === "auto" || value === "adaptive") return "adaptive";
  if (seedanceRatioOptions.includes(value as (typeof seedanceRatioOptions)[number])) return value;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return "adaptive";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "adaptive";
  const ratio = width / height;
  const options: Array<[string, number]> = [
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
    ["21:9", 21 / 9],
  ];
  let best: [string, number] | undefined;
  for (const item of options) {
    if (!best || Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio)) best = item;
  }
  return best ? best[0] : "adaptive";
}

/** 构建 Seedance 参考素材编号提示词 */
function buildSeedancePromptText(
  prompt: string,
  imageCount: number,
  videoCount: number,
  audioCount: number,
): string {
  const labels = [
    ...Array.from({ length: imageCount }, (_, index) => `图片${index + 1}`),
    ...Array.from({ length: videoCount }, (_, index) => `视频${index + 1}`),
    ...Array.from({ length: audioCount }, (_, index) => `音频${index + 1}`),
  ];
  const text = prompt.trim();
  if (!labels.length) return text;
  return `参考素材编号：${labels.join("、")}。请按这些编号理解提示词中的图片、视频和音频引用。\n\n${text}`;
}

// ===== OpenAI 视频参数归一化 =====

function normalizeVideoSeconds(seconds: number): string {
  return String(Math.max(1, Math.min(20, Math.floor(seconds || 6))));
}

function normalizeVideoSize(value: string): string | null {
  if (value === "auto") return null;
  const size = value || "1280x720";
  if (/^\d+x\d+$/.test(size)) return size;
  return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string): string {
  if (value === "low") return "480p";
  if (value === "auto" || value === "high" || value === "medium") return "720p";
  const resolution = value.replace(/p$/i, "") || "720";
  return `${resolution}p`;
}

// ===== 响应类型 =====

type VideoResponse = { id: string; status?: string; error?: { message?: string } };
type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };

type SeedanceTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

type SeedanceTask = {
  id: string;
  status?: SeedanceTaskStatus;
  error?: { code?: string; message?: string } | null;
  content?: { video_url?: string; last_frame_url?: string } | null;
};

type ApiEnvelope<T> = T | { code?: number; data?: T | null; msg?: string };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
type VideoGenerationTask = { id: string; provider: "openai" | "seedance" };
type VideoGenerationTaskState =
  | { status: "pending" }
  | { status: "completed"; result: VideoGenerationResult }
  | { status: "failed"; error: string };

// ===== 信封解包 =====

/** 解包 API 信封响应:支持直接返回 T 或 {code, data, msg} 信封 */
function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
  if (!payload) throw new Error(emptyMessage);
  if (
    typeof payload === "object" &&
    "code" in payload &&
    typeof (payload as { code?: unknown }).code === "number"
  ) {
    const envelope = payload as { code: number; data?: T | null; msg?: string };
    if (envelope.code !== 0) throw new Error(envelope.msg || "请求失败");
    if (!envelope.data) throw new Error(emptyMessage);
    return envelope.data;
  }
  return payload as T;
}

function unwrapVideoResponse(payload: ApiVideoResponse): VideoResponse {
  return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>): SeedanceTask {
  return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

// ===== 配置校验 =====

function assertVideoConfig(config: ResolvedConfig): void {
  if (!config.model) throw new Error("请先配置视频模型");
  if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
  if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
  if (config.apiFormat === "gemini")
    throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

// ===== 参考素材解析 =====

/** 解析 Seedance 参考图:公网URL/asset:// 直接返回,否则转 dataUrl */
async function resolveSeedanceImageUrl(image: string): Promise<string> {
  if (isPublicMediaUrl(image) || image.startsWith("asset://")) return image;
  if (image.startsWith("data:")) return image;
  if (image.startsWith("blob:")) {
    const blob = await (await fetch(image)).blob();
    return blobToDataUrl(blob);
  }
  throw new Error("参考图读取失败，请换一张图片或重新上传");
}

/** 解析 Seedance 参考视频:公网URL/asset:// 直接返回,blob:/dataUrl 转换 */
async function resolveSeedanceVideoUrl(video: ReferenceVideo): Promise<string> {
  const directUrl = video.url || video.dataUrl;
  if (directUrl) {
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    if (directUrl.startsWith("data:")) return directUrl;
    if (directUrl.startsWith("blob:")) {
      const blob = await (await fetch(directUrl)).blob();
      return blobToDataUrl(blob);
    }
  }
  throw new Error("参考视频必须是公网 URL 或本地已保存的视频");
}

/** 解析 Seedance 参考音频:公网URL/asset:// 直接返回,blob:/dataUrl 转换 */
async function resolveSeedanceAudioUrl(audio: ReferenceAudio): Promise<string> {
  const directUrl = audio.url || audio.dataUrl;
  if (directUrl) {
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    if (directUrl.startsWith("data:")) return directUrl;
    if (directUrl.startsWith("blob:")) {
      const blob = await (await fetch(directUrl)).blob();
      return blobToDataUrl(blob);
    }
  }
  throw new Error("参考音频必须是公网 URL 或本地已保存的音频");
}

// ===== Seedance 任务 =====

function seedanceApiUrl(config: ResolvedConfig, taskId?: string): string {
  return buildApiUrl(
    config.baseUrl,
    `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`,
  );
}

/** 构建 Seedance content 数组(文本 + 参考图/视频/音频) */
async function buildSeedanceContent(
  req: VideoGenerationRequest,
): Promise<Array<Record<string, unknown>>> {
  const content: Array<Record<string, unknown>> = [];
  const images = req.referenceImages || [];
  const videos = req.referenceVideos || [];
  const audios = req.referenceAudios || [];
  const text = buildSeedancePromptText(req.prompt, images.length, videos.length, audios.length);
  if (text) content.push({ type: "text", text });
  for (const image of images.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
    content.push({
      type: "image_url",
      image_url: { url: await resolveSeedanceImageUrl(image) },
      role: "reference_image",
    });
  }
  for (const video of videos.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
    content.push({
      type: "video_url",
      video_url: { url: await resolveSeedanceVideoUrl(video) },
      role: "reference_video",
    });
  }
  for (const audio of audios.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
    content.push({
      type: "audio_url",
      audio_url: { url: await resolveSeedanceAudioUrl(audio) },
      role: "reference_audio",
    });
  }
  return content;
}

/** 创建 Seedance 任务 */
async function createSeedanceTask(
  req: VideoGenerationRequest,
  config: ResolvedConfig,
): Promise<VideoGenerationTask> {
  const audios = req.referenceAudios || [];
  const images = req.referenceImages || [];
  const videos = req.referenceVideos || [];
  if (audios.length && !images.length && !videos.length) {
    throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
  }
  const content = await buildSeedanceContent(req);
  if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
  const payload = {
    model: config.model,
    content,
    ratio: normalizeSeedanceRatio(req.size ?? ''),
    resolution: normalizeSeedanceResolution(req.vquality, config.model),
    duration: normalizeSeedanceDuration(req.seconds),
    generate_audio: req.generateAudio,
    watermark: req.watermark,
    return_last_frame: req.returnLastFrame ?? false,
  };
  try {
    const created = unwrapSeedanceTask(
      (
        await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, {
          headers: aiHeaders(config, "application/json"),
          signal: req.signal,
        })
      ).data,
    );
    if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
    return { id: created.id, provider: "seedance" };
  } catch (error) {
    throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
  }
}

/** 轮询 Seedance 任务 */
async function pollSeedanceTask(
  config: ResolvedConfig,
  task: VideoGenerationTask,
  signal?: AbortSignal,
): Promise<VideoGenerationTaskState> {
  try {
    const state = unwrapSeedanceTask(
      (
        await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), {
          headers: aiHeaders(config),
          signal,
        })
      ).data,
    );
    if (state.status === "succeeded") {
      const url = state.content?.video_url;
      if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
      return { status: "completed", result: await videoResultFromUrl(url, signal) };
    }
    if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") {
      return {
        status: "failed",
        error:
          state.error?.message ||
          `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}`,
      };
    }
    return { status: "pending" };
  } catch (error) {
    throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
  }
}

// ===== OpenAI 视频任务 =====

/** 创建 OpenAI 视频任务(FormData) */
async function createOpenAIVideoTask(
  req: VideoGenerationRequest,
  config: ResolvedConfig,
): Promise<VideoGenerationTask> {
  const body = new FormData();
  body.append("model", config.model);
  body.append("prompt", req.prompt);
  body.append("seconds", normalizeVideoSeconds(req.seconds));
  const size = normalizeVideoSize(req.size ?? '');
  if (size) body.append("size", size);
  body.append("resolution_name", normalizeVideoResolution(req.vquality));
  body.append("preset", "normal");
  const references = req.referenceImages || [];
  for (const image of references.slice(0, 7)) {
    const dataUrl = image.startsWith("data:") ? image : await resolveSeedanceImageUrl(image);
    body.append("input_reference[]", dataUrlToFile(dataUrl));
  }
  try {
    const created = unwrapVideoResponse(
      (
        await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, {
          headers: aiHeaders(config),
          signal: req.signal,
        })
      ).data,
    );
    if (!created.id) throw new Error("视频接口没有返回任务 ID");
    return { id: created.id, provider: "openai" };
  } catch (error) {
    throw new Error(readAxiosError(error, "视频任务创建失败"));
  }
}

/** 轮询 OpenAI 视频任务 */
async function pollOpenAIVideoTask(
  config: ResolvedConfig,
  task: VideoGenerationTask,
  signal?: AbortSignal,
): Promise<VideoGenerationTaskState> {
  try {
    const video = unwrapVideoResponse(
      (
        await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), {
          headers: aiHeaders(config),
          signal,
        })
      ).data,
    );
    if (video.status === "completed") {
      const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), {
        headers: aiHeaders(config),
        responseType: "blob",
        signal,
      });
      await assertVideoBlob(content.data);
      return { status: "completed", result: { blob: content.data } };
    }
    if (video.status === "failed" || video.status === "cancelled") {
      return { status: "failed", error: video.error?.message || "视频生成失败" };
    }
    return { status: "pending" };
  } catch (error) {
    throw new Error(readAxiosError(error, "视频任务查询失败"));
  }
}

// ===== 视频下载与校验 =====

/** 从 URL 下载视频 blob,失败时回退返回 url */
async function videoResultFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<VideoGenerationResult> {
  try {
    const response = await axios.get<Blob>(url, { responseType: "blob", signal });
    await assertVideoBlob(response.data);
    return { blob: response.data };
  } catch (error) {
    if (axios.isCancel(error) || signal?.aborted) throw error;
    return { url, mimeType: "video/mp4" };
  }
}

/** 校验视频 blob:如果 type 含 json,解析错误 */
async function assertVideoBlob(blob: Blob): Promise<void> {
  if (!blob.type.includes("json")) return;
  let payload: { code?: number; msg?: string; error?: { message?: string } };
  try {
    payload = JSON.parse(await blob.text()) as {
      code?: number;
      msg?: string;
      error?: { message?: string };
    };
  } catch {
    return;
  }
  if (typeof payload.code === "number" && payload.code !== 0)
    throw new Error(payload.msg || "视频下载失败");
  if (payload.error?.message) throw new Error(payload.error.message);
}

// ===== 视频元数据读取 =====

/** 从 Blob 读取视频元数据(width/height/durationMs/mimeType/bytes) */
export function readVideoMetaFromBlob(blob: Blob): Promise<GeneratedVideo> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    let done = false;
    const finish = (width: number, height: number, durationMs: number) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve({
        blob,
        width,
        height,
        durationMs,
        mimeType: blob.type || "video/mp4",
        bytes: blob.size,
      });
    };
    video.onloadedmetadata = () =>
      finish(video.videoWidth || 1280, video.videoHeight || 720, Math.round(video.duration * 1000));
    video.onerror = () => finish(1280, 720, 0);
    setTimeout(
      () =>
        finish(video.videoWidth || 1280, video.videoHeight || 720, Math.round(video.duration * 1000)),
      5000,
    );
    video.src = url;
  });
}

// ===== 主入口 =====

/** 视频生成 + 轮询(120 次) */
export async function requestVideoGeneration(
  req: VideoGenerationRequest,
  config: ResolvedConfig,
): Promise<VideoGenerationResult> {
  assertVideoConfig(config);

  const task = isSeedanceVideoConfig(config)
    ? await createSeedanceTask(req, config)
    : await createOpenAIVideoTask(req, config);

  const delayMs = task.provider === "seedance" ? 5000 : 2500;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const state =
      task.provider === "seedance"
        ? await pollSeedanceTask(config, task, req.signal)
        : await pollOpenAIVideoTask(config, task, req.signal);
    if (state.status === "completed") return state.result;
    if (state.status === "failed") throw new Error(state.error);
    if (attempt === 119)
      throw new Error(
        `${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`,
      );
    await delay(delayMs, req.signal);
  }
  throw new Error("视频生成超时，请稍后重试");
}
