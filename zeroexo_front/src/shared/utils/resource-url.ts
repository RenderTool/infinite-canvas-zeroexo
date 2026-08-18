/**
 * 资源 URL 工具 —— 把 storageKey 转成可显示的 URL
 *
 * - 后端 key(resources/ 开头)→ backendImageUrl(支持 size 参数)
 * - 本地 dataUrl / http(s) / blob / 相对路径 → 原样返回
 * - 空值 → 返回 undefined
 */

import { backendImageUrl, isBackendKey } from '@/services/backend-upload.js';

export function getResourceUrl(
  storageKey: string | undefined,
  size: 'thumb' | 'preview' | 'full' = 'thumb',
): string | undefined {
  if (!storageKey) return undefined;
  if (isBackendKey(storageKey)) {
    return backendImageUrl(storageKey, size);
  }
  // dataUrl / http(s) / blob / 相对路径直接返回
  if (
    storageKey.startsWith('data:') ||
    storageKey.startsWith('http://') ||
    storageKey.startsWith('https://') ||
    storageKey.startsWith('blob:') ||
    storageKey.startsWith('/')
  ) {
    return storageKey;
  }
  return undefined;
}
