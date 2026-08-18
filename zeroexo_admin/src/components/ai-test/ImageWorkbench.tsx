/**
 * ImageWorkbench - AI 图像生成工作台
 *
 * 参考 infinite-canvas 设计，保留项目 antd 风格。
 * 布局:
 *   主区域: 顶部生成结果 + 中间提示词/参考图/操作按钮
 *   右侧: 生成历史记录
 *
 * 参数设置通过弹出卡片收纳，点击按钮展开。
 *
 * 子组件拆分：
 *   - ResultPreview: 生成结果预览
 *   - ReferencePanel: 参考图面板
 *   - HistoryPanel: 历史记录列表 + 全屏视图
 *   - HistoryDetailModal: 详情弹窗 + 下载弹窗
 *   - PromptEditor: contentEditable 提示词编辑器（含 @ 提及 / badge）
 *   - ChannelModelSelector: 渠道/模型/参数三段 Popover
 *   - ActionBar: 生成/取消/重置按钮
 *   - WorkbenchCardHeader: Card 标题栏
 *   - useParamSchema: 参数 schema 解析与参数值管理
 *   - useImageGeneration: 生成状态与 handleGenerate
 *   - types.ts / image-workbench-utils.ts: 共享类型与工具函数
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, message, Modal } from 'antd';
import { apiGet, apiDelete, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import type {
  ProviderItem,
  ModelOption,
  ReferenceImage,
  ResultImage,
  GenerationRecord,
} from './types';
import {
  mapGenToRecord,
} from './image-workbench-utils';
import ResultPreview from './ResultPreview';
import ReferencePanel from './ReferencePanel';
import HistoryPanel from './HistoryPanel';
import HistoryDetailModal from './HistoryDetailModal';
import PromptEditor from './PromptEditor';
import type { PromptEditorHandle } from './PromptEditor';
import ChannelModelSelector from './ChannelModelSelector';
import ActionBar from './ActionBar';
import WorkbenchCardHeader from './WorkbenchCardHeader';
import { useParamSchema } from './use-param-schema';
import { useImageGeneration } from './use-image-generation';

export default function ImageWorkbench({
  providers,
  providersLoading,
  onRefreshProviders,
}: {
  providers: ProviderItem[];
  providersLoading: boolean;
  onRefreshProviders?: () => void;
}) {
  const { t } = useTranslation();
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  const [prompt, setPrompt] = useState('');
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  // PromptEditor 命令式 API 引用（用于 @ 插入 badge、历史恢复、复制等）
  const editorRef = useRef<PromptEditorHandle>(null);
  const [historyFullScreen, setHistoryFullScreen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  // 参数 schema 解析与参数值管理（含模板加载、默认值初始化、分辨率↔宽高比联动）
  const {
    constraints,
    maxPromptLength,
    displayParameters,
    maxRefCount,
    isReferenceEnabled,
    paramValues,
    setParamValues,
    handleParamFormChange,
    workbenchRegistry,
  } = useParamSchema(selectedModel, selectedProvider);

  const cleanedPromptLength = prompt.trim().replace(/\s+/g, ' ').length;
  const isPromptExceeded = maxPromptLength != null && cleanedPromptLength > maxPromptLength;

  // 历史记录状态
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [detailRecord, setDetailRecord] = useState<GenerationRecord | null>(null);
  const [downloadModalResult, setDownloadModalResult] = useState<ResultImage | null>(null);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyTotal, setHistoryTotal] = useState<number | undefined>(undefined);
  const [historyPage, setHistoryPage] = useState(1);

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.trim().toLowerCase();
    return history.filter((h) => h.prompt.toLowerCase().includes(q));
  }, [history, historySearch]);

  // trackRunningIdRef 桥接 loadHistory（定义在前）与 useImageGeneration 返回的 trackRunningId
  // loadHistory 在 hook 调用前定义，通过 ref 在 effect 执行时拿到最新 trackRunningId
  const trackRunningIdRef = useRef<((id: string) => void) | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoadError(null);
    try {
      const res = await apiGet<{ items: any[]; nextCursor: string | null; total?: number }>(
        '/ai/generations?kind=image&limit=20',
      );
      const records = (res.items ?? []).map((gen: any) => mapGenToRecord(gen, t));
      setHistory(records);
      setNextCursor(res.nextCursor);
      if (res.total != null) setHistoryTotal(res.total);

      // 对历史中仍在进行中的任务（pending 排队中 / running 处理中），
      // 登记 ID 由 SSE 事件 + 5s 轮询兜底驱动更新
      const runningRecords = records.filter(
        (r) => r.status === 'running' || r.status === 'pending',
      );
      for (const rec of runningRecords) {
        trackRunningIdRef.current?.(rec.id);
      }
    } catch {
      setHistoryLoadError(t('ai.loadHistoryFailed'));
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const loadMoreHistory = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const res = await apiGet<{ items: any[]; nextCursor: string | null; total?: number }>(
        `/ai/generations?kind=image&limit=20&cursor=${nextCursor}`,
      );
      const records = (res.items ?? []).map((gen: any) => mapGenToRecord(gen, t));
      setHistory((prev) => [...prev, ...records]);
      setNextCursor(res.nextCursor);
      if (res.total != null) setHistoryTotal(res.total);
      setHistoryPage((prev) => prev + 1);
    } catch {
      message.error(t('ai.loadHistoryFailed'));
    }
  }, [nextCursor]);

  const handlePrevPage = useCallback(() => {
    if (historyPage <= 1) return;
    setHistoryPage(1);
    setNextCursor(null);
    void loadHistory();
  }, [historyPage, loadHistory]);

  const handleNextPage = useCallback(() => {
    void loadMoreHistory();
  }, [loadMoreHistory]);

  // 模型选项构建：从 provider.config.fetchedModels 提取 image 类型模型
  useEffect(() => {
    if (!selectedProviderId) {
      setModelOptions([]);
      setSelectedModel(null);
      return;
    }
    const provider = providers.find((p) => p.id === selectedProviderId);
    const cachedModels = provider?.config?.fetchedModels as
      | Record<string, string[]>
      | undefined;

    if (cachedModels) {
      const enabledList = provider?.config?.enabledModels as string[] | undefined;
      const enabledSet = enabledList ? new Set(enabledList) : null;

      const opts: ModelOption[] = [];
      const seen = new Set<string>();
      const modelIcons = provider?.config?.modelIcons as Record<string, string> | undefined;
      for (const [type, ids] of Object.entries(cachedModels)) {
        if (type !== 'image') continue;
        ids.forEach((id) => {
          if (seen.has(id)) return;
          seen.add(id);
          if (enabledSet && !enabledSet.has(id)) return;
          opts.push({ label: id, value: id, type, iconProvider: modelIcons?.[id.toLowerCase()] || provider?.provider || '' });
        });
      }
      setModelOptions(opts);
      if (opts.length > 0) {
        // 已有有效选择（工作台恢复或用户操作）时保持，不被 last-model 覆盖
        if (selectedModel && opts.some((o) => o.value === selectedModel)) {
          return;
        }
        // 优先恢复上一次使用的模型
        const lastModel = localStorage.getItem('ai-image-last-model');
        if (lastModel && opts.some((o) => o.value === lastModel)) {
          setSelectedModel(lastModel);
        } else {
          setSelectedModel(opts[0].value);
        }
      } else {
        setSelectedModel(null);
      }
    } else {
      setModelOptions([]);
      if (!selectedModel) setSelectedModel(null);
    }
  }, [selectedProviderId, providers]);

  /** 缓存上一次操作的渠道和模型 */
  useEffect(() => {
    if (selectedProviderId) localStorage.setItem('ai-image-last-provider', selectedProviderId);
  }, [selectedProviderId]);
  useEffect(() => {
    if (selectedModel) localStorage.setItem('ai-image-last-model', selectedModel);
  }, [selectedModel]);

  // 初始化：优先恢复完整工作台状态，否则恢复上次渠道，最后回退到第一个图像渠道
  useEffect(() => {
    if (providers.length === 0) return;
    if (selectedProviderId) return; // 已有选择（chat cache 或用户操作）

    // 1. 优先恢复完整工作台状态（来自上次成功提交的快照）
    const savedWorkbench = localStorage.getItem('ai-image-last-workbench');
    if (savedWorkbench) {
      try {
        const state = JSON.parse(savedWorkbench);
        if (state.providerId && providers.some((p) => p.id === state.providerId)) {
          setSelectedProviderId(state.providerId);
          if (state.model) {
            setSelectedModel(state.model);
            // 同步 ai-image-last-model，避免被 model options effect 的 last-model 逻辑覆盖
            localStorage.setItem('ai-image-last-model', state.model);
          }
          if (state.prompt) {
            setPrompt(state.prompt);
            editorRef.current?.syncDOM(state.prompt, state.referenceImages || []);
          }
          if (state.paramValues) setParamValues(state.paramValues);
          // 参考图恢复（blob: URL 刷新后失效，过滤掉空 URL）
          if (state.referenceImages && isReferenceEnabled) {
            const validRefs = (state.referenceImages as ReferenceImage[]).filter(
              (r) => r.url,
            );
            if (validRefs.length > 0) setReferenceImages(validRefs);
          }
          return;
        }
      } catch {
        // JSON 解析失败静默处理，回退到 last-provider 恢复
      }
    }

    // 2. 回退：恢复上一次操作的渠道（仅渠道/模型，无完整窗口状态）
    const lastProviderId = localStorage.getItem('ai-image-last-provider');
    if (lastProviderId && providers.some((p) => p.id === lastProviderId)) {
      setSelectedProviderId(lastProviderId);
      // 模型选择依赖 provider 变更后的 useEffects, 先设 provider
      // 等 provider 变更后由 model options effect 自动恢复模型
      return;
    }

    // 3. 最后回退：选第一个有图像模型的渠道
    const firstImageProvider = providers.find((p) => {
      const cached = p.config?.fetchedModels as Record<string, string[]> | undefined;
      return cached?.image && cached.image.length > 0;
    });
    if (firstImageProvider) {
      setSelectedProviderId(firstImageProvider.id);
    }
  }, [providers, selectedProviderId, isReferenceEnabled]);

  /** 拖拽排序：将 from 位置的参考图移动到 to 位置 */
  const handleReorder = useCallback((from: number, to: number) => {
    setReferenceImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  /** 新增参考图（由 ReferencePanel 转换好后回调） */
  const handleAddReferences = useCallback((newRefs: ReferenceImage[]) => {
    setReferenceImages((prev) => [...prev, ...newRefs]);
  }, []);

  /** 删除参考图：回收 blob URL + 将输入框中对应 badge 降级为纯文本 + 更新 state */
  const removeReference = useCallback((id: string) => {
    const removed = referenceImages.find((r) => r.id === id);
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    // 将输入框中对应的 badge span 降级为纯文本 @图N（DOM 修改与 prompt 同步由 PromptEditor 内部处理）
    if (removed) {
      editorRef.current?.downgradeReferenceToText(removed);
    }
    setReferenceImages((prev) => prev.filter((r) => r.id !== id));
  }, [referenceImages]);

  /** ReferencePanel 点击 @ 时，调用 PromptEditor 插入 badge */
  const handleInsertToPrompt = useCallback((id: string) => {
    editorRef.current?.insertReference(id);
  }, []);

  // 生成状态与 handleGenerate（封装在 hook 中，SSE 驱动）
  const {
    results,
    setResults,
    generating,
    handleGenerate,
    handleCancel,
    trackRunningId,
    setActiveRunningTask,
  } = useImageGeneration({
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
  });
  // 同步 ref，供 loadHistory 在 effect 中调用
  trackRunningIdRef.current = trackRunningId;

  const loadFromHistory = (record: GenerationRecord) => {
    // 检查历史记录中的渠道是否仍然可用（未被关闭/移除）
    const providerAvailable = providers.some(
      (p) => p.id === record.providerId,
    );
    if (!providerAvailable) {
      message.warning(
        `该记录关联的渠道「${record.providerName}」已不可用（已关闭或移除），部分设置可能无法恢复`,
      );
    }
    setSelectedProviderId(record.providerId);
    setSelectedModel(record.model);
    setPrompt(record.prompt);
    // 同步 contentEditable 的显示内容（含 @图N badge）
    editorRef.current?.syncDOM(record.prompt, record.references || []);
    setParamValues(record.params || {});
    setResults(record.results || []);
    setActiveHistoryId(record.id);
    // 若加载的是 running 任务，标记为当前活动任务（供 handleCancel 不带参数时回退）
    setActiveRunningTask(record.status === 'running' ? record.id : null);
    // 还原参考图（仅在 referenceImagesEnabled 开启时）
    if (isReferenceEnabled) {
      setReferenceImages(record.references || []);
    } else {
      setReferenceImages([]);
    }
    message.success(t('ai.historyLoaded'));
  };

  const clearHistory = async () => {
    if (history.length === 0) return;
    Modal.confirm({
      title: t('ai.confirmClear'),
      centered: true,
      content: t('ai.clearHistoryConfirm', { count: history.length }),
      okText: t('ai.confirmClear'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setClearing(true);
        try {
          await Promise.all(history.map((h) => apiDelete(`/ai/generations/${h.id}`)));
          setHistory([]);
          setActiveHistoryId(null);
          message.success(t('ai.historyCleared'));
        } catch (err) {
          showApiError(err, t('ai.clearFailed'));
          void loadHistory();
        } finally {
          setClearing(false);
        }
      },
    });
  };

  const deleteHistory = (id: string) => {
    Modal.confirm({
      title: t('ai.confirmDelete'),
      centered: true,
      content: t('ai.deleteRecordConfirm'),
      okText: t('ai.confirmDelete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await apiDelete(`/ai/generations/${id}`);
          setHistory((prev) => prev.filter((h) => h.id !== id));
          if (activeHistoryId === id) {
            setActiveHistoryId(null);
          }
          message.success(t('ai.recordDeleted'));
        } catch (err) {
          showApiError(err, t('ai.deleteFailed'));
        }
      },
    });
  };

  const retryHistory = (record: GenerationRecord) => {
    if (generating) {
      message.warning(t('ai.generatingWait'));
      return;
    }

    // 检查当前状态与历史记录是否有差异
    const hasDiff =
      prompt !== record.prompt ||
      selectedProviderId !== record.providerId ||
      selectedModel !== record.model ||
      JSON.stringify(paramValues) !== JSON.stringify(record.params) ||
      JSON.stringify(referenceImages) !== JSON.stringify(record.references);

    const doRetry = () => {
      handleGenerate({
        prompt: record.prompt,
        providerId: record.providerId,
        model: record.model,
        params: record.params,
        references: record.references,
      });
    };

    if (hasDiff) {
      Modal.confirm({
        title: t('ai.retryOverride'),
        centered: true,
        content: t('ai.retryOverrideConfirm'),
        okText: t('ai.confirmRetry'),
        cancelText: t('common.cancel'),
        onOk: doRetry,
      });
    } else {
      doRetry();
    }
  };

  const handleDownload = (result: ResultImage, _index: number) => {
    setDownloadModalResult(result);
  };

  const handleCopyPrompt = () => {
    // 优先从 contentEditable 提取纯文本（badge span 转换为 @name），编辑器未挂载时回退到 prompt state
    const text = editorRef.current?.getPlainText();
    const finalText = text ?? prompt;
    navigator.clipboard.writeText(finalText).then(() => {
      message.success(t('ai.promptCopied'));
    });
  };

  const handleAddToReferences = (result: ResultImage, index: number) => {
    if (referenceImages.length >= maxRefCount) {
      message.warning(t('ai.maxRefImages', { count: maxRefCount }));
      return;
    }
    setReferenceImages((prev) => [
      ...prev,
      {
        id: `ref-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        url: result.url,
        name: `图${prev.length + 1}`,
      },
    ]);
    message.success(t('ai.addedToReferences'));
  };

  const handleReset = () => {
    setPrompt('');
    setReferenceImages([]);
    setResults([]);
    setActiveHistoryId(null);
    setActiveRunningTask(null);
    // 同步清空 contentEditable DOM，避免重置后输入框残留旧文本/badge
    editorRef.current?.syncDOM('', []);
    // 清除工作台窗口缓存，避免刷新后恢复到已重置的状态
    localStorage.removeItem('ai-image-last-workbench');
  };

  const selectedProviderName = selectedProvider?.name || t('ai.selectChannel');
  const selectedModelName = selectedModel || t('ai.selectModel');

  const paramSummary = useMemo(() => {
    const parts: string[] = [];
    const res = paramValues.resolution || '';
    const aspect = paramValues.aspectRatio || '';
    const n = paramValues.n ?? 1;
    if (aspect === 'auto') {
      parts.push('auto');
      if (res) parts.push(res);
    } else {
      if (aspect) parts.push(aspect);
      if (res) parts.push(res);
    }
    if (n > 1) parts.push(`${n}张`);
    return parts.length > 0 ? parts.join('·') : '默认参数';
  }, [paramValues]);

  return (
    <>
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        height: 'calc(100vh - 155px)',
        minHeight: 500,
        width: '100%',
      }}
    >
      {/* ═══════ 主区域：生成结果 + 操作区 ═══════ */}
      <Card
        size="small"
        style={{ borderRadius: 4, flex: '1 1 300px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        styles={{ body: { padding: 0, flex: 1, overflow: 'hidden' } }}
        title={
          <WorkbenchCardHeader
            selectedModel={selectedModel}
            modelOptions={modelOptions}
            results={results}
            onAddToReferences={handleAddToReferences}
            onDownload={handleDownload}
          />
        }
      >
        <div style={{ padding: 8, height: '100%', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          {/* 生成结果区域 */}
          <ResultPreview generating={generating} results={results} onDownload={handleDownload} />

          {/* 参考图容器 — 仅在 referenceImagesEnabled 开启时显示 */}
          {isReferenceEnabled && (
            <ReferencePanel
              referenceImages={referenceImages}
              maxRefCount={maxRefCount}
              onAdd={handleAddReferences}
              onRemove={removeReference}
              onReorder={handleReorder}
              onInsertToPrompt={handleInsertToPrompt}
            />
          )}

          {/* 提示词编辑器 — contentEditable + @ 提及 + badge */}
          <PromptEditor
            ref={editorRef}
            value={prompt}
            onChange={setPrompt}
            referenceImages={referenceImages}
            disabled={generating}
            isReferenceEnabled={isReferenceEnabled}
            maxPromptLength={maxPromptLength}
            cleanedPromptLength={cleanedPromptLength}
            isPromptExceeded={isPromptExceeded}
            onCopy={handleCopyPrompt}
            generating={generating}
            onGenerate={() => handleGenerate()}
            canGenerate={!!selectedProviderId && !!selectedModel}
          />

          {/* 操作按钮区域 - 左(渠道/模型/参数) 右(生成/重置) */}
          <div style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <ChannelModelSelector
              providers={providers}
              providersLoading={providersLoading}
              onRefreshProviders={onRefreshProviders}
              selectedProviderId={selectedProviderId}
              selectedProvider={selectedProvider}
              onSelectProvider={setSelectedProviderId}
              modelOptions={modelOptions}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              selectedProviderName={selectedProviderName}
              selectedModelName={selectedModelName}
              displayParameters={displayParameters}
              paramValues={paramValues}
              onParamChange={handleParamFormChange}
              constraints={constraints}
              workbenchRegistry={workbenchRegistry}
              paramSummary={paramSummary}
            />

            <ActionBar
              generating={generating}
              onReset={handleReset}
              hideGenerate
            />
          </div>
        </div>
      </Card>

      {/* ═══════ 右侧：历史记录 ═══════ */}
      <HistoryPanel
        history={filteredHistory}
        activeHistoryId={activeHistoryId}
        clearing={clearing}
        generating={generating}
        historyLoadError={historyLoadError}
        nextCursor={nextCursor}
        totalCount={historyTotal}
        currentPage={historyPage}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        fullScreen={historyFullScreen}
        onSelectRecord={loadFromHistory}
        onClearHistory={clearHistory}
        onRetryLoad={loadHistory}
        onEnterFullScreen={() => setHistoryFullScreen(true)}
        onExitFullScreen={() => setHistoryFullScreen(false)}
        onDownload={handleDownload}
        onAddToReferences={handleAddToReferences}
        onShowDetail={setDetailRecord}
        onRetryHistory={retryHistory}
        onDeleteHistory={deleteHistory}
        onCancelHistory={handleCancel}
        historySearch={historySearch}
        onSearchHistory={setHistorySearch}
      />
    </div>

    {/* ═══════ 详情弹窗 + 下载弹窗 ═══════ */}
    <HistoryDetailModal
      open={!!detailRecord}
      record={detailRecord}
      onClose={() => setDetailRecord(null)}
      downloadResult={downloadModalResult}
      onCloseDownload={() => setDownloadModalResult(null)}
    />
    </>
  );
}
