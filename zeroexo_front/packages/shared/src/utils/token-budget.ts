/**
 * token-budget - Token 预算工具函数
 *
 * 估算文本 token 数量，用于提示词长度预算控制
 */

/** 粗略估算 token 数量（中文约 1.5 token/字，英文约 0.25 token/字符） */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const char of text) {
    // 中文字符范围
    if (char >= '\u4e00' && char <= '\u9fff') {
      count += 1.5;
    } else {
      count += 0.25;
    }
  }
  return Math.ceil(count);
}

/** 检查文本是否在 token 预算内 */
export function isWithinTokenBudget(text: string, budget: number): boolean {
  return estimateTokenCount(text) <= budget;
}

/** 截断文本到指定 token 预算 */
export function truncateToTokenBudget(text: string, budget: number): string {
  if (!text || isWithinTokenBudget(text, budget)) return text;
  // 简单二分查找截断点
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokenCount(text.slice(0, mid)) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low) + '...';
}