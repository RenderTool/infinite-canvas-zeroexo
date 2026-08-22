/**
 * shared-data-store - 提示词共享数据缓存层
 *
 * 模块级外部 store（useSyncExternalStore），供 AssetLibraryPage 与
 * AssetLibraryModal 等多个 useAssetLibrary 实例共享同一份数据：
 * - TTL 内（30s）重复进入直接复用缓存，后台静默 revalidate（stale-while-revalidate）
 * - 并发请求用单例 Promise 去重，避免多实例同时挂载引发重复 API 请求
 * - 写操作（增/删/改/收藏/重命名）后调用 refresh(force) 强制刷新
 * - loading 仅在首次加载（无缓存数据）时为 true，后续刷新不打断 UI
 */

import { useCallback, useSyncExternalStore } from 'react';
import { listPrompts, type Prompt } from './prompts-api.js';

/** 缓存有效期：30s 内重复挂载不发请求 */
const TTL_MS = 30_000;

interface DataSlice<T> {
  data: T[];
  /** 仅首次加载（尚无缓存）时为 true */
  loading: boolean;
  /** 最近一次成功拉取时间戳（0 = 从未拉取） */
  fetchedAt: number;
}

let promptsSlice: DataSlice<Prompt> = { data: [], loading: false, fetchedAt: 0 };

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isFresh(fetchedAt: number): boolean {
  return fetchedAt > 0 && Date.now() - fetchedAt < TTL_MS;
}

// ── 提示词 ──

let promptsInflight: Promise<void> | null = null;

async function fetchPrompts(force: boolean): Promise<void> {
  if (!force && isFresh(promptsSlice.fetchedAt)) return;
  if (promptsInflight) {
    if (!force) return promptsInflight;
    await promptsInflight;
  }
  promptsInflight = (async () => {
    try {
      const list = await listPrompts();
      promptsSlice = { data: list, loading: false, fetchedAt: Date.now() };
    } catch (err) {
      console.error('[shared-data-store] load prompts failed', err);
      promptsSlice = { ...promptsSlice, loading: false };
    } finally {
      emit();
    }
  })().finally(() => {
    promptsInflight = null;
  });
  return promptsInflight;
}

// ── 模块级强制刷新（供 store 外部写操作后失效缓存，如公共提示词收藏副本） ──

/** 强制刷新共享提示词缓存（写操作后调用，绕过 TTL，保证列表出现最新副本） */
export function refreshSharedPrompts(force = true): Promise<void> {
  return fetchPrompts(force);
}

// ── 乐观更新 ──

/** 乐观更新提示词收藏状态，避免刷新后列表重新排列 */
export function updatePromptFavoriteLocal(id: string, favorite: boolean): void {
  const idx = promptsSlice.data.findIndex((p) => p.id === id);
  if (idx >= 0) {
    promptsSlice = {
      ...promptsSlice,
      data: promptsSlice.data.map((p) => (p.id === id ? { ...p, favorite } : p)),
    };
    emit();
  }
}

// ── 对外 Hook ──

export interface SharedPromptsResult {
  prompts: Prompt[];
  loading: boolean;
  refreshPrompts: (force?: boolean) => Promise<void>;
}

/** 订阅共享提示词数据（多实例共用同一份缓存） */
export function useSharedPrompts(): SharedPromptsResult {
  const slice = useSyncExternalStore(subscribe, () => promptsSlice);
  const refreshPrompts = useCallback(
    (force?: boolean) => fetchPrompts(force ?? true),
    [],
  );
  return { prompts: slice.data, loading: slice.loading, refreshPrompts };
}
