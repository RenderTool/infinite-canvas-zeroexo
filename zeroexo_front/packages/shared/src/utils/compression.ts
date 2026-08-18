/**
 * compression - 文本压缩工具函数
 *
 * 用于提示词压缩、空白清理等
 */

/** 压缩连续空白字符为单个空格 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 移除注释行（以 // 或 # 开头的行） */
export function removeCommentLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('#');
    })
    .join('\n');
}

/** 压缩提示词：移除多余空白和注释 */
export function compressPrompt(text: string): string {
  return collapseWhitespace(removeCommentLines(text));
}

/** 截断到指定最大字符数 */
export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}