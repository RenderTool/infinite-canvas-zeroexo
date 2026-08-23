/**
 * node-thumb.ts — 画布节点缩略图解析（@ 提及浮层 / 引用徽标共用）
 *
 * 媒体节点（图片/视频/音频）内容以 storageKey 持久化，展示小图走与
 * 节点视图一致的解析链：视频优先取首帧缩略图（persistence），其余走
 * resolveAnyThumbUrl（resources/ 走后端 sm 鉴权链路，本地键走 IndexedDB 缩略图）。
 * 解析失败返回 null，调用方回退为类型图标。
 */

import { resolveAnyThumbUrl } from '@zeroexo/plugin-nodes';
import { resolveVideoThumbnail } from '@zeroexo/plugin-persistence';

/** 简单模块级缓存：同一 storageKey 只解析一次（浮层轮询/多徽标复用） */
const thumbCache = new Map<string, string | null>();

export async function resolveNodeThumb(
  storageKey: string | undefined,
  type?: string,
): Promise<string | null> {
  if (!storageKey) return null;
  const cached = thumbCache.get(storageKey);
  if (cached !== undefined) return cached;

  let url: string | null = null;
  try {
    if (type === 'video') {
      url = (await resolveVideoThumbnail(storageKey).catch(() => null)) ?? null;
    }
    if (!url) {
      url = await resolveAnyThumbUrl(storageKey);
    }
  } catch {
    url = null;
  }
  thumbCache.set(storageKey, url);
  return url;
}
