/**
 * AI 渠道 Tab 相关类型与常量
 *
 * 仅包含 ApiProvidersTab 及其子组件共享的类型定义与常量。
 *
 * 注意：
 * - `MODEL_TYPE_LABELS` 在本文件中使用 i18n 翻译键（如 'ai.type.llm'），
 *   通过 `t()` 函数调用以获得本地化文本；这与 ai-brand-constants.ts 中的
 *   `MODEL_TYPE_LABELS`（直接中文字符串）语义不同，因此在此独立维护，
 *   不复用 ai-brand-constants.ts 中的定义。
 */

/** sessionStorage key，用于在刷新后恢复详情视图状态 */
export const STORAGE_KEY = 'ai_detail_view_state';

/**
 * 模型类型 → i18n 翻译键
 *
 * 使用方式：`t(MODEL_TYPE_LABELS[cap])`，例如 `t('ai.type.llm')` → '语言模型'。
 */
export const MODEL_TYPE_LABELS: Record<string, string> = {
  llm: 'ai.type.llm',
  image: 'ai.type.image',
  video: 'ai.type.video',
  audio: 'ai.type.audio',
};

/** 品牌预设（来自后端 /admin/api-providers/presets） */
export interface BrandPreset {
  provider: string;
  label: string;
  type: string;
  official: boolean;
  apiFormat: string;
  defaultBaseUrl: string;
  color: string;
  description: string;
  capabilities: string[];
}

/** 渠道记录（来自后端 /admin/api-providers?type=ai） */
export interface ProviderRecord {
  id: string;
  name: string;
  provider: string;
  config?: Record<string, any>;
  credentials?: Record<string, any>;
  credentialsMask?: string;
  health?: string;
  enabled: boolean;
  isDefault: boolean;
  capabilities?: string[];
}
