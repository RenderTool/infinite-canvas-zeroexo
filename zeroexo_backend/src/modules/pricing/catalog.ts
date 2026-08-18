/**
 * 定价目录加载器 — 参考 waoowaoo src/lib/model-pricing/catalog.ts
 *
 * 存储: 静态 JSON 文件(standards/pricing/*.json),运行时加载 + 模块级缓存 + 启动校验。
 * 不可在线编辑,更新需改文件重启。符合"定价独立于配置"约束。
 *
 * 唯一键: `${modelType}::${provider}::${modelId}`
 * 价格单位: USD(llm 为 USD/百万 token;image/video/audio 为 USD/次)
 *
 * 价格来源: 各服务商官方公开价(2024-2025),仅供估算参考。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 本项目支持的模型类型 */
export type PricingModelType = 'llm' | 'image' | 'video' | 'audio';

export type CapabilityValue = string | number | boolean;

/** capability 模式档位:满足 when 全部条件时取 amount */
export interface PricingTier {
  when: Record<string, CapabilityValue>;
  amount: number;
}

/**
 * 定价定义
 * - flat: 固定单价
 *   - llm: inputPerMillion / outputPerMillion(USD/百万 token)
 *   - image/video/audio: flatAmount(USD/次)
 * - capability: 按 capability 档位(resolution/duration 等)取价
 */
export interface PricingDefinition {
  mode: 'flat' | 'capability';
  flatAmount?: number;
  inputPerMillion?: number;
  outputPerMillion?: number;
  tiers?: PricingTier[];
}

export interface PricingCatalogEntry {
  modelType: PricingModelType;
  provider: string;
  modelId: string;
  pricing: PricingDefinition;
}

interface PricingCatalogCache {
  entries: PricingCatalogEntry[];
  /** key: `${modelType}::${provider}::${modelId}` */
  exact: Map<string, PricingCatalogEntry>;
  /** key: `${modelType}::${modelId}` → 同名候选(provider 未指定时回退) */
  byModelId: Map<string, PricingCatalogEntry[]>;
}

const PRICING_CATALOG_DIR = path.resolve(process.cwd(), 'standards/pricing');

let cache: PricingCatalogCache | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isModelType(value: unknown): value is PricingModelType {
  return value === 'llm' || value === 'image' || value === 'video' || value === 'audio';
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeTier(raw: unknown, filePath: string, index: number, tierIndex: number): PricingTier {
  if (!isRecord(raw)) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.tiers[${tierIndex}] must be object`);
  }
  const whenRaw = raw.when;
  if (!isRecord(whenRaw) || Object.keys(whenRaw).length === 0) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.tiers[${tierIndex}].when must be non-empty object`);
  }
  const when: Record<string, CapabilityValue> = {};
  for (const [field, value] of Object.entries(whenRaw)) {
    if (!isCapabilityValue(value)) {
      throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.tiers[${tierIndex}].when.${field} must be string/number/boolean`);
    }
    when[field] = value;
  }
  const amount = readFiniteNumber(raw.amount);
  if (amount === null || amount < 0) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.tiers[${tierIndex}].amount must be finite number >= 0`);
  }
  return { when, amount };
}

function normalizePricing(raw: unknown, filePath: string, index: number): PricingDefinition {
  if (!isRecord(raw)) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.pricing must be object`);
  }
  const modeRaw = raw.mode;
  if (modeRaw !== 'flat' && modeRaw !== 'capability') {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.pricing.mode must be flat or capability`);
  }

  if (modeRaw === 'flat') {
    const flatAmount = readFiniteNumber(raw.flatAmount);
    const inputPerMillion = readFiniteNumber(raw.inputPerMillion);
    const outputPerMillion = readFiniteNumber(raw.outputPerMillion);
    // llm 至少要有 input/output;image/video/audio 至少要有 flatAmount
    const def: PricingDefinition = { mode: 'flat' };
    if (flatAmount !== null && flatAmount >= 0) def.flatAmount = flatAmount;
    if (inputPerMillion !== null && inputPerMillion >= 0) def.inputPerMillion = inputPerMillion;
    if (outputPerMillion !== null && outputPerMillion >= 0) def.outputPerMillion = outputPerMillion;
    if (def.flatAmount === undefined && def.inputPerMillion === undefined && def.outputPerMillion === undefined) {
      throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.pricing flat 模式需提供 flatAmount 或 inputPerMillion/outputPerMillion`);
    }
    return def;
  }

  const tiersRaw = raw.tiers;
  if (!Array.isArray(tiersRaw) || tiersRaw.length === 0) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.pricing.tiers must be a non-empty array`);
  }
  const tiers = tiersRaw.map((tier, tierIndex) => normalizeTier(tier, filePath, index, tierIndex));
  return { mode: 'capability', tiers };
}

function normalizeEntry(raw: unknown, filePath: string, index: number): PricingCatalogEntry {
  if (!isRecord(raw)) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index} must be object`);
  }
  const modelTypeRaw = raw.modelType;
  if (!isModelType(modelTypeRaw)) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.modelType must be one of llm/image/video/audio`);
  }
  const provider = readTrimmedString(raw.provider);
  const modelId = readTrimmedString(raw.modelId);
  if (!provider || !modelId) {
    throw new Error(`PRICING_CATALOG_INVALID: ${filePath}#${index}.provider/modelId are required`);
  }
  const pricing = normalizePricing(raw.pricing, filePath, index);
  return { modelType: modelTypeRaw, provider, modelId, pricing };
}

function buildCache(entries: PricingCatalogEntry[]): PricingCatalogCache {
  const exact = new Map<string, PricingCatalogEntry>();
  const byModelId = new Map<string, PricingCatalogEntry[]>();
  for (const entry of entries) {
    const exactKey = `${entry.modelType}::${entry.provider}::${entry.modelId}`;
    if (exact.has(exactKey)) {
      throw new Error(`PRICING_CATALOG_DUPLICATE: ${exactKey}`);
    }
    exact.set(exactKey, entry);
    const modelIdKey = `${entry.modelType}::${entry.modelId}`;
    const group = byModelId.get(modelIdKey) || [];
    group.push(entry);
    byModelId.set(modelIdKey, group);
  }
  return { entries, exact, byModelId };
}

function cloneEntry(entry: PricingCatalogEntry): PricingCatalogEntry {
  return JSON.parse(JSON.stringify(entry)) as PricingCatalogEntry;
}

function loadPricingCatalog(): PricingCatalogCache {
  if (cache) return cache;
  const files = fs
    .readdirSync(PRICING_CATALOG_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(PRICING_CATALOG_DIR, entry.name));
  if (files.length === 0) {
    throw new Error(`PRICING_CATALOG_MISSING: no json file in ${PRICING_CATALOG_DIR}`);
  }
  const entries: PricingCatalogEntry[] = [];
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`PRICING_CATALOG_INVALID: ${filePath} must be array`);
    }
    for (let index = 0; index < parsed.length; index += 1) {
      entries.push(normalizeEntry(parsed[index], filePath, index));
    }
  }
  cache = buildCache(entries);
  return cache;
}

/** 列出全部定价条目(供前端只读展示) */
export function listPricingCatalog(): PricingCatalogEntry[] {
  return loadPricingCatalog().entries.map(cloneEntry);
}

/** 精确查询(带 modelType + provider + modelId) */
export function findPricingCatalogEntry(
  modelType: PricingModelType,
  provider: string,
  modelId: string,
): PricingCatalogEntry | null {
  const loaded = loadPricingCatalog();
  const exactKey = `${modelType}::${provider}::${modelId}`;
  const entry = loaded.exact.get(exactKey);
  return entry ? cloneEntry(entry) : null;
}

/** 按 modelType + modelId 查询候选(provider 未知时使用) */
export function findPricingCatalogEntriesByModelId(
  modelType: PricingModelType,
  modelId: string,
): PricingCatalogEntry[] {
  const modelIdKey = `${modelType}::${modelId}`;
  const entries = loadPricingCatalog().byModelId.get(modelIdKey) || [];
  return entries.map(cloneEntry);
}

/** 测试用:重置缓存 */
export function resetPricingCatalogCacheForTest(): void {
  cache = null;
}
