/**
 * AI Provider 插件 - AI 生成服务抽象层
 *
 * Phase 5: 定义接口 + StubProvider(demo 用)
 * Phase 7: 实现 DirectProvider(前端直连) / ProxyProvider(后端代理)
 */

export type { AIProvider } from './provider.js';
export type {
  ImageGenerationRequest,
  ImageEditRequest,
  GeneratedImage,
  TextGenerationRequest,
  VideoGenerationRequest,
  GeneratedVideo,
  AudioGenerationRequest,
  GeneratedAudio,
  GenerationStatus,
  ImageNodeData,
  TextNodeData,
  ConfigNodeData,
  VideoNodeData,
  AudioNodeData,
  ResolvedConfig,
  ConfigProvider,
  ReferenceVideo,
  ReferenceAudio,
} from './types.js';

export { StubProvider } from './stub-provider.js';
export { DirectProvider } from './direct-provider.js';
export { ProxyProvider } from './proxy-provider.js';
export type { ProxyFetch } from './proxy-provider.js';
export { AiError } from './ai-error.js';
export type { AiErrorType } from './ai-error.js';
export {
  classifyError,
  isRetryable,
  maxRetryCount,
  retryDelayMs,
  timeoutMsByKind,
} from './ai-error.js';
