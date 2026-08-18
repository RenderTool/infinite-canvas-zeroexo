/**
 * AI 品牌详情相关工具函数
 */
import { BRAND_ICONS, DefaultBrandIcon } from './brand-icons';

/**
 * 防抖工具函数（支持异步函数）
 *
 * 在指定延迟内若再次调用，会取消前一次尚未执行的定时器，
 * 仅以最后一次调用为准。
 *
 * @param fn 需要防抖的函数（可为 async）
 * @param delay 延迟毫秒数
 */
export const debounce = <T extends (...args: any[]) => Promise<void>>(
  fn: T,
  delay: number,
): T => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, delay);
  }) as T;
};

/**
 * 根据图标 key 获取对应的品牌图标组件
 *
 * 若未提供 key 或 key 不在 BRAND_ICONS 中，则返回默认品牌图标。
 *
 * @param iconKey 图标 key（与 BRAND_ICONS 的 key 对应，通常是品牌 provider 名）
 */
export function getModelIconComponent(iconKey: string | undefined) {
  if (!iconKey) return DefaultBrandIcon;
  return BRAND_ICONS[iconKey] || DefaultBrandIcon;
}
