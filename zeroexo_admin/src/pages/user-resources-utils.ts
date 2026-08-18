/**
 * user-resources-utils - 用户资源管理页面的常量与工具函数
 *
 * 包含素材类型/生成类型/生成状态的国际化标签映射，
 * 以及文件大小格式化、图片 URL 构建等纯函数。
 */
import { useEffect, useState } from 'react';
import { getAccessToken } from '@/services/api-client';

/** 素材类型 -> i18n key 映射 */
export const KIND_LABELS: Record<string, string> = {
  image: 'userResources.type.image',
  video: 'userResources.type.video',
  audio: 'userResources.type.audio',
  text: 'userResources.type.text',
};

/** 生成记录类型 -> i18n key 映射 */
export const GENERATION_KIND_LABELS: Record<string, string> = {
  text: 'userResources.type.text',
  image: 'userResources.type.image',
  video: 'userResources.type.video',
  audio: 'userResources.type.audio',
};

/** 生成记录状态 -> Tag 颜色映射 */
export const GENERATION_STATUS_COLORS: Record<string, string> = {
  success: 'green',
  failed: 'red',
  pending: 'orange',
  running: 'blue',
  cancelled: 'gray',
};

/** 将字节数格式化为易读的文件大小字符串 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 判断 storageKey 是否为需要认证的私有资源路径（后端仅对 resources/front/assets/ 前缀要求 JWT） */
export function isPrivateStorageKey(storageKey: string): boolean {
  return storageKey.startsWith('resources/front/assets/');
}

/**
 * 从 storageKey 构建缩略图 URL
 * 注意：不携带 token —— 避免 JWT 进入 URL query string（会进入浏览器历史/服务器日志/Referer）。
 * 私有资源请使用 useAuthorizedImageUrl 通过 Authorization header 加载。
 */
export function buildThumbUrl(storageKey: string): string {
  return `/api/storage/get?key=${encodeURIComponent(storageKey)}&size=thumb`;
}

/**
 * 从 storageKey 构建原图 URL
 * 注意：不携带 token —— 避免 JWT 进入 URL query string（会进入浏览器历史/服务器日志/Referer）。
 * 私有资源请使用 useAuthorizedImageUrl 通过 Authorization header 加载。
 */
export function buildImageUrl(storageKey: string): string {
  return `/api/storage/get?key=${encodeURIComponent(storageKey)}&size=full`;
}

/**
 * 私有资源(需要 JWT 认证)的图片 URL Hook：
 * 通过 fetch + Authorization header 加载资源并生成临时 blob URL，
 * 避免把 JWT 拼入 URL query string（会进入浏览器历史/服务器日志/Referer）。
 * 公开资源直接返回原 URL，无需请求；组件卸载或 storageKey 变化时自动 revokeObjectURL。
 */
export function useAuthorizedImageUrl(
  storageKey: string | null | undefined,
  size: 'thumb' | 'preview' | 'full' = 'full',
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!storageKey) {
      setUrl(undefined);
      return;
    }
    // blob URL / data URL 直接用于本地预览
    if (storageKey.startsWith('blob:') || storageKey.startsWith('data:')) {
      setUrl(storageKey);
      return;
    }
    const base = `/api/storage/get?key=${encodeURIComponent(storageKey)}&size=${size}`;
    // 公开资源无需认证，直接使用 URL
    if (!isPrivateStorageKey(storageKey)) {
      setUrl(base);
      return;
    }
    // 私有资源：fetch + Authorization header 加载，避免 JWT 进 query string
    const token = getAccessToken();
    if (!token) {
      setUrl(undefined);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(base, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error(`load failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(undefined);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storageKey, size]);

  return url;
}
