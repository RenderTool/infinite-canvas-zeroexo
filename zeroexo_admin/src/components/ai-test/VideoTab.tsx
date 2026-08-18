/**
 * VideoTab - AI 视频生成工作台
 *
 * 与 ImageWorkbench 类似，但针对视频生成：
 *   1. 加载视频模型参数模板（?type=video）
 *   2. 参考面板根据生成模式（mode）动态切换
 *   3. 结果预览使用 HTML5 video 播放器
 *   4. 支持多种参考素材（图片、视频、音频）
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, message, Modal } from 'antd';
import { Film } from 'lucide-react';
import { apiGet, apiDelete, showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';
import type {
  ProviderItem,
  ModelOption,
  ReferenceImage,
  ReferenceVideo,
  ReferenceAudio,
  GenerationRecord,
} from './types';
import { getBrandIcon } from './image-workbench-utils';
import { mapVideoGenToRecord } from './video-workbench-utils';
import VideoResultPreview from './VideoResultPreview';
import VideoReferencePanel from './VideoReferencePanel';
import HistoryPanel from './HistoryPanel';
import HistoryDetailModal from './HistoryDetailModal';
import ChannelModelSelector from './ChannelModelSelector';
import ActionBar from './ActionBar';
import PromptEditor from './PromptEditor';
import type { PromptEditorHandle } from './PromptEditor';
import { useVideoParamSchema } from './use-video-param-schema';
import { useVideoGeneration } from './use-video-generation';

export default function VideoTab({
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
  const [referenceVideos, setReferenceVideos] = useState<ReferenceVideo[]>([]);
  const [referenceAudio, setReferenceAudio] = useState<ReferenceAudio[]>([]);
  // 首尾帧模式专用
  const [firstFrameImage, setFirstFrameImage] = useState<ReferenceImage | null>(null);
  const [lastFrameImage, setLastFrameImage] = useState<ReferenceImage | null>(null);
  const [historyFullScreen, setHistoryFullScreen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  // 视频参数 schema
  const {
    maxPromptLength,
    displayParameters,
    constraints,
    refBounds,
    paramValues,
    setParamValues,
    handleParamFormChange,
    workbenchRegistry,
  } = useVideoParamSchema(selectedModel, selectedProvider);

  const cleanedPromptLength = prompt.trim().replace(/\s+/g, ' ').length;
  const isPromptExceeded = maxPromptLength != null && cleanedPromptLength > maxPromptLength;

  // 历史记录状态
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [detailRecord, setDetailRecord] = useState<GenerationRecord | null>(null);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyTotal, setHistoryTotal] = useState<number | undefined>(undefined);
  const [historyPage, setHistoryPage] = useState(1);

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.trim().toLowerCase();
    return history.filter((h) => h.prompt.toLowerCase().includes(q));
  }, [history, historySearch]);

  const trackRunningIdRef = useRef<((id: string) => void) | null>(null);
  const promptEditorRef = useRef<PromptEditorHandle>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoadError(null);
    try {
      const res = await apiGet<{ items: any[]; nextCursor: string | null; total?: number }>(
        '/ai/generations?kind=video&limit=20',
      );
      const records = (res.items ?? []).map((gen: any) => mapVideoGenToRecord(gen, t));
      setHistory(records);
      setNextCursor(res.nextCursor);
      if (res.total != null) setHistoryTotal(res.total);

      const runningRecords = records.filter(
        (r) => r.status === 'running' || r.status === 'pending',
      );
      for (const rec of runningRecords) {
        trackRunningIdRef.current?.(rec.id);
      }
    } catch {
      setHistoryLoadError(t('ai.loadHistoryFailed'));
    }
  }, [t]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const loadMoreHistory = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const res = await apiGet<{ items: any[]; nextCursor: string | null; total?: number }>(
        `/ai/generations?kind=video&limit=20&cursor=${nextCursor}`,
      );
      const records = (res.items ?? []).map((gen: any) => mapVideoGenToRecord(gen, t));
      setHistory((prev) => [...prev, ...records]);
      setNextCursor(res.nextCursor);
      if (res.total != null) setHistoryTotal(res.total);
      setHistoryPage((prev) => prev + 1);
    } catch {
      message.error(t('ai.loadHistoryFailed'));
    }
  }, [nextCursor, t]);

  const handlePrevPage = useCallback(() => {
    if (historyPage <= 1) return;
    setHistoryPage(1);
    setNextCursor(null);
    void loadHistory();
  }, [historyPage, loadHistory]);

  const handleNextPage = useCallback(() => {
    void loadMoreHistory();
  }, [loadMoreHistory]);

  // 模型选项构建：从 provider.config.fetchedModels 提取 video 类型模型
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
        if (type !== 'video') continue;
        ids.forEach((id) => {
          if (seen.has(id)) return;
          seen.add(id);
          if (enabledSet && !enabledSet.has(id)) return;
          opts.push({ label: id, value: id, type, iconProvider: modelIcons?.[id.toLowerCase()] || provider?.provider || '' });
        });
      }
      setModelOptions(opts);
      if (opts.length > 0) {
        if (selectedModel && opts.some((o) => o.value === selectedModel)) {
          return;
        }
        const lastModel = localStorage.getItem('ai-video-last-model');
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

  // 缓存上一次操作的渠道和模型
  useEffect(() => {
    if (selectedProviderId) localStorage.setItem('ai-video-last-provider', selectedProviderId);
  }, [selectedProviderId]);
  useEffect(() => {
    if (selectedModel) localStorage.setItem('ai-video-last-model', selectedModel);
  }, [selectedModel]);

  // 初始化：恢复上次渠道或选择第一个视频渠道
  useEffect(() => {
    if (providers.length === 0) return;
    if (selectedProviderId) return;

    const lastProviderId = localStorage.getItem('ai-video-last-provider');
    if (lastProviderId && providers.some((p) => p.id === lastProviderId)) {
      setSelectedProviderId(lastProviderId);
      return;
    }

    const firstVideoProvider = providers.find((p) => {
      const cached = p.config?.fetchedModels as Record<string, string[]> | undefined;
      return cached?.video && cached.video.length > 0;
    });
    if (firstVideoProvider) {
      setSelectedProviderId(firstVideoProvider.id);
    }
  }, [providers, selectedProviderId]);

  // 参考图操作
  const handleAddImages = useCallback((newRefs: ReferenceImage[]) => {
    setReferenceImages((prev) => [...prev, ...newRefs]);
  }, []);

  const handleRemoveImage = useCallback((id: string) => {
    const removed = referenceImages.find((r) => r.id === id);
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    setReferenceImages((prev) => prev.filter((r) => r.id !== id));
  }, [referenceImages]);

  const handleReorderImages = useCallback((from: number, to: number) => {
    setReferenceImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // 参考视频操作
  const handleAddVideos = useCallback((newRefs: ReferenceVideo[]) => {
    setReferenceVideos((prev) => [...prev, ...newRefs]);
  }, []);

  const handleRemoveVideo = useCallback((id: string) => {
    const removed = referenceVideos.find((r) => r.id === id);
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    setReferenceVideos((prev) => prev.filter((r) => r.id !== id));
  }, [referenceVideos]);

  // 参考音频操作
  const handleAddAudio = useCallback((newRefs: ReferenceAudio[]) => {
    setReferenceAudio((prev) => [...prev, ...newRefs]);
  }, []);

  const handleRemoveAudio = useCallback((id: string) => {
    const removed = referenceAudio.find((r) => r.id === id);
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
    }
    setReferenceAudio((prev) => prev.filter((r) => r.id !== id));
  }, [referenceAudio]);

  // 当前视频生成模式（用于参考面板联动）
  const currentMode = paramValues.mode || 'image-to-video-first-last-frame';

  /** 合并后的参考图列表（首尾帧 + 多模态参考图） */
  const effectiveReferenceImages = useMemo(() => {
    if (currentMode === 'image-to-video-first-last-frame') {
      return [firstFrameImage, lastFrameImage].filter(Boolean) as ReferenceImage[];
    }
    return referenceImages;
  }, [currentMode, firstFrameImage, lastFrameImage, referenceImages]);

  // 视频生成状态与 handleGenerate
  const {
    results,
    setResults,
    generating,
    handleGenerate,
    handleCancel,
    trackRunningId,
    setActiveRunningTask,
  } = useVideoGeneration({
    prompt,
    selectedProviderId,
    selectedModel,
    paramValues,
    referenceImages: effectiveReferenceImages,
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
  });
  trackRunningIdRef.current = trackRunningId;

  const loadFromHistory = (record: GenerationRecord) => {
    const providerAvailable = providers.some((p) => p.id === record.providerId);
    if (!providerAvailable) {
      message.warning(
        `该记录关联的渠道「${record.providerName}」已不可用（已关闭或移除），部分设置可能无法恢复`,
      );
    }
    setSelectedProviderId(record.providerId);
    setSelectedModel(record.model);
    setPrompt(record.prompt);
    setParamValues(record.params || {});
    setResults(record.results.map((r) => ({
      id: r.id,
      url: r.url,
      width: (r as any).width,
      height: (r as any).height,
      durationMs: (r as any).durationMs,
      costTokens: (r as any).costTokens,
    })));
    setActiveHistoryId(record.id);
    setActiveRunningTask(record.status === 'running' ? record.id : null);
    setReferenceImages(record.references || []);
    setReferenceVideos([]);
    setReferenceAudio([]);
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
          if (activeHistoryId === id) setActiveHistoryId(null);
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
    const doRetry = () => {
      handleGenerate({
        prompt: record.prompt,
        providerId: record.providerId,
        model: record.model,
        params: record.params,
        references: record.references || [],
        referenceVideos: [],
        referenceAudio: [],
      });
    };

    const hasDiff =
      prompt !== record.prompt ||
      selectedProviderId !== record.providerId ||
      selectedModel !== record.model ||
      JSON.stringify(paramValues) !== JSON.stringify(record.params);

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

  const handleDownload = (_result: any, _index: number) => {
    // 视频下载暂不实现
  };

  const handleReset = () => {
    setPrompt('');
    setReferenceImages([]);
    setReferenceVideos([]);
    setReferenceAudio([]);
    setFirstFrameImage(null);
    setLastFrameImage(null);
    setResults([]);
    setActiveHistoryId(null);
    setActiveRunningTask(null);
  };

  const selectedProviderName = selectedProvider?.name || t('ai.selectChannel');
  const selectedModelName = selectedModel || t('ai.selectModel');

  const paramSummary = useMemo(() => {
    const parts: string[] = [];
    const mode = paramValues.mode || '';
    const duration = paramValues.duration || '';
    if (mode) {
      const labels = (displayParameters.find((p) => p.name === 'mode')?.labels as Record<string, string> | undefined) || {};
      parts.push(labels[mode] || mode);
    }
    if (duration) parts.push(`${duration}秒`);
    return parts.length > 0 ? parts.join('·') : '默认参数';
  }, [paramValues, displayParameters]);

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
      {/* ═══════ 主区域 ═══════ */}
      <Card
        size="small"
        style={{ borderRadius: 4, flex: '1 1 300px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        styles={{ body: { padding: 0, flex: 1, overflow: 'hidden' } }}
        title={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Film size={14} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>视频生成</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {selectedModel &&
                (() => {
                  const opt = modelOptions.find((o) => o.value === selectedModel);
                  const Icon = opt ? getBrandIcon(opt.iconProvider) : null;
                  return (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '0 8px',
                        background: '#e6f4ff',
                        borderRadius: 4,
                        fontSize: 11,
                        color: '#1677ff',
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(selectedModel).then(() => message.success('模型 ID 已复制'));
                      }}
                    >
                      {Icon && <Icon size={12} />}
                      {selectedModel}
                    </span>
                  );
                })()}
            </div>
          </div>
        }
      >
        <div style={{ padding: 8, height: '100%', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
          {/* 视频结果预览 */}
          <VideoResultPreview generating={generating} results={results} />

          {/* 参考素材面板 - 根据生成模式动态切换 */}
          <VideoReferencePanel
            mode={currentMode}
            bounds={refBounds}
            firstFrameImage={firstFrameImage}
            lastFrameImage={lastFrameImage}
            onSetFirstFrame={setFirstFrameImage}
            onSetLastFrame={setLastFrameImage}
            referenceImages={referenceImages}
            referenceVideos={referenceVideos}
            referenceAudio={referenceAudio}
            onAddImages={handleAddImages}
            onRemoveImage={handleRemoveImage}
            onReorderImages={handleReorderImages}
            onAddVideos={handleAddVideos}
            onRemoveVideo={handleRemoveVideo}
            onAddAudio={handleAddAudio}
            onRemoveAudio={handleRemoveAudio}
          />

          {/* 提示词输入 — 使用 PromptEditor 支持 @mention 引用素材 */}
          <PromptEditor
            ref={promptEditorRef}
            value={prompt}
            onChange={setPrompt}
            referenceImages={effectiveReferenceImages}
            disabled={generating}
            isReferenceEnabled={effectiveReferenceImages.length > 0}
            maxPromptLength={maxPromptLength}
            cleanedPromptLength={cleanedPromptLength}
            isPromptExceeded={isPromptExceeded}
            onCopy={() => {
              navigator.clipboard.writeText(prompt).then(() => message.success(t('common.copySuccess')));
            }}
            generating={generating}
            onGenerate={() => handleGenerate()}
            canGenerate={!!selectedProviderId && !!selectedModel}
          />

          {/* 操作按钮区域 */}
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
              notFoundContent="暂无视频模型"
            />

            <ActionBar
              generating={generating}
              onReset={handleReset}
              hideGenerate
              isPromptExceeded={isPromptExceeded}
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
        onAddToReferences={() => {}}
        onShowDetail={setDetailRecord}
        onRetryHistory={retryHistory}
        onDeleteHistory={deleteHistory}
        onCancelHistory={handleCancel}
        historySearch={historySearch}
        onSearchHistory={setHistorySearch}
      />
    </div>

    {/* ═══════ 详情弹窗 ═══════ */}
    <HistoryDetailModal
      open={!!detailRecord}
      record={detailRecord}
      onClose={() => setDetailRecord(null)}
      downloadResult={null}
      onCloseDownload={() => {}}
    />
    </>
  );
}