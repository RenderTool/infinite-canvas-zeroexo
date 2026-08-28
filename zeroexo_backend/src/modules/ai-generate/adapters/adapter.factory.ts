import { AiProviderAdapter } from './adapter.interface';
import { OpenAiAdapter } from './openai.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { StabilityAdapter } from './stability.adapter';
import { VolcengineAdapter } from './volcengine.adapter';
import { CustomAdapter } from './custom.adapter';
import { MockAdapter } from './mock.adapter';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest } from '../../../common/errors/app-exception.js';

/** 适配器实例缓存(无状态,可复用) */
const adapterCache = new Map<string, AiProviderAdapter>();

/**
 * 根据模板的 paramMapping/valueMapping 将前端参数映射为 API 参数。
 *
 * 映射表模式：
 * - paramMapping 中列出的参数 → key 映射为 API key
 * - paramMapping 中未列出的参数 → key 不变，直接传递
 * - UI 专用参数（sizeMode/resolution/aspectRatio/width/height）自动排除
 *
 * - paramMapping[frontendKey] = apiField  → key 映射
 * - valueMapping[frontendKey][value] = apiValue → value 映射
 *
 * @param params 适配器计算后的中间参数（前端 key）
 * @param template 模板配置（可选，无则仅排除 UI 参数）
 */
const UI_ONLY_KEYS = new Set([
  'sizeMode', 'resolution', 'aspectRatio', 'width', 'height',
]);

export function applyParamMapping(
  params: Record<string, any>,
  template?: { paramMapping?: Record<string, string>; valueMapping?: Record<string, Record<string, string>> },
): Record<string, any> {
  const result: Record<string, any> = {};
  const mapping = template?.paramMapping;
  const valueMapping = template?.valueMapping;

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    // UI 专用参数自动排除（模板在 paramMapping 中显式映射的除外，如视频 DSL 的 resolution）
    if (UI_ONLY_KEYS.has(key) && !mapping?.[key]) continue;

    // 有映射用映射，无映射用原 key
    const apiField = mapping?.[key] ?? key;

    // 值映射
    let apiValue = value;
    const valueMap = valueMapping?.[key];
    if (valueMap && typeof value === 'string' && value in valueMap) {
      apiValue = valueMap[value];
    }
    result[apiField] = apiValue;
  }
  return result;
}

/**
 * 适配器工厂 - P3.3
 * 根据渠道类型返回对应适配器实例(单例,无状态可复用)。
 */
export function getAdapter(provider: string): AiProviderAdapter {
  const cached = adapterCache.get(provider);
  if (cached) return cached;

  let adapter: AiProviderAdapter;
  switch (provider) {
    case 'openai':
    case 'deepseek':
    case 'siliconflow':
    case 'together':
    case 'groq':
    case 'fireworks':
      adapter = new OpenAiAdapter();
      break;
    case 'gemini':
      adapter = new GeminiAdapter();
      break;
    case 'stability':
      adapter = new StabilityAdapter();
      break;
    case 'volcengine':
      adapter = new VolcengineAdapter();
      break;
    case 'custom':
    // 百炼/DashScope(通义千问):模板 DSL 驱动(如 qwen-image 的 dashscope bodyStyle),
    // 无 DSL 时按 CustomAdapter 的 OpenAI 兼容兜底(征集 #83:渠道类型兼容)
    case 'bailian':
    case 'dashscope':
    case 'qwen':
      adapter = new CustomAdapter();
      break;
    case 'mock':
      adapter = new MockAdapter();
      break;
    default:
      throw badRequest(ErrorCode.BAD_REQUEST, `Unsupported channel type: ${provider}`);
  }
  adapterCache.set(provider, adapter);
  return adapter;
}
