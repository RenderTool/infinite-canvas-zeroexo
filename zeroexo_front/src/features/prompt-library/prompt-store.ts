/**
 * 提示词元数据存储(Phase D3.1)
 *
 * 管理用户提示词库,支持创建/编辑/分类/收藏/标签。
 * 存储桶: app_state, key: zeroexo:prompts
 *
 * 设计参考: asset-store.ts(同一套 localforage + 纯函数 API 模式)
 */

import localforage from 'localforage';
import { nanoid } from 'nanoid';

// ===== 类型定义 =====

/** 拖拽 MIME 类型(与 prompt-library-page.tsx 的 PROMPT_DRAG_MIME 保持一致) */
export const PROMPT_DRAG_MIME = 'application/x-canvas-prompt';

/** 提示词分类 */
export type PromptCategory = 'role' | 'scene' | 'style' | 'shot' | 'other';

/** 提示词条目 */
export interface Prompt {
  id: string;
  title: string;
  content: string;
  contentEn?: string;
  contentJa?: string;
  note?: string;
  category: PromptCategory;
  tags: string[];
  favorite: boolean;
  imageKeys?: string[];
  source: 'local' | 'remote' | 'public-import';
  sourceRepo?: string;
  createdAt: string;
  updatedAt: string;
  /** 云端 ID(同步后设置,本地创建时为 undefined) */
  cloudId?: string;
  /** 云端版本号(用于冲突检测) */
  version?: number;
  /** 最后同步时间(ISO 字符串,null 表示从未同步) */
  lastSyncedAt?: string | null;
}

/** 新建提示词输入 */
export interface CreatePromptInput {
  title: string;
  content: string;
  contentEn?: string;
  contentJa?: string;
  note?: string;
  category: PromptCategory;
  tags?: string[];
  favorite?: boolean;
  imageKeys?: string[];
  source?: 'local' | 'remote' | 'public-import';
}

/** 更新提示词输入(部分字段) */
export interface UpdatePromptInput {
  title?: string;
  content?: string;
  contentEn?: string;
  contentJa?: string;
  note?: string;
  category?: PromptCategory;
  tags?: string[];
  favorite?: boolean;
  imageKeys?: string[];
  source?: 'local' | 'remote' | 'public-import';
}

/** 拖拽到画布的 payload(与 application/x-canvas-prompt MIME 对应) */
export interface InsertPromptPayload {
  title: string;
  content: string;
}

// ===== 分类元数据 =====

export const PROMPT_CATEGORIES: { value: PromptCategory; labelKey: string }[] = [
  { value: 'role', labelKey: 'prompt.categoryRole' },
  { value: 'scene', labelKey: 'prompt.categoryScene' },
  { value: 'style', labelKey: 'prompt.categoryStyle' },
  { value: 'shot', labelKey: 'prompt.categoryShot' },
  { value: 'other', labelKey: 'prompt.categoryOther' },
];

// ===== localforage 实例(app_state 桶) =====

const appStateStore = localforage.createInstance({
  name: 'zeroexo',
  storeName: 'app_state',
});

const PROMPTS_KEY = 'zeroexo:prompts';

// ===== 内部辅助 =====

async function readAll(): Promise<Prompt[]> {
  const list = await appStateStore.getItem<Prompt[]>(PROMPTS_KEY);
  if (!list) return [];
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function writeAll(list: Prompt[]): Promise<void> {
  await appStateStore.setItem(PROMPTS_KEY, list);
}

function now(): string {
  return new Date().toISOString();
}

// ===== 公开 API =====

/** 列出所有提示词(按 updatedAt 降序) */
export async function listPrompts(): Promise<Prompt[]> {
  return readAll();
}

/** 新增提示词 */
export async function addPrompt(input: CreatePromptInput): Promise<Prompt> {
  const ts = now();
  const prompt: Prompt = {
    id: nanoid(),
    title: input.title.trim() || '未命名提示词',
    content: input.content,
    contentEn: input.contentEn,
    contentJa: input.contentJa,
    note: input.note,
    category: input.category,
    tags: input.tags ?? [],
    favorite: input.favorite ?? false,
    imageKeys: input.imageKeys,
    source: input.source ?? 'local',
    createdAt: ts,
    updatedAt: ts,
  };
  const list = await readAll();
  list.push(prompt);
  await writeAll(list);
  return prompt;
}

/** 更新提示词(部分字段) */
export async function updatePrompt(id: string, patch: UpdatePromptInput): Promise<Prompt | null> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const current = list[idx];
  if (!current) return null;
  const updated: Prompt = {
    ...current,
    title: patch.title ?? current.title,
    content: patch.content ?? current.content,
    contentEn: patch.contentEn !== undefined ? patch.contentEn : current.contentEn,
    contentJa: patch.contentJa !== undefined ? patch.contentJa : current.contentJa,
    note: patch.note !== undefined ? patch.note : current.note,
    category: patch.category ?? current.category,
    tags: patch.tags ?? current.tags,
    favorite: patch.favorite ?? current.favorite,
    imageKeys: patch.imageKeys ?? current.imageKeys,
    source: patch.source ?? current.source,
    updatedAt: now(),
  };
  list[idx] = updated;
  await writeAll(list);
  return updated;
}

/** 删除提示词 */
export async function removePrompt(id: string): Promise<Prompt | null> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const removed = list.splice(idx, 1);
  await writeAll(list);
  return removed[0] ?? null;
}

/** 批量删除提示词 */
export async function removePrompts(ids: string[]): Promise<Prompt[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const list = await readAll();
  const deleted: Prompt[] = [];
  const remaining: Prompt[] = [];
  for (const p of list) {
    if (idSet.has(p.id)) deleted.push(p);
    else remaining.push(p);
  }
  await writeAll(remaining);
  return deleted;
}

/** 清空所有提示词 */
export async function clearAllPrompts(): Promise<void> {
  await appStateStore.removeItem(PROMPTS_KEY);
}

/**
 * 插入或更新提示词(同步拉取时使用)
 * 按 cloudId 匹配已有提示词,存在则更新,不存在则插入
 */
export async function upsertPrompt(prompt: Prompt): Promise<void> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.cloudId && p.cloudId === prompt.cloudId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...prompt };
  } else {
    list.push(prompt);
  }
  await writeAll(list);
}

/**
 * 标记提示词已同步(更新 cloudId + version + lastSyncedAt)
 */
export async function markPromptSynced(
  localId: string,
  cloudId: string,
  version: number,
  lastSyncedAt: string,
): Promise<void> {
  const list = await readAll();
  const idx = list.findIndex((p) => p.id === localId);
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
