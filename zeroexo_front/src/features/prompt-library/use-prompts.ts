/**
 * usePrompts - 提示词库状态管理(Phase D3.1)
 *
 * 封装 prompt-store 的 API 为 React Hook。
 * 设计参考: useAssets hook(同一套模式)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listPrompts,
  addPrompt as storeAdd,
  updatePrompt as storeUpdate,
  removePrompts as storeRemove,
} from './prompt-store.js';
import type { CreatePromptInput, UpdatePromptInput, Prompt } from './prompt-store.js';
import {
  onPromptCreated,
  onPromptUpdated,
  onPromptDeleted,
} from '@/services/sync/sync-service.js';

export interface UsePromptsResult {
  prompts: Prompt[];
  loading: boolean;
  error: string | null;
  addPrompt: (input: CreatePromptInput) => Promise<Prompt | null>;
  updatePrompt: (id: string, patch: UpdatePromptInput) => Promise<void>;
  removePrompts: (ids: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePrompts(): UsePromptsResult {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const list = await listPrompts();
      setPrompts(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prompts');
    } finally {
      setLoading(false);
    }
  }, []);

  const addPrompt = useCallback(async (input: CreatePromptInput): Promise<Prompt | null> => {
    try {
      const prompt = await storeAdd(input);
      setPrompts((prev) => [prompt, ...prev]);
      // 触发云同步推送(异步,不阻塞 UI)
      onPromptCreated(prompt.id);
      return prompt;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add prompt');
      return null;
    }
  }, []);

  const updatePrompt = useCallback(async (id: string, patch: UpdatePromptInput): Promise<void> => {
    try {
      const updated = await storeUpdate(id, patch);
      if (updated) {
        setPrompts((prev) => {
          const filtered = prev.filter((p) => p.id !== id);
          return [updated, ...filtered];
        });
        // 触发云同步推送
        onPromptUpdated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update prompt');
    }
  }, []);

  const removePrompts = useCallback(async (ids: string[]): Promise<void> => {
    try {
      // 先收集 cloudId(本地删除后无法再查找)
      const toDelete = prompts.filter((p) => ids.includes(p.id));
      await storeRemove(ids);
      setPrompts((prev) => prev.filter((p) => !ids.includes(p.id)));
      // 触发云端删除(传入 cloudId 避免本地已删除导致查找失败)
      for (const p of toDelete) {
        onPromptDeleted(p.id, p.cloudId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove prompts');
    }
  }, [prompts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { prompts, loading, error, addPrompt, updatePrompt, removePrompts, refresh };
}
