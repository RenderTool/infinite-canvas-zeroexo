/**
 * sync-resources - 资源上传模块(从 sync-service.ts 提取)
 *
 * 包含资源上传/下载相关的函数和类型定义:
 * - Blob 哈希计算(CAS 去重)
 * - Blob 内容上传到云端(含预签名直传)
 * - 节点资源云端同步(上传/下载)
 * - 画布资源保存到素材库
 */

import { getToken, apiPost, apiPutBinary, getApiBaseUrl } from '../api-client.js';
import {
  getImageBlob,
  setImageBlob,
  getMediaBlob,
  setMediaBlob,
  resolveImageUrl,
  resolveMediaUrl,
} from '@zeroexo/plugin-persistence';
import { upsertAsset } from '@/features/asset-picker/asset-store.js';
import type { Asset, AssetKind } from '@/features/asset-picker/index.js';
import type { NodeRecord } from '@zeroexo/core';
import { debugLog, debugError } from './sync-utils.js';

/**
 * 本次会话内已确认失效的 blob URL。
 * blob URL 在页面刷新或 URL.revokeObjectURL 后无法再次 fetch,
 * 且每次 fetch 都会触发浏览器控制台 net::ERR_FILE_NOT_FOUND。
 * 记录失效 URL,避免后续同步反复 fetch 同一死引用。
 * 仅存会话内存,刷新页面后自动清空。
 */
const failedBlobUrls = new Set<string>();

// ===== 类型定义 =====

interface PresignResponse {
  /** CAS 去重命中时为 null(客户端跳过上传);否则为预签名上传 URL */
  uploadUrl: string | null;
  storageKey: string;
 showImageInfo: boolean;
  thumbnailUrl: string | null;
  tags: string[];
  isPublic: boolean;
  version: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CloudAsset {
  id: string;
  ownerId: string;
  kind: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  size: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  thumbnailKey?: string | null;
  text?: string | null;
  tags: string[];
  version: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===== SHA-256 哈希计算 =====

/**
 * 计算 Blob 的 SHA-256 哈希(十六进制字符串)
 * 用于 CAS 去重:相同内容哈希相同,后端只存一份
 */
async function computeBlobHash(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ===== Blob 内容上传到云端 =====

/**
 * 上传 Blob 内容到云端存储(CAS 去重)
 *
 * 将 blob 内容上传到云端 MinIO 存储,通过内容哈希实现 CAS 去重。
 * 相同内容的 blob 只会存储一份,后端返回已有 storageKey。
 *
 * @param blob - 要上传的 Blob 数据
 * @param filename - 文件名(用于后端存储路径)
 * @param mimeType - MIME 类型
 * @param metadata - 可选的元数据(如 width/height/duration 等)
 * @returns 包含 storageKey 的对象,失败返回 null
 */
async function uploadBlobContentToCloud(
  blob: Blob,
  filename: string,
  mimeType: string,
  metadata?: Record<string, string>,
): Promise<{ storageKey: string } | null> {
  try {
    if (blob.size === 0) {
      debugError('[sync-resources] uploadBlobContentToCloud: empty blob');
      return null;
    }

    const contentHash = await computeBlobHash(blob);

    const presign = await apiPost<PresignResponse>('/resources/presign', {
      filename,
      mimeType,
      size: blob.size,
      contentHash,
      ...(metadata ?? {}),
    });

    if (presign.uploadUrl) {
      await apiPutBinary(presign.uploadUrl, blob, mimeType);
      debugLog(`[sync-resources] uploaded blob content to cloud: ${presign.storageKey}`);
    } else {
      debugLog(`[sync-resources] dedup hit for blob content, reuse: ${presign.storageKey}`);
    }
    return { storageKey: presign.storageKey };
  } catch (err) {
    debugError('[sync-resources] uploadBlobContentToCloud failed:', err);
    return null;
  }
}

// ===== 节点资源上传辅助 =====

/**
 * 上传节点资源(图片/视频/音频)到云端
 * 从 localforage 读取 blob,通过 CAS 去重上传到 MinIO
 */
async function uploadNodeResourceToCloud(storageKey: string): Promise<string | null> {
  try {
    let blob: Blob | null;

    if (storageKey.startsWith('image:')) {
      blob = await getImageBlob(storageKey);
    } else if (storageKey.startsWith('video:')) {
      blob = await getMediaBlob(storageKey);
    } else if (storageKey.startsWith('audio:')) {
      blob = await getMediaBlob(storageKey);
    } else {
      return null;
    }

    if (!blob) {
      // 跨浏览器场景: 另一浏览器上传的图片 blob 在当前浏览器 IndexedDB 中不存在,
      // 属正常现象, 降级为 warn 避免误导用户以为同步失败。
      debugLog(`[sync-resources] blob not found for storageKey ${storageKey} (cross-browser, skip)`);
      return null;
    }

    // CAS 去重:计算内容哈希,相同内容后端只存一份
    const contentHash = await computeBlobHash(blob);
    const presign = await apiPost<PresignResponse>('/resources/presign', {
      filename: storageKey,
      mimeType: blob.type,
      size: blob.size,
      contentHash,
    });

    // uploadUrl 为 null 表示去重命中(同一资源已存在),跳过上传
    if (presign.uploadUrl) {
      await apiPutBinary(presign.uploadUrl, blob, blob.type);
      debugLog(`[sync-resources] uploaded node resource ${storageKey} to cloud storage: ${presign.storageKey}`);
    } else {
      debugLog(`[sync-resources] dedup hit for ${storageKey}, reuse cloud storage: ${presign.storageKey}`);
    }
    return presign.storageKey;
  } catch (err) {
    debugError(`[sync-resources] upload node resource ${storageKey} failed:`, err);
    return null;
  }
}

// ===== 同步节点资源到云端 =====

/**
 * 同步节点资源到云端
 *
 * 处理两类场景:
 * 1. 有本地 storageKey(image:/video:/audio: 前缀)的节点 → 上传 blob 到云端
 * 2. data.content 是 blob URL 但没有 storageKey 的节点 → fetch blob → 上传云端 → 设置 storageKey
 *
 * 上传完成后将 data.storageKey 更新为云端 storageKey(cloud key),
 * 调用方需负责将更新后的 graph 持久化保存。
 */
async function syncProjectResourcesToCloud(nodes: any[]): Promise<void> {
  const storageKeyMap = new Map<string, string>();

  for (const node of nodes) {
    if (typeof node !== 'object' || !node) continue;
    const data = (node as Record<string, unknown>).data as Record<string, unknown> | undefined;
    if (!data) continue;

    const storageKey = data.storageKey as string | undefined;
    const content = data.content as string | undefined;

    // Case 1: 有本地 storageKey → 上传 storageKey 指向的 blob 到云端
    if (storageKey && (storageKey.startsWith('image:') || storageKey.startsWith('video:') || storageKey.startsWith('audio:'))) {
      const cloudStorageKey = await uploadNodeResourceToCloud(storageKey);
      if (cloudStorageKey) {
        storageKeyMap.set(storageKey, cloudStorageKey);
      }
    }

    // Case 2: data.content 是 blob URL 但没有 storageKey → fetch blob → 上传云端 → 设置 storageKey
    // 场景: AI 生成图片/视频后, data.content 设为 blob URL, 但 blob 未存储到 localforage,
    // 导致 storageKey 为空。不处理会导致推送的 scene 中含无效 blob URL(其他设备无法渲染)。
    if (!storageKey && content && content.startsWith('blob:')) {
      // blob URL 仅在创建它的会话内有效。刷新/revokeObjectURL 后 fetch 会失败,
      // 且每次 fetch 都会触发浏览器控制台 net::ERR_FILE_NOT_FOUND。
      // 会话内已确认失效的 URL 直接跳过并清理,避免每次同步都重复 fetch。
      if (failedBlobUrls.has(content)) {
        delete data.content;
        debugLog(`[sync-resources] skip dead blob URL (already failed this session), cleared content`);
        continue;
      }
      try {
        const response = await fetch(content);
        if (!response.ok) {
          debugLog(`[sync-resources] fetch blob URL failed: ${response.status} (cross-browser, skip)`);
          continue;
        }
        const blob = await response.blob();
        if (blob.size === 0) {
          debugError(`[sync-resources] empty blob from ${content}`);
          continue;
        }

        const ext = blob.type === 'image/png' ? 'png'
          : blob.type === 'image/jpeg' ? 'jpg'
          : blob.type === 'image/webp' ? 'webp'
          : blob.type === 'image/gif' ? 'gif'
          : blob.type === 'image/svg+xml' ? 'svg'
          : blob.type.startsWith('video/') ? 'mp4'
          : blob.type.startsWith('audio/') ? 'mp3'
          : 'bin';
        const filename = `${Date.now()}.${ext}`;
        const mimeType = blob.type || 'application/octet-stream';

        const result = await uploadBlobContentToCloud(blob, filename, mimeType);
        if (result) {
          data.storageKey = result.storageKey;
          debugLog(`[sync-resources] set storageKey for blob content node: ${result.storageKey}`);
        }
      } catch (err) {
        // blob URL 失效: 跨浏览器/页面刷新后不可 fetch(TypeError 是预期行为)。
        // 记录失效 URL 并清理死引用, 后续同步不再重复 fetch(控制台不会被
        // net::ERR_FILE_NOT_FOUND 刷屏), 推送的 scene 也不含无效 blob URL。
        if (content?.startsWith('blob:') && (err instanceof TypeError || err instanceof DOMException)) {
          failedBlobUrls.add(content);
          delete data.content;
          debugLog(`[sync-resources] blob URL not available in this session, cleared dead content`);
        } else {
          debugError(`[sync-resources] upload blob content failed:`, err);
        }
      }
    }
  }

  // 第二遍:将本地 storageKey 替换为云端 storageKey
  for (const node of nodes) {
    if (typeof node !== 'object' || !node) continue;
    const data = (node as Record<string, unknown>).data as Record<string, unknown> | undefined;
    if (!data) continue;

    const localKey = data.storageKey as string | undefined;
    const cloudKey = storageKeyMap.get(localKey ?? '');
    if (cloudKey) {
      data.storageKey = cloudKey;
    }
  }
}

// ===== 从云端同步节点资源到本地 =====

/**
 * 从云端同步节点资源到本地
 *
 * 遍历节点,将云端 storageKey 指向的资源下载到本地 localforage,
 * 并将 data.content 更新为本地 blob URL。
 */
async function syncProjectResourcesFromCloud(nodes: any[]): Promise<void> {
  for (const node of nodes) {
    if (typeof node !== 'object' || !node) continue;
    const data = (node as Record<string, unknown>).data as Record<string, unknown> | undefined;
    if (!data) continue;

    const storageKey = data.storageKey as string | undefined;
    if (!storageKey) continue;

    let blobUrl: string | undefined;
    let isLocalKey = false;

    // Try to resolve from local storage first
    if (storageKey.startsWith('image:')) {
      blobUrl = await resolveImageUrl(storageKey);
      isLocalKey = true;
    } else if (storageKey.startsWith('video:') || storageKey.startsWith('audio:')) {
      blobUrl = await resolveMediaUrl(storageKey);
      isLocalKey = true;
    }

    if (blobUrl) {
      data.content = blobUrl;
      continue;
    }

    // Local key but not found locally - skip
    if (isLocalKey) continue;

    // Cloud storage key (统一前缀 resources/{userId}/{hashPrefix}/{hash}), download from MinIO
    try {
      const apiBase = getApiBaseUrl();
      const downloadUrl = `${apiBase}/storage/get?key=${encodeURIComponent(storageKey)}`;
      const token = getToken();
      const res = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        debugLog(`[sync-resources] download resource ${storageKey} failed: ${res.status}`);
        // 资源已丢失(404)，自动清理 storageKey
        if (res.status === 404) {
          delete data.storageKey;
          if (data.content && typeof data.content === 'string' && data.content.includes('/storage/get?')) {
            delete data.content;
          }
        } else if (!data.content) {
          data.content = downloadUrl;
        }
        continue;
      }
      const blob = await res.blob();

      if (blob.type.startsWith('image/')) {
        blobUrl = await setImageBlob(storageKey, blob);
      } else {
        blobUrl = await setMediaBlob(storageKey, blob);
      }

      if (blobUrl) {
        data.content = blobUrl;
      }
    } catch (err) {
      debugError(`[sync-resources] download resource ${storageKey} from MinIO failed:`, err);
    }
  }
}

// ===== 保存画布资源到素材库 =====

/**
 * 保存画布节点中的资源到"我的素材"库
 *
 * 从节点数据中提取 storageKey，获取 blob 后上传到云端 MinIO，
 * 创建 Asset 记录并返回创建的 Asset 对象。
 *
 * @param node - 画布节点对象
 * @param assetKind - 资源类型('image' | 'video' | 'audio')
 * @returns 创建的 Asset 对象，失败返回 null
 */
async function saveCanvasResourceToAssets(node: NodeRecord, assetKind: string): Promise<Asset | null> {
  try {
    const nodeData = node.data as Record<string, unknown> | undefined;
    const storageKey = nodeData?.storageKey as string | undefined;
    if (!storageKey) {
      debugError('[sync-resources] saveCanvasResourceToAssets: node has no storageKey');
      return null;
    }

    // Get blob from local storage
    const blob = assetKind === 'image' ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
    if (!blob) {
      debugError(`[sync-resources] saveCanvasResourceToAssets: blob not found for ${storageKey}`);
      return null;
    }

    // Upload to MinIO and create Asset record
    // CAS 去重:计算内容哈希,避免同一资源重复上传
    const contentHash = await computeBlobHash(blob);
    const presign = await apiPost<PresignResponse>('/resources/presign', {
      filename: storageKey,
      mimeType: blob.type,
      size: blob.size,
      contentHash,
    });

    // uploadUrl 为 null 表示去重命中,跳过上传
    if (presign.uploadUrl) {
      await apiPutBinary(presign.uploadUrl, blob, blob.type);
    }

    const kind = assetKind as AssetKind;
    const dims = kind === 'image' || kind === 'video'
      ? { width: 0, height: 0 }
      : {};
    const duration = kind === 'video' || kind === 'audio'
      ? { duration: 0 }
      : {};

    const cloud = await apiPost<CloudAsset>('/resources', {
      kind,
      filename: storageKey,
      storageKey: presign.storageKey,
      mimeType: blob.type,
      size: blob.size,
      tags: [],
      ...dims,
      ...duration,
    });

    // Create local Asset record
    const asset: Asset = {
      id: cloud.id,
      title: cloud.filename,
      kind,
      coverUrl: undefined,
      tags: cloud.tags,
      createdAt: cloud.createdAt,
      bytes: Number(cloud.size),
      mimeType: cloud.mimeType,
      data:
        kind === 'image'
          ? { kind: 'image', dataUrl: '', storageKey: presign.storageKey, width: cloud.width ?? undefined, height: cloud.height ?? undefined }
          : kind === 'video'
            ? { kind: 'video', url: '', storageKey: presign.storageKey, width: cloud.width ?? undefined, height: cloud.height ?? undefined, durationMs: cloud.duration ? cloud.duration * 1000 : undefined }
            : { kind: 'audio', url: '', storageKey: presign.storageKey, durationMs: cloud.duration ? cloud.duration * 1000 : undefined },
      cloudId: cloud.id,
      version: cloud.version,
      lastSyncedAt: cloud.lastSyncedAt,
    };

    await upsertAsset(asset);
    return asset;
  } catch (err) {
    debugError(`[sync-resources] saveCanvasResourceToAssets failed:`, err);
    return null;
  }
}

// ===== 导出 =====

export { computeBlobHash, uploadBlobContentToCloud, syncProjectResourcesToCloud, syncProjectResourcesFromCloud, saveCanvasResourceToAssets };
export type { PresignResponse };