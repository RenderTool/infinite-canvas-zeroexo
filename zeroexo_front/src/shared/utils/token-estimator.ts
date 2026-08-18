/**
 * Token 估算工具
 *
 * 根据字符数估算 Token 消耗和费用。
 * - 中英文混合文本: 按 1.5 chars/token 估算（保守估计）
 * - 英文字符: 4 chars/token
 * - 纯 TypeScript 实现，无框架依赖
 */

import type { ModelPricingEntry } from './model-pricing';

export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface TokenEstimateInput {
  /** 输入文本的字符数数组, 每个元素代表一个单元的字符数 */
  unitCharCounts: number[];
  /** 模型定价 */
  pricing: ModelPricingEntry;
  /** 每单元预估输出 token 数 (默认 2000) */
  outputTokensPerUnit?: number;
  /** 系统 prompt 额外 token 数 (默认 500) */
  systemPromptOverhead?: number;
}

/**
 * 根据字符数估算 token 数量
 * 中英文混合文本按 1.5 chars/token 估算
 */
function charsToTokens(charCount: number): number {
  return Math.ceil(charCount / 1.5);
}

/**
 * 估算单个单元的 Token 消耗和费用
 */
export function estimateSingleUnit(
  charCount: number,
  pricing: ModelPricingEntry,
  outputTokens: number = 2000,
): TokenEstimate {
  const inputTokens = charsToTokens(charCount);
  const outputTokensVal = outputTokens;
  const totalTokens = inputTokens + outputTokensVal;
  const estimatedCost =
    (inputTokens / 1_000_000) * pricing.inputPricePerM +
    (outputTokensVal / 1_000_000) * pricing.outputPricePerM;

  return {
    inputTokens,
    outputTokens: outputTokensVal,
    totalTokens,
    estimatedCost,
  };
}

/**
 * 估算多单元 Token 消耗和总费用
 *
 * 每个单元会加上系统 prompt 开销，输出按每单元指定数量累计。
 * 空数组输入返回全零结果。
 *
 * @example
 * ```ts
 * const estimate = estimateTokenCost({
 *   unitCharCounts: [3421, 4102, 3887, 3210, 4015],
 *   pricing: getModelPricing('gpt-4o')!,
 * });
 * ```
 */
export function estimateTokenCost(input: TokenEstimateInput): TokenEstimate {
  const {
    unitCharCounts,
    pricing,
    outputTokensPerUnit = 2000,
    systemPromptOverhead = 500,
  } = input;

  if (unitCharCounts.length === 0) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
  }

  // 系统 prompt 开销只在第一个单元计算一次（或按需分摊，这里按一次计入总 input）
  const overheadTokens = charsToTokens(systemPromptOverhead);

  let totalInputTokens = overheadTokens;
  let totalOutputTokens = 0;

  for (const charCount of unitCharCounts) {
    totalInputTokens += charsToTokens(charCount);
    totalOutputTokens += outputTokensPerUnit;
  }

  const totalTokens = totalInputTokens + totalOutputTokens;
  const estimatedCost =
    (totalInputTokens / 1_000_000) * pricing.inputPricePerM +
    (totalOutputTokens / 1_000_000) * pricing.outputPricePerM;

  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens,
    estimatedCost,
  };
}