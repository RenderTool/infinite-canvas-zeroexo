/**
 * api-error - 后端错误码翻译工具(B2)
 *
 * 架构: 后端返回稳定错误码(code)+英文 message 兜底,前端按用户语言翻译。
 * 用法:
 *   message.error(translateApiError(err));
 *   message.error(translateApiError(codeOrErr));
 *
 * 规则:
 *   - 对象含 code 且词条命中 `errors.<CODE>` → 返回翻译
 *   - 否则回退 err.message(后端英文兜底)
 *   - 兜底 errors.INTERNAL_SERVER_ERROR
 */

import i18n from '@/i18n/config';

/** 从任意错误对象中提取后端错误码 */
function extractCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const e = err as { code?: string };
    if (typeof e.code === 'string' && e.code) return e.code;
  }
  return undefined;
}

/** 翻译后端错误(可传入 ApiError / SSE payload / 纯错误码字符串) */
export function translateApiError(err: unknown): string {
  const code = typeof err === 'string' ? err : extractCode(err);
  if (code) {
    const key = `errors.${code}`;
    const translated = i18n.t(key);
    // i18next 未命中时返回 key 本身,回退英文兜底
    if (translated && translated !== key) {
      return translated;
    }
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (message && message !== 'undefined' && message !== 'null') {
    return message;
  }
  return i18n.t('errors.INTERNAL_SERVER_ERROR');
}
