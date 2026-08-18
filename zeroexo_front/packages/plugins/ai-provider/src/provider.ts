/**
 * AIProvider - AI 生成服务抽象接口
 *
 * 业务节点插件通过 `context.getPlugin<AIProvider>('ai-provider')` 获取实例。
 * Phase 7 提供 DirectProvider(前端直连) 和 ProxyProvider(后端代理) 两种实现。
 */

import type { Plugin } from '@zeroexo/core';
import type {
  ImageGenerationRequest,
  ImageEditRequest,
  GeneratedImage,
  TextGenerationRequest,
  VideoGenerationRequest,
  GeneratedVideo,
  AudioGenerationRequest,
  GeneratedAudio,
} from './types.js';

export interface AIProvider extends Plugin {
  id: 'ai-provider';

  /** 文生图(无参考图) */
  generateImage(req: ImageGenerationRequest): Promise<GeneratedImage[]>;

  /** 图生图/图片编辑(有参考图) */
  editImage(req: ImageEditRequest): Promise<GeneratedImage[]>;

  /** 文本生成(支持流式 onDelta 回调) */
  generateText(
    req: TextGenerationRequest,
    onDelta?: (delta: string) => void,
  ): Promise<string>;

  /** 视频生成 */
  generateVideo(req: VideoGenerationRequest): Promise<GeneratedVideo>;

  /** 音频生成 */
  generateAudio(req: AudioGenerationRequest): Promise<GeneratedAudio>;

  /** 检查 Provider 是否已配置(如 API Key 是否设置) */
  isConfigured(): boolean;
}
