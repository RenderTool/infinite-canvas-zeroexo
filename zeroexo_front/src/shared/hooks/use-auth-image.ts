/**
 * useAuthImage - 带 JWT 认证的图片加载 hook
 *
 * 后端 storage/get 端点对私有资源(resources/front/assets/*)要求 JWT 认证,
 * 但 <img> 标签不会发送 Authorization header 导致 403。
 * 此 hook 通过 fetch + Bearer token 加载图片并创建 blob URL, 解决认证问题。
 */

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/services/api-client.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';

/**
 * 带认证的图片 URL hook
 * @param url 原始图片 URL(storage/get 端点)
 * @returns 可用于 <img src> 的 blob URL,加载失败返回 undefined
 */
export function useAuthImageUrl(url: string | undefined): string | undefined {
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
  const blobUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // 清理上一个 blob URL
    if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrlRef.current);
    }
    blobUrlRef.current = undefined;
    setBlobUrl(undefined);

    if (!url) return;

    // blob/data URL 无需认证,直接使用
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      blobUrlRef.current = url;
      setBlobUrl(url);
      return;
    }

    let cancelled = false;
    const token = getToken();

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!cancelled) {
          const newBlobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = newBlobUrl;
          setBlobUrl(newBlobUrl);
        }
      })
      .catch((err) => {
        console.warn('[useAuthImageUrl] fetch failed:', url, err);
        // 失败时保持 undefined, 由调用方处理 fallback 显示
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return blobUrl;
}

/**
 * 带认证的资源 URL hook —— 替代 getResourceUrl 的直接使用。
 *
 * 将 storageKey 通过 getResourceUrl 转为 URL 后,
 * 再用 useAuthImageUrl 携带 JWT token 获取图片 blob,
 * 解决 <img> 标签无法发送 Authorization header 的问题。
 *
 * @param storageKey 资源存储 key
 * @param size 图片尺寸(thumb/preview/full)
 * @returns 可用于 <img src> 的 blob URL,加载失败返回 undefined
 */
export function useAuthResourceUrl(
  storageKey: string | undefined,
  size: 'thumb' | 'preview' | 'full' = 'thumb',
): string | undefined {
  const url = storageKey ? getResourceUrl(storageKey, size) : undefined;
  return useAuthImageUrl(url);
}