import { apiGet, apiPost, apiPatch, apiDelete } from '../api-client.js';
import {
  listPrompts,
  upsertPrompt,
  markPromptSynced,
  removePrompt,
} from '@/features/prompt-library/prompt-store.js';
import type { Prompt } from '@/features/prompt-library/prompt-store.js';
import { debugLog, debugError } from './sync-utils.js';
import { isOnline } from './sync-store.js';

// ===== 类型定义 =====

interface CloudPrompt {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  contentEn?: string | null;
  contentJa?: string | null;
  note?: string | null;
  category: string;
  tags: string[];
  /** 生成模式(征集 #79):文生图/图生图,旧数据缺省→文生图 */
  generationMode?: string | null;
  source: string;
  sourceRepo?: string | null;
  favorite: boolean;
  imageKeys?: string[] | null;
  version: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CloudPromptList {
  items: CloudPrompt[];
  nextCursor: string | null;
}

// ===== 内部辅助函数 =====

/**
 * 推送单个提示词到云端(创建或更新)
 */
async function pushPromptToCloud(localOrId: Prompt | string): Promise<void> {
  let local: Prompt | undefined;
  if (typeof localOrId === 'string') {
    const localList = await listPrompts();
    local = localList.find((p) => p.id === localOrId);
    if (!local) return;
  } else {
    local = localOrId;
  }
  let cloud: CloudPrompt;
  if (!local.cloudId) {
    cloud = await apiPost<CloudPrompt>('/prompts', {
      id: local.id,
      title: local.title,
      content: local.content,
      contentEn: local.contentEn,
      contentJa: local.contentJa,
      note: local.note,
      category: local.category,
      tags: local.tags,
      favorite: local.favorite,
      generationMode: local.generationMode ?? 'txt2img',
      imageKeys: local.imageKeys,
    });
  } else {
    cloud = await apiPatch<CloudPrompt>(`/prompts/${local.cloudId}`, {
      title: local.title,
      content: local.content,
      contentEn: local.contentEn,
      contentJa: local.contentJa,
      note: local.note,
      category: local.category,
      tags: local.tags,
      favorite: local.favorite,
      ...(local.generationMode !== undefined ? { generationMode: local.generationMode } : {}),
      imageKeys: local.imageKeys,
    });
  }
  await markPromptSynced(local.id, cloud.id, cloud.version, cloud.lastSyncedAt ?? new Date().toISOString());
}

// ===== 公开函数 =====

/**
 * 拉取云端提示词列表，合并到本地存储
 */
async function pullCloudPrompts(): Promise<void> {
  const cloudIds = new Set<string>();
  // 预先构建本地提示词映射，避免 mergeCloudPromptToLocal 中每次扫描全量列表
  const localMap = new Map<string, Prompt>();
  const localList = await listPrompts();
  for (const p of localList) {
    if (p.cloudId) localMap.set(p.cloudId, p);
  }

  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res: CloudPromptList = await apiGet<CloudPromptList>(`/prompts${query}`);
    for (const cloud of res.items) {
      cloudIds.add(cloud.id);
      const local = localMap.get(cloud.id);
      await mergeCloudPromptToLocal(cloud, local);
    }
    cursor = res.nextCursor;
  } while (cursor);

  for (const local of localList) {
    if (local.cloudId && !cloudIds.has(local.cloudId)) {
      try {
        await removePrompt(local.id);
        debugLog(`[sync-service] removed stale prompt ${local.id} (cloudId ${local.cloudId} no longer exists)`);
      } catch (err) {
        debugError(`[sync-service] remove stale prompt ${local.id} failed:`, err);
      }
    }
  }
}

/**
 * 合并云端提示词到本地
 */
async function mergeCloudPromptToLocal(cloud: CloudPrompt, local?: Prompt): Promise<void> {
  if (!local) {
    const prompt: Prompt = {
      id: cloud.id,
      title: cloud.title,
      content: cloud.content,
      contentEn: cloud.contentEn ?? undefined,
      contentJa: cloud.contentJa ?? undefined,
      note: cloud.note ?? undefined,
      category: cloud.category as Prompt['category'],
      tags: cloud.tags,
      favorite: cloud.favorite,
      generationMode: (cloud.generationMode === 'img2img' ? 'img2img' : 'txt2img') as Prompt['generationMode'],
      imageKeys: cloud.imageKeys ?? undefined,
      source: cloud.source as 'local' | 'remote',
      sourceRepo: cloud.sourceRepo ?? undefined,
      createdAt: cloud.createdAt,
      updatedAt: cloud.updatedAt,
      cloudId: cloud.id,
      version: cloud.version,
      lastSyncedAt: cloud.lastSyncedAt,
    };
    await upsertPrompt(prompt);
    return;
  }

  if (cloud.version > (local.version ?? 0)) {
    const updated: Prompt = {
      ...local,
      title: cloud.title,
      content: cloud.content,
      contentEn: cloud.contentEn ?? undefined,
      contentJa: cloud.contentJa ?? undefined,
      note: cloud.note ?? undefined,
      category: cloud.category as Prompt['category'],
      tags: cloud.tags,
      favorite: cloud.favorite,
      generationMode: (cloud.generationMode === 'img2img' ? 'img2img' : 'txt2img') as Prompt['generationMode'],
      imageKeys: cloud.imageKeys ?? undefined,
      sourceRepo: cloud.sourceRepo ?? undefined,
      version: cloud.version,
      lastSyncedAt: cloud.lastSyncedAt,
    };
    await upsertPrompt(updated);
  }
}

/**
 * 推送本地所有未同步的提示词到云端
 */
async function pushLocalPrompts(): Promise<void> {
  const localList = await listPrompts();
  for (const local of localList) {
    if (!local.cloudId) {
      try {
        await pushPromptToCloud(local);
      } catch (err) {
        debugLog(`[sync-service] push prompt ${local.id} failed, will retry later:`, err);
      }
    }
  }
}

/**
 * 提示词创建事件
 */
async function onPromptCreated(localId: string): Promise<void> {
  if (isOnline()) {
    try {
      await pushPromptToCloud(localId);
    } catch (err) {
      debugLog(`[sync-service] onPromptCreated ${localId} failed, will retry later:`, err);
    }
  }
}

/**
 * 提示词更新事件
 */
async function onPromptUpdated(localId: string): Promise<void> {
  if (isOnline()) {
    try {
      await pushPromptToCloud(localId);
    } catch (err) {
      debugLog(`[sync-service] onPromptUpdated ${localId} failed, will retry later:`, err);
    }
  }
}

/**
 * 提示词删除事件
 */
async function onPromptDeleted(localId: string, cloudId?: string): Promise<void> {
  if (cloudId && isOnline()) {
    try {
      await apiDelete(`/prompts/${cloudId}`);
    } catch (err) {
      debugLog(`[sync-service] onPromptDeleted ${localId} failed, will retry later:`, err);
    }
  }
}

export { pullCloudPrompts, mergeCloudPromptToLocal, pushLocalPrompts, onPromptCreated, onPromptUpdated, onPromptDeleted };