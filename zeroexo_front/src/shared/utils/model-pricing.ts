/**
 * 模型定价配置表
 *
 * 提供各模型的 Token 单价信息，用于费用估算。
 */

export interface ModelPricingEntry {
  /** 模型标识, 如 'gpt-4o' */
  id: string;
  /** 显示名称, 如 'GPT-4o' */
  label: string;
  /** 每百万 token 输入价格 (USD) */
  inputPricePerM: number;
  /** 每百万 token 输出价格 (USD) */
  outputPricePerM: number;
  /** 可选描述 */
  description?: string;
}

export const MODEL_PRICING_LIST: ModelPricingEntry[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    inputPricePerM: 2.50,
    outputPricePerM: 10.00,
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o-mini',
    inputPricePerM: 0.15,
    outputPricePerM: 0.60,
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    inputPricePerM: 0.14,
    outputPricePerM: 0.28,
  },
  {
    id: 'claude-3-5-sonnet',
    label: 'Claude 3.5 Sonnet',
    inputPricePerM: 3.00,
    outputPricePerM: 15.00,
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    inputPricePerM: 0.10,
    outputPricePerM: 0.40,
  },
];

/**
 * 根据模型 ID 查找定价信息
 */
export function getModelPricing(modelId: string): ModelPricingEntry | undefined {
  return MODEL_PRICING_LIST.find((entry) => entry.id === modelId);
}