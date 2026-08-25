/**
 * 点路径解析器 - DSL v2 通用工具
 *
 * 支持从响应对象中按点路径提取值：
 *   - "id"                    → obj.id
 *   - "data[0].url"           → obj.data[0].url
 *   - "content.video_url"     → obj.content.video_url
 *   - "data[0].task_result.images[0].url" → 嵌套数组
 *
 * 解析失败返回 undefined（不抛错，由调用方判断缺值）。
 */

/** 按点路径从对象中提取值，失败返回 undefined */
export function resolvePath(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object' || typeof path !== 'string') return undefined;
  if (path === '' || path === '.') return undefined;

  // 拆分为 token：支持 "data[0].url" / "task_result.images[0].url" 等
  const tokens: string[] = [];
  const re = /([^.\[\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else tokens.push(m[2]);
  }
  if (tokens.length === 0) return undefined;

  let current: any = obj;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    if (/^\d+$/.test(token)) {
      // 数组下标
      if (!Array.isArray(current)) return undefined;
      const idx = Number(token);
      if (idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
    } else {
      if (typeof current !== 'object') return undefined;
      if (!(token in current)) return undefined;
      current = current[token];
    }
  }
  return current;
}
