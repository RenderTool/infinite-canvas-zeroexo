/**
 * 内置模型模板库（加载器）
 *
 * 每个模板族以独立 JSON 文件存储在 definitions/ 目录中。
 * 本文件负责扫描目录、加载并导出查询 API。
 *
 * 新增模板 → 在 definitions/ 下新建一个 .json 文件即可，无需改任何代码。
 * 每次查询直接从磁盘读取，不缓存，保证始终返回最新模板数据。
 *
 * 自定义模板（用户导入，存 DB）通过 setCustomTemplates 注入，
 * 查询 API 自动合并：自定义模板优先于内置模板匹配。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ModelTemplate } from './model-templates.types';

// ─── 目录路径 ──────────────────────────────────────────────────
const DEFINITIONS_DIR = path.join(__dirname, 'definitions');

// ─── 自定义模板（用户导入，由 TemplateRegistryService 注入） ────
let customTemplates: ModelTemplate[] = [];

/** 注入自定义模板列表（DB 变更时由 TemplateRegistryService 调用） */
export function setCustomTemplates(list: ModelTemplate[]): void {
  customTemplates = list ?? [];
}

/** 获取自定义模板列表 */
export function getCustomTemplates(): ModelTemplate[] {
  return customTemplates;
}

// ─── 模板标准化 ────────────────────────────────────────────────

/** 将单个原始模板对象处理为标准 ModelTemplate */
function normalizeTemplate(raw: any): ModelTemplate {
  // 移除 prompt 字段（必填项，在 ImageWorkbench 中独立处理）
  const parameters = Array.isArray(raw.parameters)
    ? raw.parameters.filter((p: any) => p.name !== 'prompt')
    : [];

  return {
    id: raw.id,
    name: raw.name,
    protocol: raw.protocol,
    modelType: raw.modelType,
    endpoint: raw.endpoint,
    maxPromptLength: raw.maxPromptLength,
    parameters,
    channelConstraints: raw.channelConstraints,
    // DSL v2 视频协议字段（可选）
    request: raw.request,
    sync: raw.sync,
    task: raw.task,
    auth: raw.auth,
    fallback: raw.fallback === true,
    pricing: raw.pricing ? { ...raw.pricing } : undefined,
    matchKeywords: raw.matchKeywords ? [...raw.matchKeywords] : undefined,
  };
}

// ─── 扫描与加载 ───────────────────────────────────────────────

/** 扫描 definitions 目录，加载所有 .json 文件 */
function scanAndLoad(): ModelTemplate[] {
  const results: ModelTemplate[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(DEFINITIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    console.warn('[templates] definitions 目录不存在:', DEFINITIONS_DIR);
    return results;
  }

  // 按文件名排序，保证加载顺序稳定
  files.sort();

  for (const file of files) {
    const filePath = path.join(DEFINITIONS_DIR, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const raw = JSON.parse(content);
      results.push(normalizeTemplate(raw));
    } catch (err) {
      console.warn(`[templates] 加载定义文件失败: ${file}`, (err as Error).message);
    }
  }
  return results;
}

// ─── 查询 API ─────────────────────────────────────────────────

/**
 * 返回所有模板（每次调用从磁盘重新读取，无缓存）
 * 自定义模板优先排列（recommend 匹配时自定义优先）
 */
export function getAllTemplates(): ModelTemplate[] {
  return [...customTemplates, ...scanAndLoad()];
}

/**
 * 按模型类型获取模板
 */
export function getTemplatesByType(modelType: string): ModelTemplate[] {
  return getAllTemplates().filter((t) => t.modelType === modelType);
}

/**
 * 按 ID 获取模板
 */
export function getTemplateById(id: string): ModelTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}

/**
 * 推荐匹配的模板
 * 根据模型 ID 中的关键词匹配最适合的模板
 * 优先级：自定义模板优先于内置；同一集合内匹配到的最长关键词优先（更具体的匹配优先）
 */
export function recommendTemplate(modelId: string, modelType: string): ModelTemplate | null {
  const lowerId = modelId.toLowerCase();

  // 关键词匹配（含候选排序：最长关键词优先）
  const matchByKeywords = (templates: ModelTemplate[]): ModelTemplate | null => {
    const candidates: Array<{ template: ModelTemplate; keywordLen: number }> = [];
    for (const t of templates) {
      const keywords = t.matchKeywords;
      if (!keywords || keywords.length === 0) continue;
      const matched = keywords.find((kw) => lowerId.includes(kw.toLowerCase()));
      if (matched) {
        candidates.push({ template: t, keywordLen: matched.length });
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.keywordLen - a.keywordLen);
    return candidates[0].template;
  };

  // 兜底模板（无关键词匹配时）
  const matchFallback = (templates: ModelTemplate[]): ModelTemplate | null =>
    templates.find((t) => t.fallback) ?? null;

  // 1. 自定义模板优先
  const custom = matchByKeywords(customTemplates.filter((t) => t.modelType === modelType));
  if (custom) return custom;
  const customFallback = matchFallback(customTemplates.filter((t) => t.modelType === modelType));
  if (customFallback) return customFallback;

  // 2. 内置模板
  const builtin = matchByKeywords(scanAndLoad().filter((t) => t.modelType === modelType));
  if (builtin) return builtin;
  return matchFallback(scanAndLoad().filter((t) => t.modelType === modelType));
}
