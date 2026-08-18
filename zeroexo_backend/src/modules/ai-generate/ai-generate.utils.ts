import { ConfigService } from '@nestjs/config';

/**
 * 获取渠道类型的默认 baseUrl（仅作为后备，优先使用用户在后台配置的 baseUrl）
 *
 * 供 AiGenerateService 与 AiThinkExecutorService 共享。
 */
export function getDefaultBaseUrl(
  config: ConfigService,
  provider: string,
): string | null {
  const configMap: Record<string, string> = {
    openai: 'ai.openaiBaseUrl',
    gemini: 'ai.geminiBaseUrl',
    stability: 'ai.stabilityBaseUrl',
    volcengine: 'ai.volcengineBaseUrl',
  };
  const configKey = configMap[provider];
  if (configKey) {
    return config.get<string>(configKey) ?? null;
  }
  // 对于 deepseek 等其他渠道，不提供默认值，必须由用户在后台配置
  return null;
}
