/**
 * sync-assets - 资产同步模块
 *
 * 从 sync-service.ts 提取的资产同步相关功能
 */

import {
  getImageBlob,
  setImageBlob,
  getMediaBlob,
  setMediaBlob,
  resolveImageUrl,
  resolveMediaUrl,
} from '@zeroexo/plugin-persistence';
import { apiGet, apiPost, apiPatch, apiDelete, apiPutBinary } from '../api-client.js';
import {
  listAssets,
  upsertAsset,
  markAssetSynced,
  removeAsset,
  getStorageKeyOfAsset,
} from '@/features/asset-picker/asset-store.js';
import type { Asset, AssetKind } from '@/features/asset-picker/index.js';
import { isOnline } from './sync-store.js';
import { debugLog, debugError } from './sync-utils.js';
import { computeBlobHash } from './sync-resources.js';

// ===== 类型定义 =====

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

interface CloudAssetList {
  items: CloudAsset[];
  nextCursor: string | null;
}

interface PresignResponse {
  /** CAS 去重命中时为 null(客户端跳过上传);否则为预签名上传 URL */
  uploadUrl: string | null;
  storageKey: string;
}

// ===== 函数实现 =====

async function pullCloudAssets(): Promise<void> {
  const cloudIds = new Set<string>();
  // 预先构建本地资产映射,避免 mergeCloudAssetToLocal 中每次扫描全量列表;
  // 征集 #74:另建无 cloudId 幽灵记录的 storageKey 映射,同文件命中云端时归并而非新建孪生。
  const localAssetMap = new Map<string, Asset>();
  const localByKey = new Map<string, Asset>();
  const localAssets = await listAssets();
  for (const a of localAssets) {
    if (a.cloudId) localAssetMap.set(a.cloudId, a);
    const k = getStorageKeyOfAsset(a);
    if (k && !a.cloudId && !localByKey.has(k)) localByKey.set(k, a);
  }

  let cursor: string | null = null;
  do {
    const baseQuery = 'category=user';
    const queryStr: string = cursor ? `${baseQuery}&cursor=${encodeURIComponent(cursor)}` : baseQuery;
    const res: CloudAssetList = await apiGet<CloudAssetList>(`/resources?${queryStr}`);
    for (const cloud of res.items) {
      cloudIds.add(cloud.id);
      let local = localAssetMap.get(cloud.id);
      if (!local) {
        // 补全:本地无 cloudId 但 id 匹配云端 id(通过 /resources/scripts 创建,本地 id = 云端 id)
        // 只补全元数据(cloudId/version/lastSyncedAt),不覆盖本地 content(本地可能比云端新)
        const matchById = localAssets.find((a) => a.id === cloud.id && !a.cloudId);
        if (matchById) {
          await markAssetSynced(matchById.id, cloud.id, cloud.version, cloud.lastSyncedAt ?? new Date().toISOString());
          local = { ...matchById, cloudId: cloud.id, version: cloud.version, lastSyncedAt: cloud.lastSyncedAt };
          localAssetMap.set(cloud.id, local);
          // 跳过 mergeCloudAssetToLocal,避免云端旧 text 覆盖本地新编辑的 content。
          continue;
        }
        // 征集 #74:无 cloudId 幽灵记录按 storageKey 命中云端同文件 → 归并身份,
        // 不再新建孪生记录(否则同图两条显示 + 删除后幽灵重推复活)。
        const ghost = cloud.storageKey ? localByKey.get(cloud.storageKey) : undefined;
        if (ghost) {
          await markAssetSynced(ghost.id, cloud.id, cloud.version, cloud.lastSyncedAt ?? new Date().toISOString());
          localByKey.delete(cloud.storageKey);
          local = { ...ghost, cloudId: cloud.id, version: cloud.version, lastSyncedAt: cloud.lastSyncedAt };
          localAssetMap.set(cloud.id, local);
        }
      }
      await mergeCloudAssetToLocal(cloud, local);
    }
    cursor = res.nextCursor;
  } while (cursor);

  for (const local of localAssets) {
    if (local.cloudId && !cloudIds.has(local.cloudId)) {
      try {
        await removeAsset(local.id);
        debugLog(`[sync-service] removed stale asset ${local.id} (cloudId ${local.cloudId} no longer exists)`);
      } catch (err) {
        debugError(`[sync-service] remove stale asset ${local.id} failed:`, err);
      }
    }
  }
}

async function mergeCloudAssetToLocal(cloud: CloudAsset, local?: Asset): Promise<void> {
  if (local && cloud.version <= (local.version ?? 0)) return;

  if (cloud.kind === 'text' || cloud.kind === 'script') {
    const asset: Asset = {
      id: local?.id ?? cloud.id,
      title: cloud.filename,
      kind: cloud.kind as Asset['kind'],
      tags: cloud.tags,
      createdAt: cloud.createdAt,
      bytes: Number(cloud.size),
      mimeType: cloud.mimeType,
      data: { kind: cloud.kind as 'text', content: cloud.text ?? '' },
      cloudId: cloud.id,
      version: cloud.version,
      lastSyncedAt: cloud.lastSyncedAt,
    };
    await upsertAsset(asset);
    return;
  }

  const kind = cloud.kind as AssetKind;

  // 优先使用云端的 storageKey（resources/ 前缀），确保跨设备/跨浏览器可访问
  // 仅当云端无 storageKey 时，才降级到本地 blob 存储
  let storageKey = cloud.storageKey && cloud.storageKey.startsWith('resources/')
    ? cloud.storageKey
    : local?.data?.kind === kind ? (local.data as { storageKey?: string }).storageKey : undefined;
  let blobUrl: string | undefined;

  // 如果是后端 storageKey（resources/ 前缀），不需要下载 blob，直接构造后端 URL
  if (storageKey && storageKey.startsWith('resources/')) {
    // 后端 URL 由 useHydratedContent 在渲染时构造，这里不需要 blobUrl
    blobUrl = undefined;
  } else if (!storageKey) {
    // 本地无 storageKey 且云端无 resources/ key，降级到本地 blob 存储
    const prefix = kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'audio';
    storageKey = `${prefix}:cloud-${cloud.id}`;
    try {
      const { url: downloadUrl } = await apiGet<{ url: string }>(`/resources/${cloud.id}/download`);
      const res = await fetch(downloadUrl);
      const blob = await res.blob();
      if (kind === 'image') {
        blobUrl = await setImageBlob(storageKey, blob);
      } else {
        blobUrl = await setMediaBlob(storageKey, blob);
      }
    } catch (err) {
      debugError(`[sync-service] download asset binary ${cloud.id} failed:`, err);
      return;
    }
  } else {
    // 本地有 storageKey（非 resources/ 前缀），尝试从 localforage 读取
    if (kind === 'image') {
      blobUrl = await resolveImageUrl(storageKey);
    } else {
      blobUrl = await resolveMediaUrl(storageKey);
    }
    if (!blobUrl) {
      try {
        const { url: downloadUrl } = await apiGet<{ url: string }>(`/resources/${cloud.id}/download`);
        const res = await fetch(downloadUrl);
        const blob = await res.blob();
        if (kind === 'image') {
          blobUrl = await setImageBlob(storageKey, blob);
        } else {
          blobUrl = await setMediaBlob(storageKey, blob);
        }
      } catch (err) {
        debugError(`[sync-service] download asset binary ${cloud.id} failed:`, err);
        return;
      }
    }
  }

  // 后端 storageKey 不需要 blobUrl，由 useHydratedContent 在渲染时构造后端 URL
  const isBackendKey = storageKey && storageKey.startsWith('resources/');
  if (!isBackendKey && !blobUrl) {
    debugError(`[sync-service] asset ${cloud.id} has no blob URL, skipping`);
    return;
  }

  // 对于后端 storageKey，使用后端 URL 作为 coverUrl 和 dataUrl/url
  // 这样即使 localforage 中无数据，也能通过后端 URL 显示
  const coverUrl = isBackendKey ? undefined : blobUrl;
  const dataUrlOrUrl = isBackendKey ? '' : (blobUrl ?? '');

  const asset: Asset = {
    id: local?.id ?? cloud.id,
    title: cloud.filename,
    kind,
    coverUrl: kind === 'image' ? coverUrl : undefined,
    tags: cloud.tags,
    createdAt: cloud.createdAt,
    bytes: Number(cloud.size),
    mimeType: cloud.mimeType,
    data:
      kind === 'image'
        ? { kind: 'image', dataUrl: dataUrlOrUrl, storageKey, width: cloud.width ?? undefined, height: cloud.height ?? undefined }
        : kind === 'video'
          ? { kind: 'video', url: dataUrlOrUrl, storageKey, width: cloud.width ?? undefined, height: cloud.height ?? undefined, durationMs: cloud.duration ? cloud.duration * 1000 : undefined }
          : { kind: 'audio', url: dataUrlOrUrl, storageKey, durationMs: cloud.duration ? cloud.duration * 1000 : undefined },
    cloudId: cloud.id,
    version: cloud.version,
    lastSyncedAt: cloud.lastSyncedAt,
  };
  await upsertAsset(asset);
}

async function pushLocalAssets(): Promise<void> {
  const cloudMap = await fetchCloudAssetMap();
  const cloudIds = new Set(cloudMap.keys());
  // 征集 #74:云端 storageKey → cloudId 映射 —— 幽灵记录(无 cloudId)若与云端同文件,
  // 只归并身份不重建(修复"用户在资产页删除后 30s 轮询原地复活"循环)。
  const cloudIdByKey = new Map<string, string>();
  for (const [cid, key] of cloudMap) {
    if (key && !cloudIdByKey.has(key)) cloudIdByKey.set(key, cid);
  }
  const localList = await listAssets();

  for (const local of localList) {
    if (local.cloudId && !cloudIds.has(local.cloudId)) {
      try {
        await removeAsset(local.id);
        debugLog(`[sync-service] removed local asset ${local.id} (cloudId ${local.cloudId} deleted remotely)`);
      } catch (err) {
        debugError(`[sync-service] remove deleted asset ${local.id} failed:`, err);
      }
      continue;
    }

    if (!local.cloudId) {
      const key = getStorageKeyOfAsset(local);
      const existingCloudId = key ? cloudIdByKey.get(key) : undefined;
      if (existingCloudId) {
        // 云端已有同文件:归并身份即完成同步,不再 POST /resources 重建
        try {
          await markAssetSynced(local.id, existingCloudId, 0, new Date().toISOString());
          debugLog(`[sync-service] merged ghost asset ${local.id} into existing cloud asset ${existingCloudId} (same storageKey ${key})`);
        } catch (err) {
          debugError(`[sync-service] merge ghost asset ${local.id} failed:`, err);
        }
        continue;
      }
      try {
        await pushAssetToCloud(local);
      } catch (err) {
        debugError(`[sync-service] push asset ${local.id} failed:`, err);
      }
    }
  }
}

async function fetchCloudAssetMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const baseQuery = 'category=user';
    const queryStr: string = cursor ? `${baseQuery}&cursor=${encodeURIComponent(cursor)}` : baseQuery;
    const res: CloudAssetList = await apiGet<CloudAssetList>(`/resources?${queryStr}`);
    for (const cloud of res.items) {
      map.set(cloud.id, cloud.storageKey ?? '');
    }
    cursor = res.nextCursor;
  } while (cursor);
  return map;
}

async function pushAssetToCloud(asset: Asset): Promise<string | undefined> {
  const local = asset;

  // Plan 资产为纯本地创作资产（内容含本地版本历史 data.history，无 storageKey/二进制文件）。
  // 若走云同步会被下方「missing local storageKey → 删除本地记录」分支误删，故整体跳过同步。
  if ((local.kind as string) === 'plan') {
    return undefined;
  }

  if (!local.cloudId) {
    if ((local.kind as string) === 'text' || (local.kind as string) === 'script') {
      const data = local.data as { content?: string };
      // 纯元数据资产(内容存后端 text 字段,无存储文件):不传 storageKey,由服务端自动生成,
      // 避免命中后端 resources/ 前缀校验
      const cloud = await apiPost<CloudAsset>('/resources', {
        kind: local.kind,
        filename: local.title,
        mimeType: local.mimeType ?? 'text/plain',
        size: local.bytes,
        text: typeof data.content === 'string' ? data.content : '',
        tags: local.tags ?? [],
      });
      await markAssetSynced(local.id, cloud.id, cloud.version, cloud.lastSyncedAt ?? new Date().toISOString());
      return cloud.id;
    }

    const data = local.data as { storageKey?: string; kind?: string; width?: number; height?: number; durationMs?: number };
    const localStorageKey = data.storageKey;
    if (!localStorageKey) {
      debugLog(`[sync-service] push asset ${local.id} missing local storageKey, auto-removing corrupted local record`);
      await removeAsset(local.id);
      return undefined;
    }
    // 后端已上传的资源(resources/ 前缀),跳过 blob 读取和 presign/PUT,直接创建 Asset 元数据
    // 避免重复上传 + 解决 "Asset binary not found locally"(后端上传不写 localforage)
    if (localStorageKey.startsWith('resources/')) {
      const dims = data.kind === 'image' || data.kind === 'video'
        ? { width: data.width, height: data.height }
        : {};
      const duration = data.kind === 'video' || data.kind === 'audio'
        ? { duration: (data.durationMs ?? 0) / 1000 }
        : {};
      const cloud = await apiPost<CloudAsset>('/resources', {
        kind: local.kind,
        filename: local.title,
        storageKey: localStorageKey,
        mimeType: local.mimeType ?? 'application/octet-stream',
        size: local.bytes,
        ...dims,
        ...duration,
        tags: local.tags ?? [],
      });
      await markAssetSynced(local.id, cloud.id, cloud.version, cloud.lastSyncedAt ?? new Date().toISOString());
      return cloud.id;
    }

    const blob = local.kind === 'image'
      ? await getImageBlob(localStorageKey)
      : await getMediaBlob(localStorageKey);
    if (!blob) {
      throw new Error('Asset binary not found locally');
    }

    // CAS 去重:计算内容哈希,避免同一资源重复上传
    const contentHash = await computeBlobHash(blob);
    const presign = await apiPost<PresignResponse>('/resources/presign', {
      filename: local.title,
      mimeType: local.mimeType ?? 'application/octet-stream',
      size: blob.size,
      contentHash,
    });

    // uploadUrl 为 null 表示去重命中,跳过上传但仍创建 Asset 元数据
    if (presign.uploadUrl) {
      await apiPutBinary(
        presign.uploadUrl,
        blob,
        local.mimeType ?? 'application/octet-stream',
      );
    }

    const dataAny = local.data as Record<string, unknown>;
    const dims = dataAny.kind === 'image' || dataAny.kind === 'video'
      ? { width: dataAny.width as number | undefined, height: dataAny.height as number | undefined }
      : {};
    const duration = dataAny.kind === 'video' || dataAny.kind === 'audio'
      ? { duration: ((dataAny.durationMs as number) ?? 0) / 1000 }
      : {};
    const cloud = await apiPost<CloudAsset>('/resources', {
      kind: local.kind,
      filename: local.title,
      storageKey: presign.storageKey,
      mimeType: local.mimeType ?? 'application/octet-stream',
      size: blob.size,
      ...dims,
      ...duration,
      tags: local.tags ?? [],
    });
    await markAssetSynced(local.id, cloud.id, cloud.version, cloud.lastSyncedAt ?? new Date().toISOString());
    return cloud.id;
  }

  const patch: Record<string, unknown> = {
    filename: local.title,
    tags: local.tags ?? [],
  };
  // 文本类资产(剧本)需要同步 content 到云端 text 字段
  if ((local.kind as string) === 'text' || (local.kind as string) === 'script') {
    const data = local.data as { content?: string };
    if (typeof data.content === 'string') {
      patch.text = data.content;
    }
  }
  const cloud = await apiPatch<CloudAsset>(`/resources/${local.cloudId}`, patch);
  // 同步本地 version/lastSyncedAt,避免 pull 时因 version 落后触发不必要覆盖
  await markAssetSynced(local.id, local.cloudId, cloud.version, cloud.lastSyncedAt ?? new Date().toISOString());
  return local.cloudId;
}

export async function onAssetCreated(localId: string): Promise<void> {
  if (isOnline()) {
    try {
      const localList = await listAssets();
      const local = localList.find((a) => a.id === localId);
      if (local) {
        await pushAssetToCloud(local);
      }
    } catch (err) {
      debugError(`[sync-service] onAssetCreated ${localId} failed:`, err);
    }
  }
}

// 资产云端推送防抖:per-asset 2s,避免高频编辑(500ms 本地保存)导致频繁 API 调用
const assetPushDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const ASSET_PUSH_DEBOUNCE_MS = 2000;

export function onAssetUpdated(localId: string): void {
  if (!isOnline()) return;
  const prev = assetPushDebounce.get(localId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(async () => {
    assetPushDebounce.delete(localId);
    try {
      const localList = await listAssets();
      const local = localList.find((a) => a.id === localId);
      if (local) {
        await pushAssetToCloud(local);
      }
    } catch (err) {
      debugError(`[sync-service] onAssetUpdated ${localId} failed:`, err);
    }
  }, ASSET_PUSH_DEBOUNCE_MS);
  assetPushDebounce.set(localId, timer);
}

export async function onAssetDeleted(localId: string, cloudId?: string): Promise<void> {
  if (cloudId && isOnline()) {
    try {
      await apiDelete(`/resources/${cloudId}`);
    } catch (err) {
      debugError(`[sync-service] onAssetDeleted ${localId} failed:`, err);
    }
  }
}

export { pullCloudAssets, mergeCloudAssetToLocal, pushLocalAssets, pushAssetToCloud };