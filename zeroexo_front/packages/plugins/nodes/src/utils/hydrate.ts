/**
 * hydrate - storageKey → blob URL 重建(Phase D2.6)
 *
 * 问题: 节点 data.content 存的是 blob URL(URL.createObjectURL),
 * 刷新页面后 blob URL 失效,图片/视频/音频无法显示。
 *
 * 1. 节点 data 同时保存 storageKey(如 'image:xxx')
 * 2. 节点视图用 useHydratedContent(storageKey, content) 获取渲染 URL
 * 3. hook 在 mount 时检查 storageKey,若存在则通过 persistence 插件
 *    resolveImageUrl/resolveMediaUrl 重建 blob URL(有内存缓存,不重复创建)
 * 4. 若 storageKey 不存在(如 AI 生成的临时内容),直接用 content
 *
 * 渐进式加载(Phase VI.4):
 * - useProgressiveImage 根据视口缩放决定加载缩略图或预览图(画布节点永不加载原图,
 *   征集 #77 用户拍板:原图只在图片浏览器中使用)
 * - 缩小(invK >= PROGRESSIVE_THRESHOLD)时仅加载缩略图,大幅降低内存占用
 * - 放大时加载 preview 级(后端无变体自动回退原图,旧图兼容零迁移)
 * - usePreviewImage 为大槽位(堆叠详情面板/堆叠活跃卡)提供 preview 级展示图,
 *   同样永不主动拉原图,旧数据无变体时经后端回退/本地兜底链展示原图(兼容唯一出口)
 */

import { useEffect, useRef, useState } from 'react';
import { resolveImageUrl, resolveMediaUrl, resolveThumbnailUrl, resolvePreviewUrl } from '@zeroexo/plugin-persistence';
import { getToken } from '@/services/api-client.js';

/** 后端媒体 URL 内存缓存(key = 原始 URL, value = 认证后的 blob URL),避免同一资源重复 fetch */
const backendUrlCache = new Map<string, string>();

/** 进行中认证请求去重(同 URL 并发挂载多节点时只发一次 fetch) */
const inflightAuth = new Map<string, Promise<string | null>>();

/** 全局媒体认证并发上限:大视口下可见节点众多时防止瞬时 burst 撞限流 */
const MAX_MEDIA_FETCH = 6;
let activeMediaFetch = 0;
const mediaFetchQueue: Array<() => void> = [];

function runWithMediaLimit<T>(fn: () => Promise<T>, priority = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = (): void => {
      activeMediaFetch++;
      fn().then(
        (v) => { activeMediaFetch--; mediaFetchQueue.shift()?.(); resolve(v); },
        (e) => { activeMediaFetch--; mediaFetchQueue.shift()?.(); reject(e); },
      );
    };
    // priority(图片浏览器等交互主路径)插队立即执行,避免被画布节点的批量拉取饿死(征集 #84 黑屏根因之一)
    if (priority || activeMediaFetch < MAX_MEDIA_FETCH) start();
    else mediaFetchQueue.push(start);
  });
}

/** 429 退避重试(优先尊重 Retry-After 头,否则指数退避;最多 2 次) */
async function fetchMediaWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 0; i < retries && res.status === 429; i++) {
    const retryAfterSec = Number(res.headers.get('Retry-After') ?? 0);
    const waitMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** i;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await fetch(url, init);
  }
  return res;
}

/**
 * 带 JWT 认证的媒体 URL: fetch + Authorization header → blob URL
 * <img>/<video>/<audio> 标签不会发送 Authorization header,私有资源(resources/front/ 前缀)
 * 直接使用 URL 会返回 403,需先经 fetch 携带 token 换取 blob URL 再渲染。
 * 失败返回 null,由调用方降级到 content(可能是 blob/data URL)。
 * 护栏:全局并发上限 + 同 URL 去重 + 429 退避重试(按需加载下可见节点可能很多)。
 */
async function authorizeMediaUrl(url: string, priority = false): Promise<string | null> {
  const cached = backendUrlCache.get(url);
  if (cached) return cached;
  const pending = inflightAuth.get(url);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    try {
      // token 在出队执行时读取(排队期间可能已完成无感刷新)
      const res = await runWithMediaLimit(() => {
        const token = getToken();
        return fetchMediaWithRetry(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      }, priority);
      if (!res.ok) return null;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      backendUrlCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      inflightAuth.delete(url);
    }
  })();

  inflightAuth.set(url, task);
  return task;
}

/** 缩略图阈值: invK ≥ 4(k ≤ 0.25)时只用缩略图;低于阈值一律 preview 级(征集 #77 后无 full 档) */
const THUMBNAIL_THRESHOLD = 4;

/** 像素预算档位(Plan#48 纯前端方案):thumb/sm 用后端既有变体,w256/w512 由前端 createImageBitmap 缩放补桶 */
export type ImageTier = 'thumb' | 'sm' | 'w256' | 'w512' | 'preview';

/**
 * 像素预算 → 档位映射(离散桶,阈值取桶上限×1.1 左右留余量)
 * budgetPx = 节点屏幕实际占用宽度(节点尺寸 × viewport.k × DPR),null 时回退旧 invK 两档行为
 */
export function resolveBudgetTier(budgetPx: number | null, wantThumb: boolean): ImageTier {
  if (budgetPx == null || !Number.isFinite(budgetPx) || budgetPx <= 0) return wantThumb ? 'thumb' : 'preview';
  if (budgetPx <= 56) return 'thumb';
  if (budgetPx <= 190) return 'sm';
  if (budgetPx <= 300) return 'w256';
  if (budgetPx <= 560) return 'w512';
  return 'preview';
}

/** 前端缩放变体缓存(key = `${bucket}|${sourceUrl}`, value = 缩放后 blob URL),LRU 上限防内存泄漏 */
const resizedVariantCache = new Map<string, string>();
const RESIZED_CACHE_MAX = 240;

/**
 * 前端像素桶:将 preview 源图缩放到桶位宽度(解码线程 createImageBitmap,不阻塞主线程),
 * 经 OffscreenCanvas 转 JPEG blob URL 供 <img> 渲染。源图不大于桶位时直接返回源 URL。
 * 失败(不支持 OffscreenCanvas/解码失败)返回 null,由调用方回退 preview 档。
 */
async function makeResizedVariant(sourceUrl: string, bucket: number): Promise<string | null> {
  const cacheKey = `${bucket}|${sourceUrl}`;
  const hit = resizedVariantCache.get(cacheKey);
  if (hit) {
    // LRU 触碰
    resizedVariantCache.delete(cacheKey);
    resizedVariantCache.set(cacheKey, hit);
    return hit;
  }
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;
    const blob = await (await fetch(sourceUrl)).blob();
    const probe = await createImageBitmap(blob);
    if (probe.width <= bucket) {
      probe.close();
      return sourceUrl;
    }
    probe.close();
    const resized = await createImageBitmap(blob, { resizeWidth: bucket, resizeQuality: 'medium' });
    const canvas = new OffscreenCanvas(resized.width, resized.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resized.close();
      return null;
    }
    ctx.drawImage(resized, 0, 0);
    resized.close();
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const url = URL.createObjectURL(out);
    resizedVariantCache.set(cacheKey, url);
    if (resizedVariantCache.size > RESIZED_CACHE_MAX) {
      const oldest = resizedVariantCache.keys().next().value;
      if (oldest) {
        const oldUrl = resizedVariantCache.get(oldest);
        resizedVariantCache.delete(oldest);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
      }
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * 后端图片 URL: 根据 storageKey 构造 ?size= 参数 URL
 * 后端 key(resources/)直出 URL,本地 key 走 localforage
 */

export function buildBackendUrl(storageKey?: string, size: 'sm' | 'thumb' | 'preview' | 'full' = 'full'): string | null {
  if (!storageKey) return null;
  // 后端键检测: 以 resources/ 开头(统一前缀)
  if (!storageKey.startsWith('resources/')) return null;
  const encoded = encodeURIComponent(storageKey);
  // 优先级: window.env > VITE_API_BASE_URL > 默认值 /api
  // 与 api-client.ts 中的 getApiBaseUrl() 策略保持一致
  const envApiUrl = typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).env
    ? ((window as unknown as Record<string, unknown>).env as Record<string, string>).API_BASE_URL
    : undefined;
  let viteApiUrl: string | undefined;
  try { viteApiUrl = (import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }).env.VITE_API_BASE_URL; } catch { /* 非 Vite 环境 */ }
  const base = envApiUrl ?? viteApiUrl ?? '/api';
  // 私有资源(resources/front/ 前缀)依赖 JWT 鉴权,但 URL 中不拼接 token;
  // <img>/<video> 等媒体标签无法携带 Authorization header,
  // 请使用 AuthorizedImage / AuthorizedVideo(fetch + Authorization header + blob URL)渲染
  return `${base}/storage/get?key=${encoded}&size=${size}`;
}

/**
 * 根据 storageKey 重建 blob URL,用于节点视图渲染
 *
 * @param storageKey 持久化 key(如 'image:xxx' / 'video:xxx' / 'audio:xxx')
 * @param content 当前 content(可能是失效的 blob URL,作为 fallback)
 * @returns 可用于渲染的 URL(blob URL 或原始 content)
 *
 * 用法:
 * ```tsx
 * function ImageNodeView({ data }) {
 *   const src = useHydratedContent(data.storageKey, data.content);
 *   return <img src={src} />;
 * }
 * ```
 */
export function useHydratedContent(
  storageKey: string | undefined,
  content: string,
  opts?: { mediaPriority?: boolean },
): string {
  const mediaPriority = opts?.mediaPriority ?? false;
  // 有 storageKey 且 content 是 blob: URL 时,可能是刷新后失效的 URL,
  // 不立即使用(避免 ERR_FILE_NOT_FOUND),等异步解析重建。
  // 无 storageKey 或 content 非 blob:(如 dataURL)时可直接使用。
  const isPotentiallyStaleBlob = !!storageKey && content.startsWith('blob:');
  const [hydrated, setHydrated] = useState(isPotentiallyStaleBlob ? '' : content);

  useEffect(() => {
    if (!storageKey) {
      // 无 storageKey(如 AI 生成未保存的内容),直接用 content
      setHydrated(content);
      return;
    }

    let cancelled = false;

    // 后端键(resources/ 前缀) → 经 JWT 认证获取 blob URL(URL 不携带 token)
    // 跨设备/跨浏览器场景下,blob URL 无效,必须使用后端 URL
    // 本地 blob 仅作为临时 fallback(云同步刚完成、后端 URL 尚未可用时)
    if (storageKey.startsWith('resources/')) {
      const backendUrl = buildBackendUrl(storageKey, 'full');
      if (backendUrl) {
        authorizeMediaUrl(backendUrl, mediaPriority).then((url) => {
          if (cancelled) return;
          setHydrated(url ?? content);
        });
      } else if (content && !cancelled) {
        // 后端 URL 构造失败,降级到 content(可能是 blob URL 或 dataURL)
        setHydrated(content);
      }
      return () => { cancelled = true; };
    }

    // content 非 blob: URL(如 dataURL 或空字符串)时可直接使用;
    // blob: URL 不立即使用(等异步解析,避免刷新后引用失效 URL)
    if (!content.startsWith('blob:')) {
      setHydrated(content);
    }

    // 本地键(image:/video:/audio:/file: 前缀) → 走 persistence 插件解析
    const resolveFn = storageKey.startsWith('image:')
      ? resolveImageUrl
      : resolveMediaUrl; // video: / audio: / file: 都用 resolveMediaUrl

    resolveFn(storageKey, content)
      .then((url) => {
        if (!cancelled && url) {
          setHydrated(url);
        }
      })
      .catch((err) => {
        console.error('[useHydratedContent] failed to resolve', storageKey, err);
        // 失败时保留原 content(可能是 dataURL 或仍有效的 blob URL)
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, content, mediaPriority]);

  return hydrated;
}

/**
 * 非 hook 版内容解析(供批量处理/缩略图链路使用,逻辑与 useHydratedContent 一致)
 * @returns 可渲染 URL(认证后 blob URL / persistence 解析结果 / 原始 content)
 */
export async function resolveContentUrl(
  storageKey: string | undefined,
  content: string,
): Promise<string> {
  if (!storageKey) return content;
  if (storageKey.startsWith('resources/')) {
    const backendUrl = buildBackendUrl(storageKey, 'full');
    if (backendUrl) {
      const url = await authorizeMediaUrl(backendUrl);
      if (url) return url;
    }
    return content;
  }
  const resolveFn = storageKey.startsWith('image:') ? resolveImageUrl : resolveMediaUrl;
  try {
    const url = await resolveFn(storageKey, content);
    if (url) return url;
  } catch (err) {
    console.error('[resolveContentUrl] failed to resolve', storageKey, err);
  }
  return content;
}

/**
 * 解析小图级 URL(resources/ 走后端 size=sm 认证链路,本地键走 persistence 缩略图)
 * 用于小尺寸场景(导航缩略图/参考槽位),避免拉取全量媒体。
 * 旧图无 __sm 变体时后端自动回退原图(清晰,零迁移)。
 */
export async function resolveAnyThumbUrl(
  storageKey: string | undefined,
): Promise<string | null> {
  if (!storageKey) return null;
  if (storageKey.startsWith('resources/')) {
    const thumbUrl = buildBackendUrl(storageKey, 'sm');
    return thumbUrl ? authorizeMediaUrl(thumbUrl) : null;
  }
  try {
    return await resolveThumbnailUrl(storageKey);
  } catch {
    return null;
  }
}

/**
 * preview 级展示图 hook(大槽位:堆叠详情面板大格子/堆叠活跃卡封面)
 *
 * 三档图片契约(征集 #77 用户拍板)的中间档:展示层自适应、永不主动拉原图 ——
 *   画布节点/堆叠详情 → 自适应档(本 hook / useProgressiveImage)
 *   图片浏览器(AssetDetailViewer) → 高清原图(useHydratedContent)
 * - resources/ 键: 后端 ?size=preview 认证链路;旧图无 __preview 变体时后端自动回退原图(零迁移)
 * - 本地 image: 键: resolvePreviewUrl;无变体时经 useHydratedContent 兜底链展示(原图仅作兼容出口)
 * - 非图片键(视频/音频): 回退 useHydratedContent 行为(视频无尺寸变体概念)
 */
export function usePreviewImage(
  storageKey: string | undefined,
  content: string,
  opts?: { mediaPriority?: boolean },
): string {
  const mediaPriority = opts?.mediaPriority ?? false;
  const isImageKey = !!storageKey && (storageKey.startsWith('image:') || storageKey.startsWith('resources/'));
  const fallbackHydrated = useHydratedContent(isImageKey ? undefined : storageKey, content);

  const backendPreview = buildBackendUrl(
    isImageKey && storageKey?.startsWith('resources/') ? storageKey : undefined,
    'preview',
  );
  const [authPreview, setAuthPreview] = useState('');
  const [localPreview, setLocalPreview] = useState('');

  // 后端键: JWT 认证换 blob URL(<img> 无法携带 Authorization header)
  useEffect(() => {
    if (!backendPreview) { setAuthPreview(''); return; }
    let cancelled = false;
    authorizeMediaUrl(backendPreview, mediaPriority).then((u) => { if (!cancelled) setAuthPreview(u ?? ''); });
    return () => { cancelled = true; };
  }, [backendPreview, mediaPriority]);

  // 本地 image: 键: 解析 :preview 变体(旧上传无变体时为空,走兜底链)
  useEffect(() => {
    const isLocalImage = !!storageKey && storageKey.startsWith('image:');
    if (!isLocalImage) { setLocalPreview(''); return; }
    let cancelled = false;
    resolvePreviewUrl(storageKey)
      .then((url) => { if (!cancelled) setLocalPreview(url ?? ''); })
      .catch(() => { if (!cancelled) setLocalPreview(''); });
    return () => { cancelled = true; };
  }, [storageKey]);

  if (!isImageKey) return fallbackHydrated;
  // 后端键: preview 认证结果;未就绪/失败时经兜底链(旧数据后端自动回退原图)
  if (backendPreview) return authPreview || fallbackHydrated;
  // 本地键: preview 变体 > 兜底链(原图仅作旧数据兼容出口)
  return localPreview || fallbackHydrated;
}

/**
 * 渐进式图片加载 hook(Phase VI.4)
 *
 * 根据视口缩放(invK = 1/viewport.k)智能选择加载策略:
 * - invK ≥ THUMBNAIL_THRESHOLD(k ≤ 0.25,画布大幅缩小):只加载缩略图,跳过原图与预览图
 *   → 大幅降低内存占用,支持画布容纳更多图片节点
 * - invK < THUMBNAIL_THRESHOLD(画布放大):加载 preview 级,缩略图作为占位符先行显示;
 *   画布节点永不主动加载原图(征集 #77 用户拍板:原图只在图片浏览器中使用)
 *
 * 旧数据兼容:本地键无缩略图/预览变体时回退到原图加载(兼容唯一出口),
 * 行为与 useHydratedContent 一致,确保已存在的图片不会因缺少缩略图而无法显示。
 *
 * 渲染优先级:
 *   缩小时: thumbnail > preview(回退) > content
 *   放大时: preview > thumbnail > content(缩略图先显示,预览图加载完成后替换)
 *   后端键: 无 __preview 变体时后端自动回退原图(旧图零迁移)
 *
 * 注意:仅适用于图片类型(storageKey 前缀 'image:');其他类型回退到 useHydratedContent 行为
 *
 * @param storageKey 持久化 key(如 'image:xxx')
 * @param content 当前 content(可能是失效的 blob URL,作为 fallback)
 * @param invK 1/viewport.k(节点视口缩放倒数,由 NodeLayer 传入)
 * @param budgetPx 像素预算(Plan#48:节点屏幕实际占用宽度,节点宽×k×DPR);null 时回退旧 invK 两档行为
 * @returns 可用于渲染的 URL
 */
export function useProgressiveImage(
  storageKey: string | undefined,
  content: string,
  invK: number,
  budgetPx: number | null = null,
): string {
  // 非 image: 前缀且非 resources/ 前缀(后端图片) → 回退到普通 hydrate 行为(视频/音频等)
const isImage = !!storageKey && (storageKey.startsWith('image:') || storageKey.startsWith('resources/'));
  const fallbackHydrated = useHydratedContent(isImage ? undefined : storageKey, content);

  // 后端键直接构造 URL(带 ?size= 参数),不经过 localforage;
  // 画布节点档永不主动拉 full(征集 #77),仅 thumb/preview 两档
  const backendPreview = buildBackendUrl(isImage && storageKey?.startsWith('resources/') ? storageKey : undefined, 'preview');
  const backendThumb   = buildBackendUrl(isImage && storageKey?.startsWith('resources/') ? storageKey : undefined, 'thumb');

  type LoadState = 'loading' | 'ready' | 'missing';
  const [thumbState, setThumbState] = useState<LoadState>(backendThumb ? 'ready' : 'loading');
  const [thumb, setThumb] = useState(backendThumb ?? '');
  const [previewState, setPreviewState] = useState<LoadState>(backendPreview ? 'ready' : 'loading');
  const [preview, setPreview] = useState(backendPreview ?? '');
  const [full, setFull] = useState('');
  const fullLoadedRef = useRef(false);
  const prevStorageKeyRef = useRef(storageKey);

  // 后端键经 JWT 认证换取 blob URL(URL 不携带 token,
  // <img> 标签无法发送 Authorization header,直接使用会 403)。
  // 初始为空串避免闪现 403 破图,认证完成后替换。只认证 thumb/preview 两档,
  // full 档由图片浏览器(AssetDetailViewer)独占,节点层不发起请求。
  const isBackend = isImage && !!storageKey?.startsWith('resources/');
  const [authPreview, setAuthPreview] = useState('');
  const [authThumb, setAuthThumb] = useState('');
  const [authSm, setAuthSm] = useState('');
  const [resized, setResized] = useState('');

  const wantThumb = isImage && invK >= THUMBNAIL_THRESHOLD;
  // 像素预算档位(Plan#48):由节点屏幕占用宽度决定;档位离散变化,避免连续缩放造成 effect 抖动
  const tier = resolveBudgetTier(budgetPx, wantThumb);

  useEffect(() => {
    if (!isBackend) {
      setAuthPreview('');
      setAuthThumb('');
      return;
    }
    let cancelled = false;
    if (backendPreview) {
      authorizeMediaUrl(backendPreview).then((u) => { if (!cancelled) setAuthPreview(u ?? ''); });
    } else {
      setAuthPreview('');
    }
    if (backendThumb) {
      authorizeMediaUrl(backendThumb).then((u) => { if (!cancelled) setAuthThumb(u ?? ''); });
    } else {
      setAuthThumb('');
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBackend, backendPreview, backendThumb]);

  // sm 档认证(仅档位需要时发起;结果进 backendUrlCache 全局复用,多节点同图不重复请求)
  const backendSm = buildBackendUrl(isBackend ? storageKey : undefined, 'sm');
  useEffect(() => {
    if (!backendSm || tier !== 'sm') { setAuthSm(''); return; }
    let cancelled = false;
    authorizeMediaUrl(backendSm).then((u) => { if (!cancelled) setAuthSm(u ?? ''); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendSm, tier]);

  // 前端像素桶(Plan#48 C2):preview 源图在解码线程缩到 w256/w512,
  // OffscreenCanvas 不可用/失败时置空自动回退 preview 档
  useEffect(() => {
    if (tier !== 'w256' && tier !== 'w512') { setResized(''); return; }
    const sourceUrl = backendPreview ? authPreview : preview;
    if (!sourceUrl) { setResized(''); return; }
    let cancelled = false;
    makeResizedVariant(sourceUrl, tier === 'w256' ? 256 : 512).then((u) => {
      if (!cancelled) setResized(u ?? '');
    });
    return () => { cancelled = true; };
  }, [tier, backendPreview, authPreview, preview]);

  // storageKey 变化时重置所有状态(资源替换后重新加载)
  if (prevStorageKeyRef.current !== storageKey) {
    prevStorageKeyRef.current = storageKey;
    fullLoadedRef.current = false;
    setThumb(backendThumb ?? '');
    setThumbState(backendThumb ? 'ready' : 'loading');
    setPreview(backendPreview ?? '');
    setPreviewState(backendPreview ? 'ready' : 'loading');
    setFull('');
  }

  // 解析缩略图(始终加载,~1-5KB极小)
  useEffect(() => {
    if (!isImage || !storageKey) {
      setThumbState('loading');
      setThumb('');
      return;
    }
    let cancelled = false;
    setThumbState('loading');
    resolveThumbnailUrl(storageKey)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setThumb(url);
          setThumbState('ready');
        } else {
          setThumb('');
          setThumbState('missing');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setThumbState('missing');
        console.warn('[useProgressiveImage] thumbnail resolve failed:', storageKey, err);
      });
    return () => {
      cancelled = true;
    };
  }, [isImage, storageKey]);

  // 解析中等预览图(放大档恒加载;缩小时仅在缩略图缺失时兜底)
  useEffect(() => {
    if (!isImage || !storageKey) {
      setPreview('');
      setPreviewState('loading');
      return;
    }
    const shouldLoad = !wantThumb || thumbState === 'missing';
    if (!shouldLoad) {
      setPreview('');
      setPreviewState('loading');
      return;
    }
    let cancelled = false;
    setPreviewState('loading');
    resolvePreviewUrl(storageKey)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setPreview(url);
          setPreviewState('ready');
        } else {
          setPreview('');
          setPreviewState('missing');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewState('missing');
        console.warn('[useProgressiveImage] preview resolve failed:', storageKey, err);
      });
    return () => {
      cancelled = true;
    };
  }, [isImage, storageKey, wantThumb, thumbState]);

  // 解析原图(仅限兼容出口:本地键缩略图/预览图变体都缺失时,确保旧数据仍能显示)
  useEffect(() => {
    if (!isImage || !storageKey) {
      setFull('');
      fullLoadedRef.current = false;
      return;
    }
    const shouldLoad = thumbState === 'missing' && previewState === 'missing';
    if (!shouldLoad) return;
    if (fullLoadedRef.current) return;

    let cancelled = false;
    resolveImageUrl(storageKey, content)
      .then((url) => {
        if (!cancelled && url) {
          setFull(url);
          fullLoadedRef.current = true;
        }
      })
      .catch((err) => {
        console.error('[useProgressiveImage] full image resolve failed:', storageKey, err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage, storageKey, thumbState, previewState, content]);

  if (!isImage) return fallbackHydrated;

  // 档位优先级链(Plan#48 像素预算):预算越小的节点用越小的源图,
  // 逐级回退保证任何档位缺失(旧图无变体/OffscreenCanvas 不可用)时仍能显示。
  // 三档契约(征集 #77)不破坏:全链无 full,原图仍只作为本地键无变体时的兼容出口。
  const backendChain: Record<ImageTier, string[]> = {
    thumb: [authThumb, authPreview],
    sm: [authSm, authThumb, authPreview],
    w256: [resized, authSm, authPreview],
    w512: [resized, authPreview],
    preview: [authPreview, authThumb],
  };
  const localChain: Record<ImageTier, string[]> = {
    thumb: [thumb, preview],
    sm: [thumb, preview],
    w256: [resized, thumb, preview],
    w512: [resized, preview],
    preview: [preview, thumb],
  };
  const chain = backendPreview ? backendChain[tier] : localChain[tier];

  if (backendPreview) {
    return chain.find(Boolean) || content;
  }
  // 本地键:原图(full)仍仅作旧数据无变体时的兼容出口(征集 #77)
  return chain.find(Boolean) || full || content;
}
