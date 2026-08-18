/**
 * useCreationSaveState - 统一自动保存状态管理
 *
 * 聚合各阶段的保存状态，提供统一的 saving/lastSavedAt/error 给 CreationSyncBadge。
 * 各阶段通过 registerStage 注册自己的保存状态回调。
 */

import { useCallback, useRef, useState } from 'react';

export interface StageSaveState {
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
}

/** 默认保存状态 */
const DEFAULT_SAVE_STATE: StageSaveState = {
  saving: false,
  lastSavedAt: null,
  error: null,
};

/**
 * 统一保存状态 Hook
 * 返回各阶段的合并状态以及注册/更新方法
 */
export function useCreationSaveState() {
  const [overall, setOverall] = useState<StageSaveState>(DEFAULT_SAVE_STATE);
  const stageStates = useRef<Map<string, StageSaveState>>(new Map());

  const recalc = useCallback(() => {
    const states = Array.from(stageStates.current.values());
    if (states.length === 0) {
      setOverall(DEFAULT_SAVE_STATE);
      return;
    }
    const merged: StageSaveState = {
      saving: states.some((s) => s.saving),
      lastSavedAt: states.reduce<string | null>((latest, s) => {
        if (!latest) return s.lastSavedAt;
        if (!s.lastSavedAt) return latest;
        return latest > s.lastSavedAt ? latest : s.lastSavedAt;
      }, null),
      error: states.find((s) => s.error)?.error ?? null,
    };
    setOverall(merged);
  }, []);

  const updateStage = useCallback((stageId: string, state: StageSaveState) => {
    stageStates.current.set(stageId, state);
    recalc();
  }, [recalc]);

  const unregisterStage = useCallback((stageId: string) => {
    stageStates.current.delete(stageId);
    recalc();
  }, [recalc]);

  return {
    /** 合并后的全局保存状态 */
    saveState: overall,
    /** 注册/更新某个阶段的保存状态 */
    updateStage,
    /** 移除某个阶段的保存状态 */
    unregisterStage,
  };
}
