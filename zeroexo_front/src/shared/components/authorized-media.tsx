/**
 * authorized-media - 带 JWT 认证的媒体渲染组件
 *
 * <img>/<video> 标签不会发送 Authorization header,导致私有资源(resources/front/ 前缀)返回 403。
 * 此处参考 use-auth-image.ts 的实现:fetch + Bearer token → blob URL → 渲染,并在卸载时 revokeObjectURL。
 *
 * 认证加载失败时回退到原始 URL,交由浏览器触发 onError,让调用方复用既有的降级逻辑。
 */

import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, VideoHTMLAttributes } from 'react';
import { getToken } from '@/services/api-client.js';

/** 带认证的资源加载:返回 { src, failed } */
function useAuthorizedMediaSrc(url: string | undefined): { src?: string; failed: boolean } {
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const blobUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    // 清理上一个 blob URL,避免内存泄漏
    if (blobUrlRef.current && blobUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(blobUrlRef.current);
    }
    blobUrlRef.current = undefined;
    setBlobUrl(undefined);
    setFailed(false);

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
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { src: blobUrl, failed };
}

/** 带认证的 <img>(私有资源经 fetch + Authorization header 加载)
 * 默认禁用浏览器原生拖拽(Plan#20 bug 修复:节点内图片可拖拽会被画布 drop 误判为素材投放触发上传;调用方可显式传 draggable 覆盖) */
export function AuthorizedImage(props: ImgHTMLAttributes<HTMLImageElement>): React.ReactElement {
  const { src, onError, draggable = false, ...rest } = props;
  const { src: authSrc, failed } = useAuthorizedMediaSrc(src);
  return (
    <img
      src={authSrc ?? (failed ? src : undefined)}
      onError={onError}
      draggable={draggable}
      {...rest}
    />
  );
}

/** 带认证的 <video>(私有资源经 fetch + Authorization header 加载) */
export function AuthorizedVideo(props: VideoHTMLAttributes<HTMLVideoElement>): React.ReactElement {
  const { src, onError, ...rest } = props;
  const { src: authSrc, failed } = useAuthorizedMediaSrc(src);
  return (
    <video
      src={authSrc ?? (failed ? src : undefined)}
      onError={onError}
      {...rest}
    />
  );
}
