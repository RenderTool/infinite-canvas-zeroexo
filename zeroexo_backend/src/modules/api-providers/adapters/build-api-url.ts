/**
 * 构建完整 API URL — 运行时自动检测并补充版本路径
 *
 * 设计原则（参考 infinite-canvas 的 buildApiUrl）:
 * - baseUrl 不硬编码版本路径（如 /v1, /v1beta）
 * - 如果用户已填写包含版本路径的 URL，保持原样不重复追加
 * - 否则按 provider 类型自动追加正确的版本路径
 *
 * 已识别的版本路径模式:
 *   /v1, /v2, /v3, /v1beta, /v1alpha, /api/v3 等
 */

/** 匹配 URL 中已有的版本路径段 */
const VERSION_PATTERN = /\/v\d+(?:beta|alpha)?(?:\/|$)|\/api\/v\d+(?:\/|$)/i;

/** 各 provider 的默认版本路径 */
const PROVIDER_VERSIONS: Record<string, string> = {
  openai: '/v1',
  deepseek: '/v1',
  bailian: '/v1',
  custom: '/v1',
  siliconflow: '/v1',
  anthropic: '/v1',
  gemini: '/v1beta',
  'gemini-cn': '/v1beta',
  volcengine: '/api/v3',
  stability: '/v2beta/stable-image',
};

/**
 * 确保 baseUrl 包含正确的版本路径
 *
 * @param baseUrl 用户配置的 API 地址（可能包含或不包含版本路径）
 * @param provider 服务商标识
 * @returns 包含版本路径的完整 baseUrl
 */
export function buildApiUrl(baseUrl: string, provider: string): string {
  // 去除尾部斜杠
  const url = baseUrl.replace(/\/+$/, '');

  // 如果 URL 已包含版本路径，直接返回
  if (VERSION_PATTERN.test(url)) {
    return url;
  }

  // 按 provider 追加默认版本路径
  const version = PROVIDER_VERSIONS[provider];
  if (version) {
    return `${url}${version}`;
  }

  // 未知 provider 默认追加 /v1（OpenAI 兼容）
  return `${url}/v1`;
}
