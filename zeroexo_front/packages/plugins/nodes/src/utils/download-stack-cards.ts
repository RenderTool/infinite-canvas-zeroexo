/**
 * 堆叠卡片批量下载(征集 #78:堆叠节点胶囊「批量下载」按钮)
 *
 * - 媒体卡(图片/视频/音频):经 resolveContentUrl 兜底失效 blob(刷新后 content 失效场景),
 *   下载二进制,文件名 = 卡片标题.扩展名(扩展名取 mimeType)
 * - 文本卡:content → .txt
 * - 逐个错峰触发(350ms),避免浏览器拦截多文件下载
 */

import { resolveContentUrl } from './hydrate.js';
import type { StackCard } from '../nodes/stacked-media-types.js';

/** 触发浏览器下载(锚点点击);revoke=true 时点击后释放临时 blob URL */
function triggerDownload(url: string, filename: string, revoke = false): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revoke) URL.revokeObjectURL(url);
}

/** 批量下载堆叠全部卡片,返回实际下载数量 */
export async function downloadStackCards(cards: StackCard[]): Promise<number> {
  let count = 0;
  for (const card of cards) {
    const data = (card.data ?? {}) as Record<string, unknown>;
    const baseName = (card.title ?? '').trim();

    if (card.sourceType === 'text') {
      const text = (data.content as string) ?? '';
      if (!text.trim()) continue;
      triggerDownload(
        URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })),
        `${baseName || '文本'}.txt`,
        true,
      );
      count += 1;
    } else {
      const content = (data.content as string) ?? '';
      const storageKey = data.storageKey as string | undefined;
      if (!content && !storageKey) continue;
      // resolveContentUrl:后端键走认证链路重建,本地键走 persistence;均失败时回退原 content
      const url = await resolveContentUrl(storageKey, content);
      if (!url) continue;
      const mimeType = (data.mimeType as string) || '';
      const ext = mimeType ? (mimeType.split('/')[1] || 'bin') : 'bin';
      triggerDownload(url, `${baseName || `卡片${count + 1}`}.${ext}`);
      count += 1;
    }

    await new Promise((r) => setTimeout(r, 350));
  }
  return count;
}
