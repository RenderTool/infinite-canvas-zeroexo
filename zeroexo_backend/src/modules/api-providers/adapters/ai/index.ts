/**
 * AI 适配器统一出口
 *
 * 当前已实现:
 * - AnthropicAdapter:     Claude 系列(原生 /v1/messages + OpenAI 兼容)
 * - StabilityAdapter:     Stability AI 文生图(REST + Legacy)
 * - AliyunBailianAdapter: 阿里云百炼(文本 / 图像 / 视频 / 语音,OpenAI 兼容 + 异步任务)
 *
 * 复用说明:
 * - OpenAI / Gemini / 火山方舟等渠道的细粒度适配器可在此目录继续追加
 * - 顶层 ai.adapter.ts 已统一处理 openai/anthropic/stability/volcengine/gemini/mock
 */
export { AnthropicAdapter } from './anthropic.adapter';
export { StabilityAdapter } from './stability.adapter';
export { AliyunBailianAdapter } from './aliyun-bailian.adapter';
