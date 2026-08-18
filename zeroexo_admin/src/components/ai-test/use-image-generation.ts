/**
 * useImageGeneration - 图像生成状态与生成流程（提交即返回 + SSE/轮询追踪历史）
 *
 * 封装 ImageWorkbench 中的生成逻辑：
 *   1. 管理 results（生成结果）与 generating（提交中）状态
 *   2. handleGenerate：参数校验 → 构建 filteredParams → 调用 /ai/generate →
 *      清空当前窗口（保留参数和参考图）→ 刷新历史（任务挂到历史队列由 SSE/轮询追踪）
 *   3. handleCancel：调用 /ai/generations/:id/cancel
 *      接收 taskId 参数，取消历史中的 pending/running 任务
 *      - pending（排队中）：取消无成本
 *      - running（处理中）：已提交运营商，可能产生部分费用
 *   4. trackRunningId：登记从历史加载的 running/pending 任务 ID，由 SSE + 5s 轮询兜底驱动更新
 *   5. setActiveRunningTask：记录当前查看的 running 任务，驱动 ActionBar 取消按钮显隐
 *
 * 清屏机制：
 *   - 用户点击「开始生成」后立即提交任务并清空当前窗口（prompt + results）
 *   - 保留 paramValues 和 referenceImages，用户可复用参数快速生成下一张
 *   - 取消按钮移到历史卡片中（仅 pending 状态可取消，running 不可取消）
 *
 * 可靠性策略（SSE + 轮询双保险）：
 *   - SSE 为主：实时推送 ai_generation_completed 事件，零延迟
 *   - 轮询为辅：每 5s 检查一次 tracked running/pending 任务状态，防止 SSE 连接异常时漏事件
 *   - 两者互补：先到先处理，后到为 no-op（任务已终态时自动跳过）
 *   - 页面刷新场景：loadHistory 发现 running/pending 任务 → trackRunningId → 立即检查 + 5s 轮询
 *     即使 SSE 连接尚未建立或被代理缓冲，也能在 5s 内感知到任务完成
 *
 * 尺寸传值策略：
 *   - AUTO 模式（aspectRatio='auto'）：传 resolution + aspectRatio，删除 size
 *   - 非 AUTO 模式：传 size（WxH 字符串），删除 resolution + aspectRatio
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { apiGet, apiPost } from '@/services/api-client';
import {
  blobUrlToBase64,
  mapGenToRecord,
} from './image-workbench-utils';
import { useAiGenerationSse, type AiGenerationSseEvent } from './use-ai-generation-sse';
import type { ReferenceImage, ResultImage, GenerationRecord } from './types';
import type { PromptEditorHandle } from './PromptEditor';

/** 重试时传入的覆盖参数（来自历史记录） */
export interface GenerateOverride {
  prompt: string;
  providerId: string;
  model: string;
  params: Record<string, any>;
  references: ReferenceImage[];
}

export interface UseImageGenerationParams {
  /** 当前提示词 */
  prompt: string;
  /** 当前选中的渠道 id */
  selectedProviderId: string | null;
  /** 当前选中的模型 id */
  selectedModel: string | null;
  /** 当前参数值 */
  paramValues: Record<string, any>;
  /** 当前参考图列表 */
  referenceImages: ReferenceImage[];
  /** i18n 翻译函数 */
  t: (key: string, options?: any) => string;
  /** 刷新历史列表回调 */
  loadHistory: () => void | Promise<void>;
  /** PromptEditor 命令式 API（用于 override 时重建带 badge 的内容） */
  editorRef: React.RefObject<PromptEditorHandle | null>;
  /** 以下为 override 时同步面板状态用的 setters */
  setSelectedProviderId: (id: string | null) => void;
  setSelectedModel: (model: string | null) => void;
  setPrompt: (v: string) => void;
  setParamValues: (v: Record<string, any>) => void;
  setReferenceImages: (v: ReferenceImage[] | ((prev: ReferenceImage[]) => ReferenceImage[])) => void;
  /** 历史记录相关 setters（用于 SSE 事件回写） */
  setActiveHistoryId: (id: string | null) => void;
  setHistory: (v: GenerationRecord[] | ((prev: GenerationRecord[]) => GenerationRecord[])) => void;
}

export interface UseImageGenerationResult {
  /** 生成结果列表 */
  results: ResultImage[];
  /** 设置生成结果（供 loadFromHistory / handleReset 使用） */
  setResults: React.Dispatch<React.SetStateAction<ResultImage[]>>;
  /** 是否正在提交（用户触发的提交流程） */
  generating: boolean;
  /** 是否存在可取消的任务（当前查看的历史 running 任务） */
  canCancel: boolean;
  /** 触发生成（可传入 override 进行重试） */
  handleGenerate: (override?: GenerateOverride) => Promise<void>;
  /** 取消任务（接收 taskId 参数，可取消历史中的 pending 任务） */
  handleCancel: (taskId?: string) => Promise<void>;
  /** 登记一个从历史加载的 running/pending 任务 ID，由 SSE + 轮询驱动更新 */
  trackRunningId: (id: string) => void;
  /** 设置当前查看的 running 任务 ID（驱动 ActionBar 取消按钮显隐） */
  setActiveRunningTask: (id: string | null) => void;
}

/** 轮询兜底间隔（毫秒），SSE 异常时作为兜底检测任务完成 */
const POLL_FALLBACK_INTERVAL_MS = 5000;

/**
 * 图像生成状态与生成流程（提交即返回 + SSE/轮询追踪历史）
 */
export function useImageGeneration(
  params: UseImageGenerationParams,
): UseImageGenerationResult {
  const {
    prompt,
    selectedProviderId,
    selectedModel,
    paramValues,
    referenceImages,
    t,
    loadHistory,
    editorRef,
    setSelectedProviderId,
    setSelectedModel,
    setPrompt,
    setParamValues,
    setReferenceImages,
    setActiveHistoryId,
    setHistory,
  } = params;

  const [results, setResults] = useState<ResultImage[]>([]);
  const [generating, setGenerating] = useState(false);
  // 从历史加载的 running/pending 任务 ID 集合（页面刷新后由 SSE + 轮询继续追踪）
  const [trackedRunningIds, setTrackedRunningIds] = useState<Set<string>>(
    () => new Set(),
  );
  const trackedRunningIdsRef = useRef(trackedRunningIds);
  trackedRunningIdsRef.current = trackedRunningIds;

  // 当前用户查看的历史 running 任务 ID（驱动 ActionBar 取消按钮显隐）
  const [activeRunningTaskId, setActiveRunningTaskId] = useState<string | null>(
    null,
  );
  const activeRunningTaskIdRef = useRef(activeRunningTaskId);
  activeRunningTaskIdRef.current = activeRunningTaskId;

  // 轮询兜底定时器集合（key: taskId, value: interval handle）
  const pollingTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(
    new Map(),
  );
  // t 的最新引用，供 SSE/轮询回调使用（避免闭包过期）
  const tRef = useRef(t);
  tRef.current = t;

  // loadHistory 防抖定时器：1 秒内多次 SSE 事件触发的刷新只执行一次
  // 避免事件风暴（多端提交/完成）导致频繁请求历史接口
  const historyRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  /** 清除指定任务的轮询定时器 */
  const clearPollingTimer = useCallback((id: string) => {
    const timer = pollingTimersRef.current.get(id);
    if (timer) {
      clearInterval(timer);
      pollingTimersRef.current.delete(id);
    }
  }, []);

  /** 清除追踪状态（从 trackedRunningIds 移除 + 清轮询定时器 + 清 activeRunningTaskId） */
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

  /**
   * 检查任务状态，若已终态则更新 history 并清理追踪
   *
   * 用于历史 running/pending 任务的轮询兜底：拉取后端最新状态，
   * 若已进入终态（success/failed/cancelled）则更新 history 并清理追踪。
   *
   * @returns true 表示任务已终态（已处理），false 表示仍在运行
   */
  const checkAndApplyTaskStatus = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const gen = await apiGet<any>(`/ai/generations/${id}`);
        if (
          gen.status === 'success' ||
          gen.status === 'failed' ||
          gen.status === 'cancelled'
        ) {
          // 更新 history（历史 running/pending 任务场景）
          const updated = mapGenToRecord(gen, (k) => tRef.current(k));
          setHistory((prev) =>
            prev.map((h) => (h.id === updated.id ? updated : h)),
          );
          clearTracking(id);
          return true;
        }
        return false;
      } catch {
        return false; // 拉取失败，等下次轮询/SSE 再试
      }
    },
    [setHistory, clearTracking],
  );

  /** 启动轮询兜底：立即检查一次 + 每 5s 检查一次 */
  const startPollingFallback = useCallback(
    (id: string) => {
      if (pollingTimersRef.current.has(id)) return; // 已在轮询
      // 立即检查一次（防止任务已完成但 SSE 事件丢失的场景）
      void checkAndApplyTaskStatus(id);
      const timer = setInterval(() => {
        void checkAndApplyTaskStatus(id);
      }, POLL_FALLBACK_INTERVAL_MS);
      pollingTimersRef.current.set(id, timer);
    },
    [checkAndApplyTaskStatus],
  );

  /**
   * 防抖刷新历史列表：1 秒内多次调用只执行一次 loadHistory
   *
   * 用于 SSE 事件风暴场景：
   *   - 多端同时提交多个任务时，submitted 事件会连续到达
   *   - 多个未追踪的 completed 事件（其他端发起的任务）也会连续到达
   *   - 防抖合并避免短时间内重复请求 /ai/generations
   */
  const scheduleHistoryRefresh = useCallback(() => {
    if (historyRefreshTimerRef.current) return; // 已有等待中的刷新
    historyRefreshTimerRef.current = setTimeout(() => {
      historyRefreshTimerRef.current = null;
      void loadHistory();
    }, 1000);
  }, [loadHistory]);

  /**
   * SSE 事件统一处理：
   *   1. submitted 事件（其他端刚提交的"生成中"任务）→ 防抖刷新历史
   *   2. 匹配 trackedRunningIdsRef → 拉取完整记录并更新 history + 清理轮询
   *   3. 未追踪的 completed 事件（其他端发起并完成的任务）→ 防抖刷新历史
   */
  const handleSseEvent = useCallback(
    async (event: AiGenerationSseEvent) => {
      // submitted 事件：其他端刚提交的"生成中"任务，B/C 端刷新历史以显示
      if (event.status === 'submitted') {
        scheduleHistoryRefresh();
        return;
      }

      // 历史 running/pending 任务的完成（页面刷新后追踪）
      if (trackedRunningIdsRef.current.has(event.generationId)) {
        // SSE 先于轮询到达，清理轮询定时器
        clearPollingTimer(event.generationId);
        setTrackedRunningIds((prev) => {
          if (!prev.has(event.generationId)) return prev;
          const next = new Set(prev);
          next.delete(event.generationId);
          return next;
        });
        // 清除 activeRunningTaskId（若匹配）
        setActiveRunningTaskId((prev) =>
          prev === event.generationId ? null : prev,
        );
        try {
          // SSE meta 仅含 url，需拉取完整记录获取 width/height/costTokens 等
          const gen = await apiGet<any>(`/ai/generations/${event.generationId}`);
          const updated = mapGenToRecord(gen, (k) => tRef.current(k));
          setHistory((prev) =>
            prev.map((h) => (h.id === updated.id ? updated : h)),
          );
        } catch {
          // 拉取失败时静默，下次 loadHistory 会刷新
        }
        return;
      }

      // 未追踪的 completed 事件：其他端发起并完成的任务，刷新历史以同步最终状态
      scheduleHistoryRefresh();
    },
    [setHistory, clearPollingTimer, scheduleHistoryRefresh],
  );

  // SSE 连接：组件挂载期间保持连接，确保快速生成不丢失事件，
  // 同时实时追踪历史中 running/pending 任务（页面刷新后自动恢复追踪）
  useAiGenerationSse({
    onEvent: handleSseEvent,
    enabled: true,
  });

  // 周期性全量刷新兜底(30s)：SSE 可能因代理缓冲/网络波动静默断开，
  // 此定时器确保即使 SSE 事件丢失，历史列表也能在 30s 内自动更新。
  // 区别于 POLL_FALLBACK（仅追踪指定 running/pending 任务），
  // 此兜底刷新整个历史列表，覆盖"其他端提交"和"本端历史列表过期"场景。
  useEffect(() => {
    const timer = setInterval(() => {
      void loadHistory();
    }, 30_000);
    return () => clearInterval(timer);
  }, [loadHistory]);

  // 组件卸载时清理所有轮询定时器 + 防抖刷新定时器
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

  /** 登记一个从历史加载的 running/pending 任务 ID，由 SSE + 轮询驱动更新 */
  const trackRunningId = useCallback(
    (id: string) => {
      if (!id || id.startsWith('running-')) return; // 跳过临时 ID
      setTrackedRunningIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      // 启动轮询兜底（立即检查一次 + 每 5s 检查）
      startPollingFallback(id);
    },
    [startPollingFallback],
  );

  /** 设置当前查看的 running 任务 ID（驱动 ActionBar 取消按钮显隐） */
  const setActiveRunningTask = useCallback((id: string | null) => {
    setActiveRunningTaskId(id);
  }, []);

  /**
   * 触发生成（提交即返回）
   *
   * 流程：参数校验 → override 同步面板 → 构建 filteredParams → 参考图 base64 转换 →
   *      apiPost('/ai/generate') → trackRunningId → 清空窗口（非 override）→ loadHistory
   *
   * 清屏机制：仅用户主动生成（非 override 重试）时清空 prompt + results，
   * 保留 paramValues 和 referenceImages 供用户复用参数快速生成下一张。
   * override 场景（重试）：不清空窗口，保留配置让用户看到。
   */
  const handleGenerate = async (override?: GenerateOverride) => {
    const activePrompt = (override?.prompt ?? prompt).trim().replace(/\s+/g, ' ');
    const activeProviderId = override?.providerId ?? selectedProviderId;
    const activeModel = override?.model ?? selectedModel;
    const activeParamValues = override?.params ?? paramValues;
    const activeReferences = override?.references ?? referenceImages;

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

    // 重试时同步面板状态,让用户看到加载的配置
    if (override) {
      setSelectedProviderId(override.providerId);
      setSelectedModel(override.model);
      setPrompt(override.prompt);
      setParamValues(override.params);
      setReferenceImages(override.references);
      // 同步 contentEditable 的显示内容（含 @图N badge）
      editorRef.current?.syncDOM(override.prompt, override.references || []);
    }

    setGenerating(true);

    const filteredParams: Record<string, any> = {};
    for (const [k, v] of Object.entries(activeParamValues)) {
      if (v !== '' && v !== null && v !== undefined) {
        filteredParams[k] = v;
      }
    }

    // ── 尺寸传值策略：AUTO 模式传 resolution，非 AUTO 传 size ──
    const isAuto = filteredParams.aspectRatio === 'auto';
    if (isAuto) {
      // AUTO 模式：保留 resolution + aspectRatio，适配器据此自动计算尺寸
      delete filteredParams.size;
    } else {
      // 非 AUTO 模式：保留 size，删除 resolution + aspectRatio
      if (filteredParams.size && typeof filteredParams.size === 'object') {
        const sz = filteredParams.size as { width: number; height: number };
        filteredParams.size = `${sz.width}x${sz.height}`;
      }
      delete filteredParams.resolution;
      delete filteredParams.aspectRatio;
    }
    // cleanup 不再使用的旧字段和 meta 参数
    delete filteredParams.width;
    delete filteredParams.height;
    delete filteredParams.referenceImagesEnabled;

    // 所有已上传的参考图均作为参数传入，无论是否在提示词中 @ 提及
    if (activeReferences.length > 0) {
      const base64Refs = await Promise.all(
        activeReferences.map((r) => blobUrlToBase64(r.url)),
      );
      filteredParams.referenceImages = base64Refs;
    }

    try {
      const { generationId } = await apiPost<{ generationId: string }>('/ai/generate', {
        kind: 'image',
        prompt: activePrompt,
        model: activeModel,
        providerId: activeProviderId,
        isTest: true,
        params: filteredParams,
      });

      // 缓存完整窗口状态到 localStorage，刷新后可恢复到本次提交的状态
      // 注意：filteredParams.referenceImages 已转为 base64，不缓存 base64（容量限制）
      const paramValuesToCache: Record<string, any> = { ...filteredParams };
      delete paramValuesToCache.referenceImages;
      try {
        localStorage.setItem(
          'ai-image-last-workbench',
          JSON.stringify({
            prompt: activePrompt,
            paramValues: paramValuesToCache,
            // blob: URL 刷新后失效，标记为空字符串（恢复时过滤掉）
            referenceImages: activeReferences.map((r) => ({
              url: r.url.startsWith('blob:') ? '' : r.url,
              name: r.name,
            })),
            providerId: activeProviderId,
            model: activeModel,
          }),
        );
      } catch {
        // localStorage 写入失败（容量不足等）静默处理，不影响生成流程
      }

      // 登记到追踪集合，由 SSE + 轮询兜底驱动更新（替代旧的 await SSE 模式）
      trackRunningId(generationId);

      message.success(t('ai.generationSubmitted') || '已提交生成任务');

      // 刷新历史列表（任务挂到历史队列，由历史卡片展示进度与取消按钮）
      void loadHistory();

      // 清屏机制：仅用户主动生成（非 override 重试）时清空窗口
      // 保留 paramValues 和 referenceImages，用户可复用参数快速生成下一张
      if (!override) {
        setPrompt('');
        setResults([]);
        editorRef.current?.syncDOM('', []);
        // 取消选中历史记录，回到空白工作台
        setActiveHistoryId(null);
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err) || t('ai.generationFailed');
      message.error(`${t('ai.generationFailed')}：${errorMsg}`);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * 取消任务（接收 taskId 参数）
   *
   * 取消机制说明（HTTP 请求中断 + 阶段感知）：
   *   - 后端 cancelTask 根据 gen.status 判断任务阶段：
   *     - pending（排队中）：尚未提交运营商，取消无成本
   *     - running（处理中）：已提交运营商，调用 AbortController.abort() 中断 HTTP 请求
   *   - 中断后运营商可能已开始计费，取消仅能停止未完成的网络往返
   *   - 返回 stage 字段，前端据此显示成本透明提示
   *
   * 取消场景：
   *   - 历史卡片中的 pending 任务（onCancelHistory 回调）：用户主动取消排队中的任务
   *   - 当前查看的 running 任务（ActionBar 取消按钮，taskId 为空时回退到此）
   */
  const handleCancel = async (taskId?: string) => {
    const id = taskId || activeRunningTaskIdRef.current;
    if (!id) return;

    try {
      const res = await apiPost<{ id: string; status: string; stage: 'queued' | 'processing' }>(
        `/ai/generations/${id}/cancel`,
      );
      // 根据 stage 显示成本透明提示
      if (res.stage === 'queued') {
        message.info(t('ai.cancelQueuedHint'));
      } else if (res.stage === 'processing') {
        message.info(t('ai.cancelProcessingHint'));
      } else {
        message.info(t('ai.generationCancelled'));
      }
      // 立即更新 history 状态（不等 SSE/轮询，确保 UI 即时反馈）
      setHistory((prev) =>
        prev.map((h) =>
          h.id === id
            ? { ...h, status: 'cancelled' as const, errorMessage: '用户取消' }
            : h,
        ),
      );
      // 清理追踪状态
      clearTracking(id);
    } catch (err: any) {
      const errMsg = err?.message || '';
      message.error(`${t('ai.cancelFailed')}：${errMsg}`);
    }
  };

  const canCancel = activeRunningTaskId !== null;

  return {
    results,
    setResults,
    generating,
    canCancel,
    handleGenerate,
    handleCancel,
    trackRunningId,
    setActiveRunningTask,
  };
}
