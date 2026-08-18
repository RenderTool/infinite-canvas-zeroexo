/**
 * StubProvider - AI Provider 的 stub 实现
 *
 * 用于 Phase 5 demo 验证,所有方法抛出"未配置"错误。
 * Phase 7 替换为 DirectProvider / ProxyProvider。
 */

import type { PluginContext, PluginOptions } from '@zeroexo/core';
import type { AIProvider } from './provider.js';
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

export class StubProvider implements AIProvider {
  id = 'ai-provider' as const;

  install(_context: PluginContext, _options?: PluginOptions): void {
    // nothing
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
    return false;
  }

  async generateImage(_req: ImageGenerationRequest): Promise<GeneratedImage[]> {
    throw new Error('[StubProvider] AI Provider 未配置。请在 Phase 7 实现 DirectProvider 或 ProxyProvider。');
  }

  async editImage(_req: ImageEditRequest): Promise<GeneratedImage[]> {
    throw new Error('[StubProvider] AI Provider 未配置。请在 Phase 7 实现 DirectProvider 或 ProxyProvider。');
  }

  async generateText(
    _req: TextGenerationRequest,
    _onDelta?: (delta: string) => void,
  ): Promise<string> {
    throw new Error('[StubProvider] AI Provider 未配置。请在 Phase 7 实现 DirectProvider 或 ProxyProvider。');
  }

  async generateVideo(_req: VideoGenerationRequest): Promise<GeneratedVideo> {
    throw new Error('[StubProvider] AI Provider 未配置。请在 Phase 7 实现 DirectProvider 或 ProxyProvider。');
  }

  async generateAudio(_req: AudioGenerationRequest): Promise<GeneratedAudio> {
    throw new Error('[StubProvider] AI Provider 未配置。请在 Phase 7 实现 DirectProvider 或 ProxyProvider。');
  }
}
