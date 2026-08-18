/**
 * useVideoGeneration - 视频生成状态与生成流程
 *
 * 与 use-image-generation.ts 类似，但针对视频生成：
 *   1. 调用 /ai/generate 时 kind: 'video'
 *   2. 支持多种参考素材类型（图片、视频、音频）
 *   3. 复用 SSE 事件机制追踪任务状态
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { apiGet, apiPost } from '@/services/api-client';
import { blobUrlToBase64, mapVideoGenToRecord } from './video-workbench-utils';
import { useAiGenerationSse, type AiGenerationSseEvent } from './use-ai-generation-sse';
import type { ReferenceImage, ReferenceVideo, ReferenceAudio, ResultVideo, GenerationRecord } from './types';

/** 重试时传入的覆盖参数 */
export interface VideoGenerateOverride {
  prompt: string;
  providerId: string;
  model: string;
  params: Record<string, any>;
  references: ReferenceImage[];
  referenceVideos: ReferenceVideo[];
  referenceAudio: ReferenceAudio[];
}

export interface UseVideoGenerationParams {
  prompt: string;
  selectedProviderId: string | null;
  selectedModel: string | null;
  paramValues: Record<string, any>;
  referenceImages: ReferenceImage[];
  referenceVideos: ReferenceVideo[];
  referenceAudio: ReferenceAudio[];
  t: (key: string, options?: any) => string;
  loadHistory: () => void | Promise<void>;
  setSelectedProviderId: (id: string | null) => void;
  setSelectedModel: (model: string | null) => void;
  setPrompt: (v: string) => void;
  setParamValues: (v: Record<string, any>) => void;
  setReferenceImages: (v: ReferenceImage[] | ((prev: ReferenceImage[]) => ReferenceImage[])) => void;
  setActiveHistoryId: (id: string | null) => void;
  setHistory: (v: GenerationRecord[] | ((prev: GenerationRecord[]) => GenerationRecord[])) => void;
}

export interface UseVideoGenerationResult {
  results: ResultVideo[];
  setResults: React.Dispatch<React.SetStateAction<ResultVideo[]>>;
  generating: boolean;
  handleGenerate: (override?: VideoGenerateOverride) => Promise<void>;
  handleCancel: (taskId?: string) => Promise<void>;
  trackRunningId: (id: string) => void;
  setActiveRunningTask: (id: string | null) => void;
}

const POLL_FALLBACK_INTERVAL_MS = 5000;

export function useVideoGeneration(
  params: UseVideoGenerationParams,
): UseVideoGenerationResult {
  const {
    prompt,
    selectedProviderId,
    selectedModel,
    paramValues,
    referenceImages,
    referenceVideos,
    referenceAudio,
    t,
    loadHistory,
    setSelectedProviderId,
    setSelectedModel,
    setPrompt,
    setParamValues,
    setReferenceImages,
    setActiveHistoryId,
    setHistory,
  } = params;

  const [results, setResults] = useState<ResultVideo[]>([]);
  const [generating, setGenerating] = useState(false);
  const [trackedRunningIds, setTrackedRunningIds] = useState<Set<string>>(() => new Set());
  const trackedRunningIdsRef = useRef(trackedRunningIds);
  trackedRunningIdsRef.current = trackedRunningIds;

  const [activeRunningTaskId, setActiveRunningTaskId] = useState<string | null>(null);
  const pollingTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const tRef = useRef(t);
  tRef.current = t;
  const historyRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPollingTimer = useCallback((id: string) => {
    const timer = pollingTimersRef.current.get(id);
    if (timer) {
      clearInterval(timer);
      pollingTimersRef.current.delete(id);
    }
  }, []);

  const clearTracking = useCallback(
    (id: string) => {
      clearPollingTimer(id);
      setTrackedRunningIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setActiveRunningTaskId((prev) => (prev === id ? null : prev));
    },
    [clearPollingTimer],
  );

  const checkAndApplyTaskStatus = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const gen = await apiGet<any>(`/ai/generations/${id}`);
        if (gen.status === 'success' || gen.status === 'failed' || gen.status === 'cancelled') {
          const updated = mapVideoGenToRecord(gen, (k) => tRef.current(k));
          setHistory((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
          clearTracking(id);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [setHistory, clearTracking],
  );

  const startPollingFallback = useCallback(
    (id: string) => {
      if (pollingTimersRef.current.has(id)) return;
      void checkAndApplyTaskStatus(id);
      const timer = setInterval(() => {
        void checkAndApplyTaskStatus(id);
      }, POLL_FALLBACK_INTERVAL_MS);
      pollingTimersRef.current.set(id, timer);
    },
    [checkAndApplyTaskStatus],
  );

  const scheduleHistoryRefresh = useCallback(() => {
    if (historyRefreshTimerRef.current) return;
    historyRefreshTimerRef.current = setTimeout(() => {
      historyRefreshTimerRef.current = null;
      void loadHistory();
    }, 1000);
  }, [loadHistory]);

  const handleSseEvent = useCallback(
    async (event: AiGenerationSseEvent) => {
      if (event.status === 'submitted') {
        scheduleHistoryRefresh();
        return;
      }
      if (trackedRunningIdsRef.current.has(event.generationId)) {
        clearPollingTimer(event.generationId);
        setTrackedRunningIds((prev) => {
          if (!prev.has(event.generationId)) return prev;
          const next = new Set(prev);
          next.delete(event.generationId);
          return next;
        });
        setActiveRunningTaskId((prev) => (prev === event.generationId ? null : prev));
        try {
          const gen = await apiGet<any>(`/ai/generations/${event.generationId}`);
          const updated = mapVideoGenToRecord(gen, (k) => tRef.current(k));
          setHistory((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
        } catch {
          // 静默
        }
        return;
      }
      scheduleHistoryRefresh();
    },
    [setHistory, clearPollingTimer, scheduleHistoryRefresh],
  );

  useAiGenerationSse({ onEvent: handleSseEvent, enabled: true });

  useEffect(() => {
    const timer = setInterval(() => {
      void loadHistory();
    }, 30_000);
    return () => clearInterval(timer);
  }, [loadHistory]);

  useEffect(() => {
    return () => {
      pollingTimersRef.current.forEach((timer) => clearInterval(timer));
      pollingTimersRef.current.clear();
      if (historyRefreshTimerRef.current) {
        clearTimeout(historyRefreshTimerRef.current);
        historyRefreshTimerRef.current = null;
      }
    };
  }, []);

  const trackRunningId = useCallback(
    (id: string) => {
      if (!id || id.startsWith('running-')) return;
      setTrackedRunningIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      startPollingFallback(id);
    },
    [startPollingFallback],
  );

  const setActiveRunningTask = useCallback((id: string | null) => {
    setActiveRunningTaskId(id);
  }, []);

  const handleGenerate = async (override?: VideoGenerateOverride) => {
    const activePrompt = (override?.prompt ?? prompt).trim();
    const activeProviderId = override?.providerId ?? selectedProviderId;
    const activeModel = override?.model ?? selectedModel;
    const activeParamValues = override?.params ?? paramValues;
    const activeReferences = override?.references ?? referenceImages;
    const activeRefVideos = override?.referenceVideos ?? referenceVideos;
    const activeRefAudio = override?.referenceAudio ?? referenceAudio;

    if (!activePrompt.trim()) {
      message.warning(t('ai.enterPrompt'));
      return;
    }
    if (!activeProviderId) {
      message.warning(t('ai.selectChannel'));
      return;
    }
    if (!activeModel) {
      message.warning(t('ai.selectModel'));
      return;
    }

    if (override) {
      setSelectedProviderId(override.providerId);
      setSelectedModel(override.model);
      setPrompt(override.prompt);
      setParamValues(override.params);
      setReferenceImages(override.references);
    }

    setGenerating(true);

    const filteredParams: Record<string, any> = {};
    for (const [k, v] of Object.entries(activeParamValues)) {
      if (v !== '' && v !== null && v !== undefined) {
        filteredParams[k] = v;
      }
    }

    // 清理 meta 字段
    delete filteredParams.maxReferenceImages;
    delete filteredParams.maxReferenceVideos;
    delete filteredParams.maxReferenceAudios;
    delete filteredParams.referenceImagesEnabled;
    delete filteredParams.referenceVideosEnabled;
    delete filteredParams.referenceAudiosEnabled;

    // 参考图转 base64
    if (activeReferences.length > 0) {
      const base64Refs = await Promise.all(
        activeReferences.map((r) => blobUrlToBase64(r.url)),
      );
      filteredParams.referenceImages = base64Refs;
    }

    // 参考视频转 base64
    if (activeRefVideos.length > 0) {
      const base64Vids = await Promise.all(
        activeRefVideos.map((r) => blobUrlToBase64(r.url)),
      );
      filteredParams.referenceVideos = base64Vids;
    }

    // 参考音频转 base64
    if (activeRefAudio.length > 0) {
      const base64Auds = await Promise.all(
        activeRefAudio.map((r) => blobUrlToBase64(r.url)),
      );
      filteredParams.referenceAudio = base64Auds;
    }

    try {
      const { generationId } = await apiPost<{ generationId: string }>('/ai/generate', {
        kind: 'video',
        prompt: activePrompt,
        model: activeModel,
        providerId: activeProviderId,
        isTest: true,
        params: filteredParams,
      });

      trackRunningId(generationId);

      message.success(t('ai.generationSubmitted') || '已提交生成任务');
      void loadHistory();

      if (!override) {
        setPrompt('');
        setResults([]);
        setActiveHistoryId(null);
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err) || t('ai.generationFailed');
      message.error(`${t('ai.generationFailed')}：${errorMsg}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCancel = async (taskId?: string) => {
    const id = taskId || activeRunningTaskId;
    if (!id) return;

    try {
      const res = await apiPost<{ id: string; status: string; stage: 'queued' | 'processing' }>(
        `/ai/generations/${id}/cancel`,
      );
      if (res.stage === 'queued') {
        message.info(t('ai.cancelQueuedHint'));
      } else if (res.stage === 'processing') {
        message.info(t('ai.cancelProcessingHint'));
      } else {
        message.info(t('ai.generationCancelled'));
      }
      setHistory((prev) =>
        prev.map((h) =>
          h.id === id
            ? { ...h, status: 'cancelled' as const, errorMessage: '用户取消' }
            : h,
        ),
      );
      clearTracking(id);
    } catch (err: any) {
      const errMsg = err?.message || '';
      message.error(`${t('ai.cancelFailed')}：${errMsg}`);
    }
  };

  return {
    results,
    setResults,
    generating,
    handleGenerate,
    handleCancel,
    trackRunningId,
    setActiveRunningTask,
  };
}