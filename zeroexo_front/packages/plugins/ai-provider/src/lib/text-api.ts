/**
 * 文本流式生成 API(SSE)
 *
 * - OpenAI: fetch POST /v1/responses (stream:true) + ReadableStream reader + 按 \r\n\r\n 分块解析
 * - Gemini: fetch POST /v1beta/models/{model}:streamGenerateContent?alt=sse
 *
 * onDelta 回调接收累积文本(非增量),最终返回完整文本。
 */

import type { ResolvedConfig, TextGenerationRequest } from "../types.js";
import {
  aiApiUrl,
  aiHeaders,
  geminiApiUrl,
  geminiHeaders,
  readAxiosError,
  readFetchError,
  responseErrorMessage,
} from "./http-utils.js";

// ===== 类型定义 =====

type ResponseInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

type ResponseInputItem = {
  role: "system" | "user" | "assistant";
  content: string | ResponseInputContent[];
};

type ResponseApiPayload = {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
  error?: { message?: string };
  code?: number;
  msg?: string;
};

type ResponseStreamState = {
  buffer: string;
  text: string;
  payload?: ResponseApiPayload;
  error?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  fileData?: { mimeType?: string; fileUri?: string };
};

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
};

type GeminiStreamState = { buffer: string; text: string; error?: string };

// ===== OpenAI 请求构造 =====

/** 构建 OpenAI Responses API 的 input 参数(系统消息 + 用户消息) */
function buildOpenAiInput(
  req: TextGenerationRequest,
  config: ResolvedConfig,
): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  const systemPrompt = config.systemPrompt?.trim();
  if (systemPrompt) {
    input.push({ role: "system", content: systemPrompt });
  }
  const userContent: ResponseInputContent[] = [
    { type: "input_text", text: req.prompt },
    ...(req.referenceImages || []).map(
      (url) => ({ type: "input_image", image_url: url }) satisfies ResponseInputContent,
    ),
  ];
  input.push({ role: "user", content: userContent });
  return input;
}

/** 校验 OpenAI 响应体(错误码/错误消息) */
function validateResponsePayload(payload: ResponseApiPayload): void {
  if (typeof payload.code === "number" && payload.code !== 0)
    throw new Error(payload.msg || "请求失败");
  if (payload.error?.message) throw new Error(payload.error.message);
}

// ===== OpenAI SSE 解析 =====

/** 解析单个 SSE 数据块,累积文本到 state */
function consumeResponseStreamBlock(
  block: string,
  state: ResponseStreamState,
  onDelta?: (text: string) => void,
): void {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return;
  const event = JSON.parse(data) as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";
  const errorMessage = responseErrorMessage(event);
  if (errorMessage) state.error = errorMessage;
  if (type === "response.output_text.delta" && typeof event.delta === "string") {
    state.text += event.delta;
    onDelta?.(state.text);
  }
  if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
    state.text = event.text;
    onDelta?.(state.text);
  }
  if (type === "response.completed" && event.response && typeof event.response === "object") {
    state.payload = event.response as ResponseApiPayload;
  } else if (Array.isArray(event.output)) {
    state.payload = event as ResponseApiPayload;
  }
}

/** 将流式文本追加到缓冲区,按 \r\n\r\n 分块处理 */
function consumeResponseStreamText(
  state: ResponseStreamState,
  text: string,
  onDelta?: (text: string) => void,
  flush = false,
): void {
  state.buffer += text;
  for (;;) {
    const match = state.buffer.match(/\r?\n\r?\n/);
    if (!match || match.index === undefined) break;
    consumeResponseStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
    state.buffer = state.buffer.slice(match.index + match[0].length);
  }
  if (flush && state.buffer.trim()) {
    consumeResponseStreamBlock(state.buffer, state, onDelta);
    state.buffer = "";
  }
}

/** 读取 OpenAI SSE 流,返回完整文本 */
async function readOpenAiSseStream(
  response: Response,
  onDelta?: (text: string) => void,
): Promise<string> {
  if (!response.body) {
    const payload = (await response.json()) as ResponseApiPayload;
    validateResponsePayload(payload);
    return payload.output_text || "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: ResponseStreamState = { buffer: "", text: "" };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
    if (state.error) throw new Error(state.error);
  }
  consumeResponseStreamText(state, decoder.decode(), onDelta, true);
  if (state.error) throw new Error(state.error);
  if (state.payload) validateResponsePayload(state.payload);
  return state.text;
}

// ===== Gemini 请求构造 =====

/** 构建 Gemini 请求体(contents + systemInstruction) */
function buildGeminiBody(
  req: TextGenerationRequest,
  config: ResolvedConfig,
): Record<string, unknown> {
  const parts: GeminiPart[] = [{ text: req.prompt }];
  for (const url of req.referenceImages || []) {
    parts.push(toGeminiImagePart(url));
  }
  const systemPrompt = config.systemPrompt?.trim();
  return {
    contents: [{ role: "user", parts }],
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
  };
}

/** 将 dataUrl/URL 转为 GeminiPart(inlineData 或 fileData) */
function toGeminiImagePart(url: string): GeminiPart {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
  return { fileData: { fileUri: url, mimeType: "image/png" } };
}

// ===== Gemini SSE 解析 =====

/** 从 Gemini 响应中提取文本(校验错误) */
function extractGeminiText(payload: GeminiPayload): string {
  if (payload.error?.message) throw new Error(payload.error.message);
  if (payload.promptFeedback?.blockReason)
    throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
  return (
    payload.candidates?.flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || "")
      .join("") || ""
  );
}

/** 解析单个 Gemini SSE 数据块,累积文本到 state */
function consumeGeminiStreamBlock(
  block: string,
  state: GeminiStreamState,
  onDelta?: (text: string) => void,
): void {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return;
  const text = extractGeminiText(JSON.parse(data) as GeminiPayload);
  if (text) {
    state.text += text;
    onDelta?.(state.text);
  }
}

/** 将流式文本追加到缓冲区,按 \r\n\r\n 分块处理 */
function consumeGeminiStreamText(
  state: GeminiStreamState,
  text: string,
  onDelta?: (text: string) => void,
  flush = false,
): void {
  state.buffer += text;
  for (;;) {
    const match = state.buffer.match(/\r?\n\r?\n/);
    if (!match || match.index === undefined) break;
    consumeGeminiStreamBlock(state.buffer.slice(0, match.index), state, onDelta);
    state.buffer = state.buffer.slice(match.index + match[0].length);
  }
  if (flush && state.buffer.trim()) {
    consumeGeminiStreamBlock(state.buffer, state, onDelta);
    state.buffer = "";
  }
}

/** 读取 Gemini SSE 流,返回完整文本 */
async function readGeminiSseStream(
  response: Response,
  onDelta?: (text: string) => void,
): Promise<string> {
  if (!response.body) {
    const payload = (await response.json()) as GeminiPayload;
    return extractGeminiText(payload);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: GeminiStreamState = { buffer: "", text: "" };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
  }
  consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
  return state.text;
}

// ===== 主入口 =====

/** 文本生成(支持流式 onDelta 回调),返回完整文本 */
export async function requestImageQuestion(
  req: TextGenerationRequest,
  config: ResolvedConfig,
  onDelta?: (text: string) => void,
): Promise<string> {
  try {
    if (config.apiFormat === "gemini") {
      const response = await fetch(
        `${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`,
        {
          method: "POST",
          headers: geminiHeaders(config),
          body: JSON.stringify(buildGeminiBody(req, config)),
          signal: req.signal,
        },
      );
      if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
      const answer = (await readGeminiSseStream(response, onDelta)) || "没有返回内容";
      if (answer === "没有返回内容") onDelta?.(answer);
      return answer;
    }
    const response = await fetch(aiApiUrl(config, "/responses"), {
      method: "POST",
      headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
      body: JSON.stringify({
        model: config.model,
        input: buildOpenAiInput(req, config),
        stream: true,
      }),
      signal: req.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    const answer = (await readOpenAiSseStream(response, onDelta)) || "没有返回内容";
    if (answer === "没有返回内容") onDelta?.(answer);
    return answer;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error(readAxiosError(error, "请求失败"));
  }
}
