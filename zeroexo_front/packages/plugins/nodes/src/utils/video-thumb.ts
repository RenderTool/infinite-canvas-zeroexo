/**
 * video-thumb - 视频缩略图统一回退链(堆叠导航/生成器参考栏/@引用共用)
 *
 * 回退顺序:
 * 1. 已持久化缩略图(video-node-view 上传/生成时经 storeVideoThumbnail 存入 localforage)
 * 2. 缩略图级 URL(resources/ 后端 size=thumb 认证链路 / persistence 缩略图)
 * 3. hydrate 完整内容后 canvas 抓首帧(crossOrigin anonymous,跨源 tainted 静默降级)
 * 4. null —— 调用方回退图标,不渲染黑块
 *
 * 全链路模块级缓存,同一 src 不重复解码/请求。
 */

import { useEffect, useState } from 'react';
import { resolveVideoThumbnail } from '@zeroexo/plugin-persistence';
import { resolveAnyThumbUrl, resolveContentUrl } from './hydrate.js';

/** 首帧抓取缓存(按 hydrate 后 src 键控) */
const FRAME_CACHE = new Map<string, string>();

/** 抓取视频首帧为 JPEG dataURL;解码失败/跨域 tainted/超时返回 null */
async function captureVideoFrame(url: string): Promise<string | null> {
  const cached = FRAME_CACHE.get(url);
  if (cached) return cached;
  return new Promise<string | null>((resolve) => {
    const vid = document.createElement('video');
    vid.muted = true;
    vid.preload = 'auto';
    vid.playsInline = true;
    vid.crossOrigin = 'anonymous';
    let settled = false;
    const done = (v: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      vid.removeAttribute('src');
      vid.load();
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 8000);
    vid.onloadeddata = () => {
      // 跳到 0.5s 抓帧(比首帧更可靠,避免部分视频首帧黑屏)
      try { vid.currentTime = Math.min(0.5, (vid.duration || 0.5) / 2); } catch { /* 用首帧 */ }
    };
    vid.onseeked = () => {
      try {
        const w = vid.videoWidth; const h = vid.videoHeight;
        if (!w || !h) { done(null); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { done(null); return; }
        ctx.drawImage(vid, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        FRAME_CACHE.set(url, dataUrl);
        done(dataUrl);
      } catch { /* 跨域 tainted/解码失败 */ done(null); }
    };
    vid.onerror = () => done(null);
    vid.src = url;
  });
}

/**
 * 视频缩略图回退链(非 hook,供批量解析使用)。
 * @returns 可渲染的缩略图 URL;null 表示无缩略图,调用方回退图标
 */
export async function resolveVideoThumbUrl(
  storageKey: string | undefined,
  content: string | undefined,
): Promise<string | null> {
  if (storageKey) {
    // 1. video-node-view 已持久化的缩略图(刷新后无需加载视频)
    try {
      const persisted = await resolveVideoThumbnail(storageKey);
      if (persisted) return persisted;
    } catch { /* 继续下一级 */ }
    // 2. 后端/本地缩略图级资源
    const thumb = await resolveAnyThumbUrl(storageKey);
    if (thumb) return thumb;
  }
  // 3. hydrate 完整内容后抓首帧(最后手段,需下载媒体)
  const src = await resolveContentUrl(storageKey, content ?? '');
  if (!src) return null;
  return captureVideoFrame(src);
}

/** hook 封装:视频缩略图回退链;undefined 表示未就绪或无缩略图(调用方回退图标) */
export function useVideoThumbUrl(
  storageKey: string | undefined,
  content: string | undefined,
): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!storageKey && !content) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    resolveVideoThumbUrl(storageKey, content).then((u) => {
      if (!cancelled) setUrl(u ?? undefined);
    });
    return () => { cancelled = true; };
  }, [storageKey, content]);
  return url;
}
