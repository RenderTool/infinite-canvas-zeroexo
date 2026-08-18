/**
 * AI 模型拉取策略 — 运行时按 provider 读取 JSON 配置
 *
 * 设计目标：
 * - 各运营商的 API 端点、认证方式、响应结构都可配置
 * - 新增/修改运营商只需改 JSON 不动代码
 * - 运行时支持热读取（开发期 nest --watch 自动重载）
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface FetchStrategyResponse {
  /** JSON path to model array (e.g. "data", "models") */
  path: string;
  /** Field name for model ID */
  idField: string;
  /** Field name for display name */
  nameField: string;
  /** Optional filter — only keep models matching this condition */
  filter?: {
    /** Field to check (e.g. "supportedGenerationMethods") */
    field: string;
    /** Only keep models where field contains this value (e.g. "generateContent") */
    contains: string;
  };
}

export interface FetchStrategy {
  /** API endpoint for listing models (e.g. "/v1/models") */
  endpoint: string;
  /** HTTP method */
  method: 'GET' | 'POST';
  /** Request headers (supports {apiKey} template) */
  headers: Record<string, string>;
  /** Query parameters (supports {apiKey} template) */
  queryParams?: Record<string, string>;
  /** How to parse the response */
  response: FetchStrategyResponse;
  /** Alternative endpoint for health check (e.g. Anthropic uses /messages) */
  healthEndpoint?: string;
  /** Alternative method for health check */
  healthMethod?: 'GET' | 'POST';
  /** Request body for health check (when healthMethod is POST) */
  healthBody?: Record<string, any>;
  /** Whether to auto-append /v1 prefix (for custom/openai-compatible) */
  autoAppendV1?: boolean;
}

export interface FetchStrategiesFile {
  version: number;
  updatedAt: string;
  description?: string;
  strategies: Record<string, FetchStrategy>;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

let _strategiesCache: { data: FetchStrategiesFile; timestamp: number } | null = null;
const CACHE_TTL = 60_000; // 60 秒
let _configPath: string | null = null;

/** 获取策略 JSON 文件路径（优先使用环境变量，默认 dev 路径） */
function getConfigPath(): string {
  if (_configPath) return _configPath;
  // 开发期和编译后 cwd 都是 zeroexo_backend/
  _configPath =
    process.env.AI_FETCH_STRATEGIES_PATH ||
    resolve(process.cwd(), 'config', 'ai-fetch-strategies.json');
  return _configPath;
}

/** 读取并解析策略配置（带 TTL 缓存，60 秒过期） */
export function loadFetchStrategies(): FetchStrategiesFile {
  const now = Date.now();
  if (_strategiesCache && now - _strategiesCache.timestamp < CACHE_TTL) {
    return _strategiesCache.data;
  }
  const filePath = getConfigPath();
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as FetchStrategiesFile;
    _strategiesCache = { data, timestamp: now };
    return data;
  } catch (err) {
    // 读取失败时返回空策略（不影响渠道基本运行）
    console.warn(
      `[FetchStrategies] 读取失败: ${filePath}`,
      err instanceof Error ? err.message : String(err),
    );
    return { version: 0, updatedAt: '', strategies: {} };
  }
}

/** 获取指定 provider 的拉取策略 */
export function getFetchStrategy(provider: string): FetchStrategy | undefined {
  const file = loadFetchStrategies();
  return file.strategies[provider];
}

/** 获取所有已定义的 provider */
export function getConfiguredProviders(): string[] {
  const file = loadFetchStrategies();
  return Object.keys(file.strategies);
}

/**
 * 渲染请求头 — 替换 {apiKey} 模板变量
 */
export function renderHeaders(
  headers: Record<string, string>,
  apiKey: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = value.replace(/\{apiKey\}/g, apiKey);
  }
  return result;
}

/**
 * 渲染查询参数 — 替换 {apiKey} 模板变量
 */
export function renderQueryParams(
  params: Record<string, string> | undefined,
  apiKey: string,
): Record<string, string> | undefined {
  if (!params) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    result[key] = value.replace(/\{apiKey\}/g, apiKey);
  }
  return result;
}

/**
 * 根据策略配置从 JSON 响应中提取模型 ID 列表
 */
export function extractModelIds(
  json: Record<string, any>,
  strategy: FetchStrategy,
): string[] {
  const { path, idField, filter } = strategy.response;
  const arr = getNestedValue(json, path);

  if (!Array.isArray(arr)) return [];

  let models = arr.map((item: any) => {
    const id = String(item[idField] ?? '');
    return id.replace(/^models\//, '');
  }).filter(Boolean);

  // 应用过滤器
  if (filter) {
    models = models.filter((_id, index) => {
      const item = arr[index];
      const fieldValue = getNestedValue(item, filter.field);
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => String(v).includes(filter.contains));
      }
      return String(fieldValue ?? '').includes(filter.contains);
    });
  }

  return models;
}

/** 简易嵌套取值：支持 "a.b.c" 路径 */
function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}
