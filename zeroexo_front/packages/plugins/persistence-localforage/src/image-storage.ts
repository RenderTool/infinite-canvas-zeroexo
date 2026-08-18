/**
 * 图片存储分桶(Phase VI.1)
 *
 * 存储分层:
 * - storeName: 'image_files'
 * - storageKey 前缀: 'image:'
 *
 * Object URL 缓存机制:
 * - 节点 metadata.content 存 blob: URL(刷新失效)
 * - storageKey 是持久化真相,刷新后通过 resolveImageUrl 重建
 *
 * 渐进式加载(Phase VI.4):
 * - 上传时生成缩略图(maxSize=48px, JPEG quality=0.6, ~1-5KB)
 * - 缩略图存储在 '{storageKey}:thumb' 键下
 * - resolveThumbnailUrl 优先取内存缓存,未命中则从 IndexedDB 加载并懒生成
 * - 画布缩小时只渲染缩略图,大幅降低内存占用
 */
import localforage from 'localforage';
import { nanoid } from 'nanoid';

// ===== 类型 =====

export type UploadedImage = {
  url: string;
  storageKey: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
};

// ===== localforage 实例(独立于 PersistencePlugin 的 canvas store) =====

const store = localforage.createInstance({
  name: 'zeroexo',
  storeName: 'image_files',
});

/** storageKey → blob URL 的内存缓存(刷新后需重建) */
const objectUrls = new Map<string, string>();
/** 缩略图 storageKey → blob URL 的内存缓存 */
const thumbUrls = new Map<string, string>();
/** 中等分辨率预览图 storageKey → blob URL 的内存缓存 */
const previewUrls = new Map<string, string>();

// ===== 缩略图参数 =====

/** 缩略图最大边长(像素)— 48px 足以支撑画布缩略图渲染 */
const THUMBNAIL_MAX_SIZE = 48;
/** 缩略图 JPEG 质量(0-1)— 0.6 在视觉与体积间平衡 */
const THUMBNAIL_QUALITY = 0.6;
/** 生成缩略图的源图最小尺寸阈值 — 源图本身小于此尺寸则不生成缩略图(避免放大) */
const THUMBNAIL_SOURCE_MIN_SIZE = 96;

// ===== 中等分辨率预览图参数 =====

/** 中等分辨率预览图最大边长(像素)— 256px 用于中等缩放级别 */
const PREVIEW_MAX_SIZE = 256;
/** 中等分辨率预览图 JPEG 质量(0-1)— 0.8 平衡质量与体积 */
const PREVIEW_QUALITY = 0.8;
/** 生成预览图的源图最小尺寸阈值 */
const PREVIEW_SOURCE_MIN_SIZE = 512;

/** 缩略图 storageKey 派生:'image:xxx' → 'image:xxx:thumb' */
function toThumbKey(storageKey: string): string {
  return `${storageKey}:thumb`;
}

/** 中等分辨率预览图 storageKey 派生:'image:xxx' → 'image:xxx:preview' */
function toPreviewKey(storageKey: string): string {
  return `${storageKey}:preview`;
}

/**
 * 生成中等分辨率预览图 Blob(使用 Canvas 缩放)
 * - 输入源图 Blob,输出 JPEG 预览图 Blob(最大 256px)
 * - 用于中等缩放级别(k=0.5~1.0),质量比缩略图高但远小于原图
 */
async function generatePreviewBlob(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageBitmap(url);
    if (
      img.width <= PREVIEW_SOURCE_MIN_SIZE &&
      img.height <= PREVIEW_SOURCE_MIN_SIZE
    ) {
      return null;
    }
    const scale = Math.min(
      PREVIEW_MAX_SIZE / img.width,
      PREVIEW_MAX_SIZE / img.height,
      1,
    );
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        'image/jpeg',
        PREVIEW_QUALITY,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
/**
 * 生成缩略图 Blob(使用 Canvas 缩放)
 * - 输入原图 Blob,输出 JPEG 缩略图 Blob
 * - 缩放比例 = min(maxSize/w, maxSize/h, 1),保证不放大
 * - 原图加载失败时抛错(由调用方捕获)
 */
async function generateThumbnailBlob(blob: Blob): Promise<Blob | null> {
  // 仅对图片生成缩略图;非图片(如 SVG 已是图片但 type 可能不准)交给 canvas 处理
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageBitmap(url);
    // 原图过小则不生成缩略图(避免放大失真,直接用原图)
    if (
      img.width <= THUMBNAIL_SOURCE_MIN_SIZE &&
      img.height <= THUMBNAIL_SOURCE_MIN_SIZE
    ) {
      return null;
    }
    const scale = Math.min(
      THUMBNAIL_MAX_SIZE / img.width,
      THUMBNAIL_MAX_SIZE / img.height,
      1,
    );
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        'image/jpeg',
        THUMBNAIL_QUALITY,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * O-3: 加载图片为 ImageBitmap(离屏解码,不阻塞主线程)。
 * 优先使用 createImageBitmap(支持 blob: 和 data: URL),回退到 HTMLImageElement。
 * @param url 图片 URL(blob/data/http)
 * @param timeout 超时(ms,默认 5000)
 */
async function loadImageBitmap(url: string, timeout = 5000): Promise<ImageBitmap> {
  // 非 blob/data URL 直接回退到 Image 加载
  if (!url.startsWith('blob:') && !url.startsWith('data:')) {
    return imgToBitmap(await loadImageElement(url));
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const blob = await response.blob();
    return await createImageBitmap(blob);
  } catch {
    // 回退到 HTMLImageElement
    return imgToBitmap(await loadImageElement(url));
  }
}

/** HTMLImageElement → ImageBitmap(用于 createImageBitmap 回退路径) */
function imgToBitmap(img: HTMLImageElement): Promise<ImageBitmap> {
  return createImageBitmap(img);
}

/** 加载 HTMLImageElement(带超时回退) */
function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      reject(new Error('image load timeout'));
    }, 5000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('image load error'));
    };
    img.src = url;
  });
}

// ===== 公开 API =====

/**
 * 上传图片到存储分桶
 * @param input dataUrl 字符串或 Blob
 * @returns UploadedImage(url 为 blob URL, storageKey 为 'image:xxx')
 */
export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
  const blob = typeof input === 'string' ? await (await fetch(input)).blob() : input;
  const storageKey = `image:${nanoid()}`;
  await store.setItem(storageKey, blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  const meta = await readImageMeta(url);

  // 异步生成缩略图(不阻塞主流程,失败不影响上传)
  void generateAndStoreThumbnail(storageKey, blob).catch((err) => {
    console.warn('[image-storage] thumbnail generation failed:', storageKey, err);
  });
  // 异步生成中等分辨率预览图
  void generateAndStorePreview(storageKey, blob).catch((err) => {
    console.warn('[image-storage] preview generation failed:', storageKey, err);
  });

  return {
    url,
    storageKey,
    width: meta.width,
    height: meta.height,
    bytes: blob.size,
    mimeType: blob.type || meta.mimeType,
  };
}

/**
 * 异步生成缩略图并写入 IndexedDB + 内存缓存
 * - 原图过小或生成失败时静默跳过
 * - 后续 resolveThumbnailUrl 调用会自动使用已生成的缩略图
 */
async function generateAndStoreThumbnail(storageKey: string, sourceBlob: Blob): Promise<void> {
  const thumbBlob = await generateThumbnailBlob(sourceBlob);
  if (!thumbBlob) return;
  const thumbKey = toThumbKey(storageKey);
  await store.setItem(thumbKey, thumbBlob);
  const url = URL.createObjectURL(thumbBlob);
  thumbUrls.set(thumbKey, url);
}

/**
 * 异步生成中等分辨率预览图并写入 IndexedDB + 内存缓存
 * - 原图过小或生成失败时静默跳过
 * - 用于中等缩放级别(k=0.5~1.0),质量比缩略图高但远小于原图
 */
async function generateAndStorePreview(storageKey: string, sourceBlob: Blob): Promise<void> {
  const previewBlob = await generatePreviewBlob(sourceBlob);
  if (!previewBlob) return;
  const previewKey = toPreviewKey(storageKey);
  await store.setItem(previewKey, previewBlob);
  const url = URL.createObjectURL(previewBlob);
  previewUrls.set(previewKey, url);
}

/**
 * 解析 storageKey → 中等分辨率预览图 blob URL
 * 优先取内存缓存,缓存未命中则从 IndexedDB 加载;
 * 若 IndexedDB 中也无,返回空字符串(由调用方降级到缩略图或原图)
 *
 * @param storageKey 'image:xxx' 前缀(自动派生 ':preview' 后缀)
 * @returns 预览图 blob URL 或空字符串
 */
export async function resolvePreviewUrl(storageKey?: string): Promise<string> {
  if (!storageKey) return '';
  const previewKey = toPreviewKey(storageKey);
  const cached = previewUrls.get(previewKey);
  if (cached) return cached;
  const blob = await store.getItem<Blob>(previewKey);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  previewUrls.set(previewKey, url);
  return url;
}

/**
 * 解析 storageKey → 缩略图 blob URL
 * 优先取内存缓存,缓存未命中则从 IndexedDB 加载;
 * 若 IndexedDB 中也无(旧数据未生成缩略图),返回空字符串(由调用方降级到原图)
 *
 * @param storageKey 'image:xxx' 前缀(自动派生 ':thumb' 后缀)
 * @returns 缩略图 blob URL 或空字符串
 */
export async function resolveThumbnailUrl(storageKey?: string): Promise<string> {
  if (!storageKey) return '';
  const thumbKey = toThumbKey(storageKey);
  const cached = thumbUrls.get(thumbKey);
  if (cached) return cached;
  const blob = await store.getItem<Blob>(thumbKey);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  thumbUrls.set(thumbKey, url);
  return url;
}

/**
 * 解析 storageKey → blob URL
 * 优先取内存缓存,缓存未命中则从 localforage 加载 Blob 并创建 URL
 * @param storageKey 'image:xxx' 前缀
 * @param fallback 缓存与存储均未命中时的回退值
 */
export async function resolveImageUrl(storageKey?: string, fallback = ''): Promise<string> {
  if (!storageKey) return fallback;
  const cached = objectUrls.get(storageKey);
  if (cached) return cached;
  const blob = await store.getItem<Blob>(storageKey);
  if (!blob) return fallback;
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  return url;
}

/** 直接读取 Blob(不创建 URL,用于 FormData 上传等场景) */
export async function getImageBlob(storageKey: string): Promise<Blob | null> {
  return store.getItem<Blob>(storageKey);
}

/**
 * 覆盖写入 Blob(用于裁剪/放大/蒙版等编辑后替换原图)
 * 同时重新生成缩略图(替换原图后旧缩略图失效)
 * @returns 新创建的 blob URL
 */
export async function setImageBlob(storageKey: string, blob: Blob): Promise<string> {
  await store.setItem(storageKey, blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  // 重新生成缩略图(异步,不阻塞主流程)
  void generateAndStoreThumbnail(storageKey, blob).catch((err) => {
    console.warn('[image-storage] thumbnail regeneration failed:', storageKey, err);
  });
  // 重新生成中等分辨率预览图
  void generateAndStorePreview(storageKey, blob).catch((err) => {
    console.warn('[image-storage] preview regeneration failed:', storageKey, err);
  });
  return url;
}

/**
 * 将图片统一转换为 dataUrl(用于上传第三方 API)
 * @param image 可能含 dataUrl / url / storageKey 任意组合
 */
export async function imageToDataUrl(image: {
  url?: string;
  dataUrl?: string;
  storageKey?: string;
}): Promise<string> {
  const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ''));
  if (!url || url.startsWith('data:')) return url;
  return blobToDataUrl(await (await fetch(url)).blob());
}

/**
 * 删除指定 storageKey 的图片(同时 revoke Object URL 与对应缩略图)
 * @param keys storageKey 可迭代集合(自动去重)
 */
export async function deleteStoredImages(keys: Iterable<string>): Promise<void> {
  await Promise.all(
    Array.from(new Set(keys)).map(async (key) => {
      const url = objectUrls.get(key);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(key);
      // 同步删除缩略图(键 + 内存 URL 缓存)
      const thumbKey = toThumbKey(key);
      const thumbUrl = thumbUrls.get(thumbKey);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      thumbUrls.delete(thumbKey);
      await Promise.all([store.removeItem(key), store.removeItem(thumbKey)]);
    }),
  );
}

/**
 * GC: 清理未被引用的图片存储
 * @param usedData 任意包含 storageKey 字段的对象(graph / asset store / 节点 metadata)
 *
 * 注意:缩略图键('image:xxx:thumb')应跟随原图生命周期,
 * 原图被引用时缩略图保留,原图被删除时缩略图一并清理(由 deleteStoredImages 处理)。
 */
export async function cleanupUnusedImages(usedData: unknown): Promise<void> {
  const usedKeys = collectImageStorageKeys(usedData);
  const unused: string[] = [];
  await store.iterate((_value, key) => {
    // 跳过缩略图键(由原图的 deleteStoredImages 一并清理,避免误删)
    // 注意: ':videothumb' 是视频首帧缩略图(可能挂在 video:/resources/ 前缀下),
    // 同样跟随原 key 生命周期,GC 不做单独判定,否则会误删仍在使用的视频缩略图。
    if (key.endsWith(':thumb') || key.endsWith(':videothumb')) return;
    if (!usedKeys.has(key)) unused.push(key);
  });
  await deleteStoredImages(unused);
}

/**
 * 递归收集对象中所有 'image:' 前缀的 storageKey
 * @param value 任意嵌套对象/数组
 * @param keys 累积集合(便于递归复用)
 */
export function collectImageStorageKeys(value: unknown, keys = new Set<string>(), visited = new WeakSet<object>()): Set<string> {
  if (!value || typeof value !== 'object') return keys;
  if (visited.has(value)) return keys;
  visited.add(value);
  if (
    'storageKey' in value &&
    typeof value.storageKey === 'string' &&
    value.storageKey.startsWith('image:')
  ) {
    keys.add(value.storageKey);
  }
  Object.values(value).forEach((item) =>
    Array.isArray(item)
      ? item.forEach((child) => collectImageStorageKeys(child, keys, visited))
      : collectImageStorageKeys(item, keys, visited),
  );
  return keys;
}

// ===== 内部辅助 =====

/**
 * 读取图片元信息(宽高 + mimeType)
 * 含 3s 超时回退(避免图片加载失败时永久挂起)
 */
function readImageMeta(dataUrl: string): Promise<{ width: number; height: number; mimeType: string }> {
  return new Promise((resolve) => {
    const image = new Image();
    const done = (): void => {
      resolve({
        width: image.naturalWidth || 1024,
        height: image.naturalHeight || 1024,
        mimeType: dataUrl.match(/^data:([^;]+)/)?.[1] || 'image/png',
      });
    };
    image.onload = done;
    image.onerror = done;
    setTimeout(done, 3000);
    image.src = dataUrl;
  });
}

/** Blob → dataUrl(FileReader) */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

// ===== 视频缩略图持久化 =====

/**
 * 视频缩略图 storageKey 派生规则
 * image:xxx → image:xxx:videothumb (复用图片缩略图键空间,但后缀不同)
 * video:xxx → video:xxx:thumb
 * resources/xxx → resources/xxx:videothumb (后端忽略此格式,仅本地使用)
 */
function toVideoThumbKey(storageKey: string): string {
  return `${storageKey}:videothumb`;
}

/** 视频缩略图内存缓存(storageKey → blob URL) */
const videoThumbUrls = new Map<string, string>();

/**
 * 持久化视频首帧缩略图到 IndexedDB + 内存缓存
 * @param storageKey 视频 storageKey(image:/video:/resources/)
 * @param blob 缩略图 Blob(jpeg,由 video 元素截帧生成)
 */
export async function storeVideoThumbnail(storageKey: string, blob: Blob): Promise<void> {
  const thumbKey = toVideoThumbKey(storageKey);
  await store.setItem(thumbKey, blob);
  // 更新内存缓存(覆盖旧值)
  const oldUrl = videoThumbUrls.get(thumbKey);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  const url = URL.createObjectURL(blob);
  videoThumbUrls.set(thumbKey, url);
}

/**
 * 解析视频缩略图 → blob URL
 * 优先取内存缓存,缓存未命中则从 IndexedDB 加载
 * @param storageKey 视频 storageKey
 * @returns 缩略图 blob URL 或空字符串(无缩略图时)
 */
export async function resolveVideoThumbnail(storageKey?: string): Promise<string> {
  if (!storageKey) return '';
  const thumbKey = toVideoThumbKey(storageKey);
  const cached = videoThumbUrls.get(thumbKey);
  if (cached) return cached;
  const blob = await store.getItem<Blob>(thumbKey);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  videoThumbUrls.set(thumbKey, url);
  return url;
}

/**
 * 删除视频缩略图(随视频节点删除时调用)
 * @param keys 视频 storageKey 集合
 */
export async function deleteVideoThumbnails(keys: Iterable<string>): Promise<void> {
  await Promise.all(
    Array.from(new Set(keys)).map(async (key) => {
      const thumbKey = toVideoThumbKey(key);
      const url = videoThumbUrls.get(thumbKey);
      if (url) URL.revokeObjectURL(url);
      videoThumbUrls.delete(thumbKey);
      await store.removeItem(thumbKey);
    }),
  );
}
