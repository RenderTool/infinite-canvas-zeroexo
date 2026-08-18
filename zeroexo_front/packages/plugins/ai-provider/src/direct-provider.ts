/**
 * DirectProvider - AI Provider 的前端直连实现
 *
 * 通过 ConfigProvider 接口解耦 app 层的 AiConfig store:
 * - app 层注入 ConfigProvider,将 "channelId::model" 编码值解析为真实请求配置
 * - DirectProvider 不直接依赖 app 层的 store,仅依赖 ResolvedConfig
 *
 * 实现 OpenAI / Gemini 双格式 + Seedance 视频流 + SSE 文本流式。
 */

import type { AIProvider } from "./provider.js";
import type {
  AudioGenerationRequest,
  ConfigProvider,
  GeneratedAudio,
  GeneratedImage,
  GeneratedVideo,
  ImageEditRequest,
  ImageGenerationRequest,
  TextGenerationRequest,
  VideoGenerationRequest,
} from "./types.js";
import { requestAudioGeneration, readAudioMetaFromBlob } from "./lib/audio-api.js";
import { requestEdit, requestGeneration } from "./lib/image-api.js";
import { requestImageQuestion } from "./lib/text-api.js";
import { requestVideoGeneration, readVideoMetaFromBlob } from "./lib/video-api.js";

export class DirectProvider implements AIProvider {
  id = "ai-provider" as const;
  private configProvider: ConfigProvider;

  constructor(configProvider: ConfigProvider) {
    this.configProvider = configProvider;
  }

  install(): void {
    // DirectProvider 无状态,无需 install 钩子
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

  isConfigured(): boolean {
    return this.configProvider.isReady();
  }

  async generateImage(req: ImageGenerationRequest): Promise<GeneratedImage[]> {
    const config = this.configProvider.resolveConfig(req.model);
    return requestGeneration(req, config);
  }

  async editImage(req: ImageEditRequest): Promise<GeneratedImage[]> {
    const config = this.configProvider.resolveConfig(req.model);
    return requestEdit(req, config);
  }

  async generateText(
    req: TextGenerationRequest,
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    const config = this.configProvider.resolveConfig(req.model);
    return requestImageQuestion(req, config, onDelta);
  }

  async generateVideo(req: VideoGenerationRequest): Promise<GeneratedVideo> {
    const config = this.configProvider.resolveConfig(req.model);
    const result = await requestVideoGeneration(req, config);
    if (!result.blob) throw new Error("视频接口没有返回可播放的视频");
    return readVideoMetaFromBlob(result.blob);
  }

  async generateAudio(req: AudioGenerationRequest): Promise<GeneratedAudio> {
    const config = this.configProvider.resolveConfig(req.model);
    const blob = await requestAudioGeneration(req, config);
    return readAudioMetaFromBlob(blob);
  }
}
