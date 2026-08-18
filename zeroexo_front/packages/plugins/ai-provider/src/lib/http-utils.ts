/**
 * 共享 HTTP 工具
 *
 * DirectProvider 的各 API 模块均依赖此处定义的请求构造与错误处理逻辑。
 */

import axios from "axios";

import type { ResolvedConfig } from "../types.js";

// ===== URL 构造 =====

/**
 * 构造 API 完整 URL
 *
 * 规则:
 * - 去除尾部斜杠
 * - 识别火山方舟 /api/plan/v3 路径并截断其后缀
 * - 若 baseUrl 已以 /v1、/api/v3、/api/plan/v3 结尾则不再追加 /v1,否则自动追加
 */
export function buildApiUrl(baseUrl: string, path: string): string {
  let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
  const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
  const apiBaseUrl =
    lowerBaseUrl.endsWith("/v1") ||
    lowerBaseUrl.endsWith("/api/v3") ||
    lowerBaseUrl.endsWith("/api/plan/v3")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/v1`;
  return `${apiBaseUrl}${path}`;
}

/** 火山方舟 Agent Plan 路径归一化:截断 /api/plan/v3 之后的多余路径 */
function normalizeArkPlanBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "");
    const lowerPath = path.toLowerCase();
    const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
    if (arkPlanIndex < 0) return baseUrl;
    const end = arkPlanIndex + "/api/plan/v3".length;
    if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
    url.pathname = path.slice(0, end);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl;
  }
}

/** OpenAI 格式:拼接 baseUrl + path */
export function aiApiUrl(config: ResolvedConfig, path: string): string {
  return buildApiUrl(config.baseUrl, path);
}

// ===== 请求头 =====

/** OpenAI 格式请求头:Bearer 鉴权 + 可选 Content-Type */
export function aiHeaders(
  config: ResolvedConfig,
  contentType?: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

/** Gemini baseUrl:未以 /v1 或 /v1beta 结尾时追加 /v1beta */
export function geminiBaseUrl(config: ResolvedConfig): string {
  const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
  const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
  return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1beta`;
}

/** Gemini 模型名:去除 models/ 前缀 */
export function geminiModelName(model: string): string {
  return model.trim().replace(/^models\//, "");
}

/** Gemini API URL:models/{model}:{action} */
export function geminiApiUrl(
  config: ResolvedConfig,
  action?: "generateContent" | "streamGenerateContent",
): string {
  const baseUrl = geminiBaseUrl(config);
  if (!action) return `${baseUrl}/models`;
  return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

/** Gemini 请求头:x-goog-api-key 鉴权 */
export function geminiHeaders(config: ResolvedConfig): Record<string, string> {
  return {
    "x-goog-api-key": config.apiKey,
    "Content-Type": "application/json",
  };
}

// ===== 错误处理 =====

/** 统一 axios 错误读取:取消 / 响应体 message / HTTP 状态码翻译 */
export function readAxiosError(error: unknown, fallback: string): string {
  if (axios.isCancel(error)) return "请求已取消";
  if (
    axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(
      error,
    )
  ) {
    const responseData = error.response?.data;
    return (
      responseData?.msg ||
      responseData?.error?.message ||
      readStatusError(error.response?.status, fallback)
    );
  }
  if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
  return error instanceof Error ? error.message : fallback;
}

/** HTTP 状态码翻译:401/403 鉴权失败,429 限流 */
export function readStatusError(status: number | undefined, fallback: string): string {
  if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
  if (status === 429) return "请求被限流或额度不足，请稍后重试";
  return status ? `${fallback}（${status}）` : fallback;
}

/** 读取 fetch 响应错误:尝试解析 JSON 中的 msg/error.message,否则截断文本 */
export async function readFetchError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) return readStatusError(response.status, fallback);
  try {
    return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
  } catch {
    return text.slice(0, 300) || readStatusError(response.status, fallback);
  }
}

/** 判断值是否为普通对象(非数组) */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** 提取字符串值(非字符串返回空串) */
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 从响应体中提取错误消息:msg / error.message / response.error.message */
export function responseErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  const error = isRecord(value.error) ? value.error : undefined;
  const response = isRecord(value.response) ? value.response : undefined;
  const responseError = response && isRecord(response.error) ? response.error : undefined;
  return (
    stringValue(value.msg) ||
    stringValue(error?.message) ||
    stringValue(responseError?.message)
  );
}

// ===== 工具函数 =====

/** Promise 延时,支持 AbortSignal 中断 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** 检测是否为公网媒体 URL */
export function isPublicMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(value || "");
}

/** Blob → dataUrl(FileReader) */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取本地素材失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * 将图片值(dataUrl 或 URL)统一转为 dataUrl
 *
 * - dataUrl 直接返回
 * - 公网 URL / blob: URL → fetch → blobToDataUrl
 */
export async function imageToDataUrl(value: string): Promise<string> {
  if (!value) return "";
  if (value.startsWith("data:")) return value;
  const blob = await (await fetch(value)).blob();
  return blobToDataUrl(blob);
}

/** dataUrl → File(base64 解码为二进制) */
export function dataUrlToFile(dataUrl: string, name = "reference.png"): File {
  const [header = "", content = ""] = dataUrl.split(",", 2);
  const mimeType = header.match(/data:(.*?);base64/)?.[1] || "image/png";
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: mimeType });
}
