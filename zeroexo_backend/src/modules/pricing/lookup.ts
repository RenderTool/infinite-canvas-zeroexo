/**
 * 定价解析 — 参考 waoowaoo src/lib/model-pricing/lookup.ts
 *
 * resolvePricing: 按 (modelType, provider, modelId) 定位条目,
 * 再按 selections(flat 直接取 / capability 匹配档位)解析最终单价。
 */
import {
  findPricingCatalogEntriesByModelId,
  findPricingCatalogEntry,
  type CapabilityValue,
  type PricingCatalogEntry,
  type PricingModelType,
} from './catalog';

export interface PricingResolutionResolved {
  status: 'resolved';
  entry: PricingCatalogEntry;
  amount: number;
  mode: 'flat' | 'capability';
}

export interface PricingResolutionNotConfigured {
  status: 'not_configured';
}

export interface PricingResolutionAmbiguousModel {
  status: 'ambiguous_model';
  modelType: PricingModelType;
  modelId: string;
  candidates: PricingCatalogEntry[];
}

export interface PricingResolutionMissingCapabilityMatch {
  status: 'missing_capability_match';
  entry: PricingCatalogEntry;
  selections: Record<string, CapabilityValue>;
}

export type PricingResolution =
  | PricingResolutionResolved
  | PricingResolutionNotConfigured
  | PricingResolutionAmbiguousModel
  | PricingResolutionMissingCapabilityMatch;

function cloneSelections(raw: Record<string, CapabilityValue> | undefined): Record<string, CapabilityValue> {
  if (!raw) return {};
  const next: Record<string, CapabilityValue> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[field] = value;
    }
  }
  return next;
}

/** capability 模式:遍历 tiers,首个 when 全匹配的取其 amount */
function matchTier(
  entry: PricingCatalogEntry,
  selections: Record<string, CapabilityValue>,
): number | null {
  const tiers = entry.pricing.tiers || [];
  for (const tier of tiers) {
    const matched = Object.entries(tier.when).every(
      ([field, expected]) => selections[field] === expected,
    );
    if (matched) return tier.amount;
  }
  return null;
}

function resolveEntryByModel(
  modelType: PricingModelType,
  provider: string | undefined,
  modelId: string,
): { entry: PricingCatalogEntry } | { ambiguous: PricingCatalogEntry[] } | { none: true } {
  if (provider) {
    const exact = findPricingCatalogEntry(modelType, provider, modelId);
    if (exact) return { entry: exact };
    return { none: true };
  }
  const candidates = findPricingCatalogEntriesByModelId(modelType, modelId);
  if (candidates.length === 0) return { none: true };
  if (candidates.length > 1) return { ambiguous: candidates };
  return { entry: candidates[0] };
}

/**
 * 解析定价
 *
 * @param input.modelType    模型类型
 * @param input.provider     服务商标识(可选,未知时按 modelId 回退,多候选返回 ambiguous)
 * @param input.modelId      模型 ID
 * @param input.selections   capability 档位条件(resolution/duration 等);llm 可用 tokenType: 'input'|'output'
 */
export function resolvePricing(input: {
  modelType: PricingModelType;
  provider?: string;
  modelId: string;
  selections?: Record<string, CapabilityValue>;
}): PricingResolution {
  const entryResolution = resolveEntryByModel(input.modelType, input.provider, input.modelId);
  if ('none' in entryResolution) return { status: 'not_configured' };
  if ('ambiguous' in entryResolution) {
    return {
      status: 'ambiguous_model',
      modelType: input.modelType,
      modelId: input.modelId,
      candidates: entryResolution.ambiguous,
    };
  }

  const { entry } = entryResolution;

  if (entry.pricing.mode === 'flat') {
    // llm: 按 tokenType 取 input/output 单价;无 tokenType 时返回条目(amount 由调用方按字段取)
    if (entry.modelType === 'llm') {
      const tokenType = input.selections?.tokenType;
      if (tokenType === 'input' && typeof entry.pricing.inputPerMillion === 'number') {
        return { status: 'resolved', entry, amount: entry.pricing.inputPerMillion, mode: 'flat' };
      }
      if (tokenType === 'output' && typeof entry.pricing.outputPerMillion === 'number') {
        return { status: 'resolved', entry, amount: entry.pricing.outputPerMillion, mode: 'flat' };
      }
      // 未指定 tokenType:返回条目,amount 给 0,由调用方按 input/output 分别取
      return { status: 'resolved', entry, amount: 0, mode: 'flat' };
    }
    // image/video/audio: flatAmount
    if (typeof entry.pricing.flatAmount === 'number') {
      return { status: 'resolved', entry, amount: entry.pricing.flatAmount, mode: 'flat' };
    }
    return {
      status: 'missing_capability_match',
      entry,
      selections: cloneSelections(input.selections),
    };
  }

  // capability 模式
  const selections = cloneSelections(input.selections);
  const amount = matchTier(entry, selections);
  if (amount === null) {
    return { status: 'missing_capability_match', entry, selections };
  }
  return { status: 'resolved', entry, amount, mode: 'capability' };
}
