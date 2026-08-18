/**
 * 音频 TTS API
 *
 * - POST /v1/audio/speech (JSON, responseType: blob)
 * - assertAudioBlob: 如果 blob.type 含 json,解析错误
 * - Gemini 不支持音频,抛错
 */

import axios from "axios";

import type { AudioGenerationRequest, GeneratedAudio, ResolvedConfig } from "../types.js";
import { aiApiUrl, aiHeaders, readAxiosError } from "./http-utils.js";

// ===== 音频参数常量 =====

const audioVoiceOptions = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

const audioFormatOptions = ["mp3", "wav", "opus", "aac", "flac", "pcm"] as const;

/** 归一化语音值:不在选项内则返回 alloy */
function normalizeAudioVoice(voice: string): string {
  return audioVoiceOptions.includes(voice as (typeof audioVoiceOptions)[number]) ? voice : "alloy";
}

/** 归一化格式值:不在选项内则返回 mp3 */
function normalizeAudioFormat(format: string): string {
  return audioFormatOptions.includes(format as (typeof audioFormatOptions)[number]) ? format : "mp3";
}

/** 归一化语速值:0.25-4.0,保留两位小数 */
function normalizeAudioSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.max(0.25, Math.min(4, Number(speed.toFixed(2))));
}

/** 根据格式返回 MIME 类型 */
function audioMimeType(format: string): string {
  if (format === "wav") return "audio/wav";
  if (format === "opus") return "audio/opus";
  if (format === "aac") return "audio/aac";
  if (format === "flac") return "audio/flac";
  if (format === "pcm") return "audio/pcm";
  return "audio/mpeg";
}

// ===== 配置校验 =====

function assertAudioConfig(config: ResolvedConfig): void {
  if (!config.model) throw new Error("请先配置音频模型");
  if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
  if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
  if (config.apiFormat === "gemini")
    throw new Error("Gemini 调用格式暂不支持音频生成，请使用 OpenAI 格式渠道");
}

// ===== Blob 校验 =====

/** 校验音频 blob:如果 type 含 json,解析错误 */
async function assertAudioBlob(blob: Blob): Promise<void> {
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
    throw new Error(payload.msg || "音频生成失败");
  if (payload.error?.message) throw new Error(payload.error.message);
}

// ===== 音频元数据读取 =====

/** 从 Blob 读取音频元数据(durationMs/mimeType/bytes) */
export function readAudioMetaFromBlob(blob: Blob): Promise<GeneratedAudio> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    let done = false;
    const finish = (durationMs: number) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve({
        blob,
        durationMs,
        mimeType: blob.type || "audio/mpeg",
        bytes: blob.size,
      });
    };
    audio.onloadedmetadata = () => finish(Math.round(audio.duration * 1000));
    audio.onerror = () => finish(0);
    setTimeout(() => finish(Math.round(audio.duration * 1000)), 5000);
    audio.src = url;
  });
}

// ===== 主入口 =====

/** 音频生成(TTS),返回音频 blob */
export async function requestAudioGeneration(
  req: AudioGenerationRequest,
  config: ResolvedConfig,
): Promise<Blob> {
  assertAudioConfig(config);
  const format = normalizeAudioFormat(req.format);
  const instructions = req.instructions?.trim();

  try {
    const response = await axios.post<Blob>(
      aiApiUrl(config, "/audio/speech"),
      {
        model: config.model,
        input: req.prompt,
        voice: normalizeAudioVoice(req.voice),
        response_format: format,
        speed: normalizeAudioSpeed(req.speed),
        ...(instructions ? { instructions } : {}),
      },
      { headers: aiHeaders(config), responseType: "blob", signal: req.signal },
    );
    await assertAudioBlob(response.data);
    return response.data.type.startsWith("audio/")
      ? response.data
      : new Blob([response.data], { type: audioMimeType(format) });
  } catch (error) {
    throw new Error(readAxiosError(error, "音频生成失败"));
  }
}
