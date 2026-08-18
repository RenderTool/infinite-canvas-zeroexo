/**
 * AI Provider 预设配置
 *
 * 数据统一存储在 brand-packs/data/ 目录下，按 provider 分为独立 JSON 文件。
 * 此文件仅保留类型导出和数据加载逻辑。
 */

import { BRAND_PRESET_PACKS } from '../../ai-generate/templates/brand-packs';
import type { BrandPresetPack } from '../../ai-generate/templates/model-templates.types';

export type AiModelType = 'llm' | 'image' | 'video' | 'audio';
export type ApiFormat = 'openai' | 'anthropic' | 'gemini';

export interface AiBrandPreset {
  provider: string;
  label: string;
  official: boolean;
  apiFormat: ApiFormat;
  defaultBaseUrl: string;
  color: string;
  description: string;
  /** 能力类型列表，如 ["llm", "image"] */
  capabilities: string[];
}

/** 从 brand-packs/data/ 加载预设品牌数据 */
function buildPresets(): AiBrandPreset[] {
  return BRAND_PRESET_PACKS.map((p: BrandPresetPack) => ({
    provider: p.provider,
    label: p.label,
    official: p.official,
    apiFormat: p.baseConfig.apiFormat as ApiFormat,
    defaultBaseUrl: p.baseConfig.defaultBaseUrl,
    color: p.color,
    description: p.description,
    capabilities: p.baseConfig.capabilities,
  }));
}

export const AI_BRAND_PRESETS: AiBrandPreset[] = buildPresets();
