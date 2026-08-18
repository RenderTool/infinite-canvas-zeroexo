/**
 * useAutoSave - 通用自动保存 Hook
 *
 * 对数据变更进行防抖后，调用后端 API 保存到指定 artifact 字段。
 * 使用 JSON 序列化比较，避免不必要的保存触发。
 * 返回保存状态：saving、lastSavedAt、error。
 *
 * 用法：
 *   useAutoSave(artifactId, scriptData, { field: 'script' })
 *   useAutoSave(artifactId, storyboardData, { field: 'storyboard', delay: 3000 })
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { updateArtifact, type UpdateArtifactRequest } from '@/services/artifact-service.js';
import i18n from '@/i18n/config';

export interface AutoSaveState {
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
}

/** artifact 可自动保存的字段 */
export type AutoSaveField = 'script' | 'storyboard';

export interface UseAutoSaveOptions {
  /** artifact 字段名（如 'script' / 'storyboard'） */
  field: AutoSaveField;
  /** 防抖延迟（毫秒，默认 2000） */
  delay?: number;
}

/**
 * @param artifactId 项目 ID
 * @param data       要保存的数据（JSON stringifiable）
 * @param options    field: artifact 字段名；delay: 防抖延迟
 */
export function useAutoSave(
  artifactId: string | undefined,
  data: unknown,
  options: UseAutoSaveOptions,
): AutoSaveState {
  const { field, delay = 2000 } = options;
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const lastSerializedRef = useRef<string>('');

  const doSave = useCallback(
    async (saveData: unknown) => {
      if (!artifactId) return;
      setError(null);
      setSaving(true);
      try {
        const dto = { [field]: saveData } as Pick<UpdateArtifactRequest, AutoSaveField>;
        await updateArtifact(artifactId, dto);
        if (mountedRef.current) {
          setLastSavedAt(new Date().toISOString());
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : i18n.t('autoSave.saveFailed'));
        }
      } finally {
        if (mountedRef.current) {
          setSaving(false);
        }
      }
    },
    [artifactId, field],
  );

  // 使用 JSON 序列化比较，避免因对象引用变化导致的重复保存
  useEffect(() => {
    mountedRef.current = true;

    const serialized = JSON.stringify(data);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      void doSave(data);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [data, delay, doSave]);

  // 清理
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { saving, lastSavedAt, error };
}
