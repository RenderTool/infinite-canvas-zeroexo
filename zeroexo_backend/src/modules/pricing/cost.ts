/**
 * 成本计算 — 参考 waoowaoo src/lib/billing/cost.ts
 *
 * 单位: llm 按 USD/百万 token;image/video/audio 按 USD/次。
 * 货币: 内部 USD,展示时 ×USD_TO_CNY 转人民币。
 */
import { resolvePricing } from './lookup';
import type { CapabilityValue, PricingModelType } from './catalog';

/** USD → CNY 汇率(展示用,粗略常量) */
export const USD_TO_CNY = 7.2;

/** 加价系数(各类目前均为 1.0,预留商业化加价位) */
export const MARKUP = {
  global: 1.0,
  llm: 1.0,
  image: 1.0,
  video: 1.0,
  audio: 1.0,
} as const;

type MarkupCategory = keyof typeof MARKUP;

function getMarkup(category: MarkupCategory): number {
  return MARKUP[category] ?? MARKUP.global;
}

function toUsdCny(usd: number): number {
  return usd * USD_TO_CNY;
}

/**
 * LLM 成本(精确:input/output 分别计价)
 *
 * @param provider  服务商标识
 * @param modelId   模型 ID
 * @param inputTokens   输入 token 数
 * @param outputTokens  输出 token 数
 * @returns { costUsd, costCny } 未配置定价时返回 0
 */
export function calcLlmCost(
  provider: string | undefined,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; costCny: number } {
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);

  const inputRes = resolvePricing({
    modelType: 'llm',
    provider,
    modelId,
    selections: { tokenType: 'input' },
  });
  const outputRes = resolvePricing({
    modelType: 'llm',
    provider,
    modelId,
    selections: { tokenType: 'output' },
  });

  let inputPerMillion = 0;
  let outputPerMillion = 0;
  if (inputRes.status === 'resolved' && inputRes.amount > 0) {
    inputPerMillion = inputRes.amount;
  } else if (inputRes.status === 'resolved' && typeof inputRes.entry.pricing.inputPerMillion === 'number') {
    inputPerMillion = inputRes.entry.pricing.inputPerMillion;
  }
  if (outputRes.status === 'resolved' && outputRes.amount > 0) {
    outputPerMillion = outputRes.amount;
  } else if (outputRes.status === 'resolved' && typeof outputRes.entry.pricing.outputPerMillion === 'number') {
    outputPerMillion = outputRes.entry.pricing.outputPerMillion;
  }

  const costUsd =
    ((input / 1_000_000) * inputPerMillion + (output / 1_000_000) * outputPerMillion) *
    getMarkup('llm');
  return { costUsd, costCny: toUsdCny(costUsd) };
}

/**
 * LLM 混合单价(用于 DB 聚合场景:仅有 token 总量,无法区分 input/output)
 *
 * 取 (inputPerMillion + outputPerMillion) / 2 作为近似单价。
 */
export function calcLlmBlendedCost(
  provider: string | undefined,
  modelId: string,
  totalTokens: number,
): { costUsd: number; costCny: number } {
  const total = Math.max(0, Number(totalTokens) || 0);
  const res = resolvePricing({ modelType: 'llm', provider, modelId });
  if (res.status !== 'resolved') return { costUsd: 0, costCny: 0 };
  const inputP = res.entry.pricing.inputPerMillion ?? 0;
  const outputP = res.entry.pricing.outputPerMillion ?? 0;
  const blended = (inputP + outputP) / 2;
  const costUsd = (total / 1_000_000) * blended * getMarkup('llm');
  return { costUsd, costCny: toUsdCny(costUsd) };
}

/**
 * 媒体(图像/视频/音频)成本
 *
 * @param modelType  image/video/audio
 * @param provider   服务商标识
 * @param modelId    模型 ID
 * @param count      生成数量
 * @param selections capability 档位(resolution/duration 等)
 */
export function calcMediaCost(
  modelType: Extract<PricingModelType, 'image' | 'video' | 'audio'>,
  provider: string | undefined,
  modelId: string,
  count: number,
  selections?: Record<string, CapabilityValue>,
): { costUsd: number; costCny: number } {
  const quantity = Math.max(0, Number(count) || 0);
  const res = resolvePricing({ modelType, provider, modelId, selections });
  if (res.status !== 'resolved') return { costUsd: 0, costCny: 0 };
  const costUsd = res.amount * quantity * getMarkup(modelType);
  return { costUsd, costCny: toUsdCny(costUsd) };
}

export function calcImageCost(
  provider: string | undefined,
  modelId: string,
  count: number,
  selections?: Record<string, CapabilityValue>,
) {
  return calcMediaCost('image', provider, modelId, count, selections);
}

export function calcVideoCost(
  provider: string | undefined,
  modelId: string,
  count: number,
  selections?: Record<string, CapabilityValue>,
) {
  return calcMediaCost('video', provider, modelId, count, selections);
}

export function calcAudioCost(
  provider: string | undefined,
  modelId: string,
  count: number,
  selections?: Record<string, CapabilityValue>,
) {
  return calcMediaCost('audio', provider, modelId, count, selections);
}
