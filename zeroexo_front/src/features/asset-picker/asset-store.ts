/**
 * 素材元数据存储(Phase D2.1)
 *
 * 管理用户素材库的元数据列表,独立于实际的图片/媒体文件二进制存储。
 * - 元数据(本文件): 存于 app_state 桶, key: zeroexo:assets
 * - 二进制文件: 由 persistence 插件的 image-storage / file-storage 管理
 *   (image_files / media_files 桶, key 由 storageKey 字段引用)
 *
 * 设计参考: project-store.ts(同一套 localforage + 纯函数 API 模式)
 */

import localforage from 'localforage';
import { nanoid } from 'nanoid';
import type { Asset, AssetKind } from './index.js';

// ===== 类型定义 =====

/** 新建素材时的输入(由 upload-asset 服务构造) */
export interface CreateAssetInput {
  title: string;
  kind: AssetKind;
  coverUrl?: string;
  tags?: string[];
  bytes: number;
  mimeType?: string;
  data: Asset['data'];
  folderId?: string | null;
}

/** 更新素材时的输入(部分字段) */
export type UpdateAssetInput = Partial<Pick<Asset, 'title' | 'tags' | 'coverUrl' | 'folderId' | 'data' | 'favorite' | 'cloudId'>>;

// ===== localforage 实例(app_state 桶,与 project-store 共用) =====

const appStateStore = localforage.createInstance({
  name: 'zeroexo',
  storeName: 'app_state',
});

/** 存储素材列表的 key */
const ASSETS_KEY = 'zeroexo:assets';

// ===== 内部辅助 =====

/** 读取全部素材(按 createdAt 降序,最新在前) */
async function readAll(): Promise<Asset[]> {
  const list = await appStateStore.getItem<Asset[]>(ASSETS_KEY);
  if (!list) return [];
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 写入全部素材 */
async function writeAll(list: Asset[]): Promise<void> {
  await appStateStore.setItem(ASSETS_KEY, list);
}

/** 生成当前 ISO 时间字符串 */
function now(): string {
  return new Date().toISOString();
}

// ===== 公开 API =====

/**
 * 列出所有素材(按 createdAt 降序)
 */
export async function listAssets(): Promise<Asset[]> {
  return readAll();
}

/**
 * 新增素材元数据
 * @param input 由 upload-asset 服务构造的输入(含 storageKey 等)
 * @returns 新创建的 Asset(含生成的 id 与时间戳)
 */
export async function addAsset(input: CreateAssetInput): Promise<Asset> {
  const asset: Asset = {
    id: nanoid(),
    title: input.title.trim() || '未命名素材',
    kind: input.kind,
    coverUrl: input.coverUrl,
    tags: input.tags ?? [],
    createdAt: now(),
    bytes: input.bytes,
    mimeType: input.mimeType,
    data: input.data,
    folderId: input.folderId ?? null,
    favorite: false,
  };
  const list = await readAll();
  list.push(asset);
  await writeAll(list);
  return asset;
}

/**
 * 批量新增素材元数据（单次读写，避免逐条读写导致的竞态问题）
 * @param inputs 由 upload-asset 服务构造的输入数组
 * @returns 新创建的 Asset 数组
 */
export async function addAssets(inputs: CreateAssetInput[]): Promise<Asset[]> {
  if (inputs.length === 0) return [];
  const list = await readAll();
  const nowStr = now();
  const created: Asset[] = inputs.map((input) => ({
    id: nanoid(),
    title: input.title.trim() || '未命名素材',
    kind: input.kind,
    coverUrl: input.coverUrl,
    tags: input.tags ?? [],
    createdAt: nowStr,
    bytes: input.bytes,
    mimeType: input.mimeType,
    data: input.data,
    folderId: input.folderId ?? null,
    favorite: false,
  }));
  // 追加而非 unshift，保持 createdAt 降序排序由 readAll 保证
  for (const asset of created) list.push(asset);
  await writeAll(list);
  return created;
}

/**
 * 更新素材元数据(部分字段,自动更新 createdAt 以提升排序)
 */
export async function updateAsset(id: string, patch: UpdateAssetInput): Promise<Asset | null> {
  const list = await readAll();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const current = list[idx];
  if (!current) return null;
  const updated: Asset = {
    ...current,
    title: patch.title ?? current.title,
    tags: patch.tags ?? current.tags,
    coverUrl: patch.coverUrl ?? current.coverUrl,
    folderId: patch.folderId !== undefined ? patch.folderId : current.folderId,
    data: patch.data ?? current.data,
    favorite: patch.favorite !== undefined ? patch.favorite : current.favorite,
    cloudId: patch.cloudId !== undefined ? patch.cloudId : current.cloudId,
    createdAt: now(),
  };
  list[idx] = updated;
  await writeAll(list);
  return updated;
}

/**
 * 删除单个素材元数据
 * 仅删除素材记录,不删除底层资源文件。
 * 资源生命周期由后端引用计数管理。
 */
export async function removeAsset(id: string): Promise<Asset | null> {
  const list = await readAll();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const removed = list.splice(idx, 1);
  await writeAll(list);
  return removed[0] ?? null;
}

/**
 * 批量删除素材元数据
 * @param ids 要删除的素材 id 数组
 * 仅删除素材记录,不删除底层资源文件(由后端引用计数管理)。
 */
export async function removeAssets(ids: string[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const list = await readAll();
  const deleted: Asset[] = [];
  const remaining: Asset[] = [];
  for (const a of list) {
    if (idSet.has(a.id)) deleted.push(a);
    else remaining.push(a);
  }
  await writeAll(remaining);
  return deleted;
}

/**
 * 清空所有素材元数据(不清理二进制文件)
 * 危险操作,仅供"清空全部"或测试使用
 */
export async function clearAllAssets(): Promise<void> {
  await appStateStore.removeItem(ASSETS_KEY);
}

/**
 * 插入或更新素材(同步拉取时使用)
 * 按 cloudId 匹配已有素材,存在则更新,不存在则插入
 */
export async function upsertAsset(asset: Asset): Promise<void> {
  const list = await readAll();
  const idx = list.findIndex((a) => a.cloudId && a.cloudId === asset.cloudId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...asset };
  } else {
    list.push(asset);
  }
  await writeAll(list);
}

/**
 * 标记素材已同步(更新 cloudId + version + lastSyncedAt)
 */
export async function markAssetSynced(
  localId: string,
  cloudId: string,
  version: number,
  lastSyncedAt: string,
): Promise<void> {
  const list = await readAll();
  const idx = list.findIndex((a) => a.id === localId);
  if (idx >= 0) {
    const current = list[idx];
    if (current) {
      list[idx] = {
        ...current,
        cloudId,
        version,
        lastSyncedAt,
      };
      await writeAll(list);
    }
  }
}
