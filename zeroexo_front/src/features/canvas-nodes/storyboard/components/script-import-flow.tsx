/**
 * ScriptImportFlow - 剧本导入流程
 *
 * 6 步骤流程：
 * 1. 选择素材（素材库 + 上传）
 * 2. 确认选择（拖拽排序 + token 统计）
 * 3. 生成偏好（短剧/长剧/每集时长）
 * 4. 剧集分配（合并/一一对应/AI 分割）
 * 5. AI 生成 + 进度
 * 6. 预览确认
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, X, Maximize2 } from 'lucide-react';
import { AssetDetailViewer } from '@/shared/components/asset-detail-viewer.js';
import { Modal, App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { apiGet } from '@/services/api-client.js';
import { createAiThinkService } from '@/services/ai-think-service.js';
import type { ThinkingStep } from '@/services/ai-think-service.js';
import i18n from '@/i18n/config';
import { translateApiError } from '@/shared/utils/api-error.js';
import type { ScriptEditorState } from '../script-types.js';
import { StepSelect } from './script-import/StepSelect.js';
import { StepConfirm } from './script-import/StepConfirm.js';
import { StepPreference } from './script-import/StepPreference.js';
import { StepAssign } from './script-import/StepAssign.js';
import type { FlowStep, TextAssetItem, GenerationPreference, AssignMode, ParsedEpisode } from './script-import/types.js';

const FLOW_STEPS: { key: FlowStep; labelKey: string; step: number }[] = [
  { key: 'select', labelKey: 'scriptImport.flowStepSelect', step: 1 },
  { key: 'confirm', labelKey: 'scriptImport.flowStepConfirm', step: 2 },
  { key: 'preference', labelKey: 'scriptImport.flowStepPreference', step: 3 },
  { key: 'assign', labelKey: 'scriptImport.flowStepAssign', step: 4 },
  { key: 'generating', labelKey: 'scriptImport.flowStepGenerating', step: 5 },
  { key: 'preview', labelKey: 'scriptImport.flowStepPreview', step: 6 },
];

export interface ScriptImportFlowProps {
  open: boolean;
  onClose: () => void;
  onComplete: (scriptState: ScriptEditorState | null) => void;
}

export function ScriptImportFlow({ open, onClose, onComplete }: ScriptImportFlowProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;

  const [step, setStep] = useState<FlowStep>('select');
  const [assets, setAssets] = useState<TextAssetItem[]>([]);
  const [preference, setPreference] = useState<GenerationPreference | null>(null);
  const [assignMode, setAssignMode] = useState<AssignMode>('one-to-one');
  const [parsedEpisodes, setParsedEpisodes] = useState<ParsedEpisode[]>([]);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [chunkProgress, setChunkProgress] = useState<{ done: number; total: number } | null>(null);

  const currentStepInfo = FLOW_STEPS.find((s) => s.key === step)!;

  const handleClose = useCallback(() => {
    setStep('select');
    setAssets([]);
    setPreference(null);
    setAssignMode('one-to-one');
    setParsedEpisodes([]);
    setThinkingSteps([]);
    setChunkProgress(null);
    onClose();
  }, [onClose]);

  const handleSelectNext = useCallback((selected: TextAssetItem[]) => {
    setAssets(selected);
    setStep('confirm');
  }, []);

  const handleConfirmNext = useCallback((ordered: TextAssetItem[]) => {
    setAssets(ordered);
    setStep('preference');
  }, []);

  const handlePreferenceNext = useCallback((pref: GenerationPreference) => {
    setPreference(pref);
    setStep('assign');
  }, []);

  const handleAssignNext = useCallback(async () => {
    setStep('generating');
    setChunkProgress(null);
    setThinkingSteps([]);
    setParsedEpisodes([]);

    let mergedContent: string;
    if (assignMode === 'merge') {
      mergedContent = assets.map((a) => a.content).join('\n\n');
    } else if (assignMode === 'one-to-one') {
      mergedContent = assets.map((a, i) => `--- 第${i + 1}集: ${a.title} ---\n${a.content}`).join('\n\n');
    } else {
      mergedContent = assets.map((a) => a.content).join('\n\n');
    }

    try {
      const res = await apiGet<{ items: Array<{ id: string; models: Array<{ name: string }> }> }>('/ai/channels');
      const channels = res?.items ?? [];
      const channel = channels.find((c) => c.models && c.models.length > 0 && c.models[0]?.name);
      if (!channel) {
        message.warning(i18n.t('errors.CHANNEL_NOT_FOUND'));
        setStep('assign');
        return;
      }
      const model = channel.models[0]!.name;

      const episodes: ParsedEpisode[] = [];
      const collected: ThinkingStep[] = [];

      const service = createAiThinkService({ timeoutMs: 30 * 60 * 1000 });
      await service.start(
        {
          providerId: channel.id,
          model,
          kind: 'script_import',
          locale: preference?.language === 'en' ? 'en' : preference?.language === 'bilingual' ? 'zh' : 'zh',
          projectData: {
            content: mergedContent,
            episodeMode: assignMode === 'ai-split' ? 'auto' : assignMode === 'merge' ? 'none' : 'manual',
            episodeCount: assignMode === 'one-to-one' ? assets.length : 0,
          },
        },
        {
          onStep: (s: ThinkingStep) => {
            collected.push(s);
            setThinkingSteps([...collected]);
            const parsed = parseJsonFromStepText(s.text);
            if (parsed && Array.isArray(parsed.episodes)) {
              episodes.length = 0;
              parsed.episodes.forEach((ep: any, idx: number) => {
                episodes.push({
                  number: ep.number || idx + 1,
                  title: ep.title || i18n.t('scriptImport.episodeOrdinal', { n: idx + 1 }),
                  content: ep.content || ep.text || ep.body || '',
                });
              });
              setParsedEpisodes([...episodes]);
            }
          },
          onChunkProgress: (p: { done: number; total: number } | null) => setChunkProgress(p),
          onDone: () => {
            if (episodes.length === 0 || episodes.every((ep) => !ep.content)) {
              episodes.push({ number: 1, title: i18n.t('scriptImport.episodeOrdinal', { n: 1 }), content: mergedContent });
              setParsedEpisodes([...episodes]);
            }
            setStep('preview');
          },
          onError: (err: Error) => {
            setStep('assign');
            message.error(i18n.t('scriptImport.aiGenerationFailed', { detail: translateApiError(err) }));
          },
        },
      );
    } catch (err) {
      setStep('assign');
      message.error(i18n.t('scriptImport.aiCallFailed', { detail: translateApiError(err) }));
    }
  }, [assets, assignMode, preference, message]);

  const handleConfirm = useCallback(() => {
    if (parsedEpisodes.length === 0) return;

    const episodes = parsedEpisodes.map((ep, idx) => ({
      id: `ep-${idx + 1}`,
      number: ep.number,
      title: ep.title,
      content: ep.content,
    }));

    const episodesJson = JSON.stringify({ episodes });
    const scriptTitle = assets.length > 0
      ? i18n.t('scriptImport.scriptTitle', { title: assets[0]!.title })
      : i18n.t('scriptImport.scriptTitleDefault', { time: new Date().toLocaleString() });
    void (async () => {
      try {
        const mod = await import('@/features/asset-picker/index.js');
        await mod.addAsset({
          title: scriptTitle,
          kind: 'script' as any,
          bytes: episodesJson.length,
          mimeType: 'application/json',
          data: { kind: 'script' as any, content: episodesJson },
        });
      } catch {
        // 静默失败
      }
    })();

    const scriptState: ScriptEditorState = {
      versions: [{
        id: 'v-1',
        name: i18n.t('scriptImport.importVersion'),
        source: i18n.t('scriptImport.importSource'),
        createdAt: new Date().toISOString(),
        episodes,
      }],
      activeVersionId: 'v-1',
      activeEpisodeId: episodes[0]?.id ?? 'ep-1',
      loading: false,
      saving: false,
      lastSavedAt: null,
    };
    onComplete(scriptState);
    handleClose();
  }, [parsedEpisodes, assets, onComplete, handleClose]);

  const totalTokens = assets.reduce((sum, a) => sum + a.estimatedTokens, 0);
  const totalChars = assets.reduce((sum, a) => sum + a.content.length, 0);

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      width={760}
      centered
      closable={false}
      destroyOnHidden
      styles={{ body: { padding: 0, overflow: 'hidden' } }}
    >
      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", color: theme.toolbar.text, display: 'flex', flexDirection: 'column', height: '80vh' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderBottom: `1px solid ${border}`,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
            <span style={{ fontFamily: "'Sora', system-ui, sans-serif", fontWeight: 800, fontSize: 13, letterSpacing: '-0.02em' }}>ZEROEXO</span>
            <span style={{ fontSize: 11, color: textMuted }}>
              {currentStepInfo.step} / 6 {t(currentStepInfo.labelKey)}
            </span>
          </div>
          <button type="button" onClick={handleClose}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'transparent', color: textMuted, cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 24px 16px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
            {step === 'select' && (
              <StepSelect onNext={handleSelectNext} onCancel={handleClose} />
            )}
            {step === 'confirm' && (
              <StepConfirm assets={assets} onNext={handleConfirmNext} onBack={() => setStep('select')} />
            )}
            {step === 'preference' && (
              <StepPreference
                totalChars={totalChars}
                totalTokens={totalTokens}
                onNext={handlePreferenceNext}
                onBack={() => setStep('confirm')}
              />
            )}
            {step === 'assign' && (
              <StepAssign
                assets={assets}
                assignMode={assignMode}
                onAssignModeChange={setAssignMode}
                onNext={handleAssignNext}
                onBack={() => setStep('preference')}
              />
            )}
            {step === 'generating' && (
              <GeneratingStep
                thinkingSteps={thinkingSteps}
                chunkProgress={chunkProgress}
                totalTokens={totalTokens}
                accent={accent}
                textMuted={textMuted}
              />
            )}
            {step === 'preview' && (
              <PreviewStep
                episodes={parsedEpisodes}
                onConfirm={handleConfirm}
                onReimport={() => setStep('select')}
                accent={accent}
                border={border}
                textMuted={textMuted}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** 步骤 5: AI 生成进度 */
function GeneratingStep({
  thinkingSteps, chunkProgress, totalTokens, accent, textMuted,
}: {
  thinkingSteps: ThinkingStep[];
  chunkProgress: { done: number; total: number } | null;
  totalTokens: number;
  accent: string;
  textMuted: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{ textAlign: 'center', paddingTop: 32 }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: `3px solid ${accent}`,
        borderTopColor: 'transparent',
        margin: '0 auto 16px',
        animation: 'v2-spin 0.8s linear infinite',
      }} />
      <h2 style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
        {t('scriptImport.generatingScript')}
      </h2>
      <p style={{ fontSize: 13, color: textMuted, marginBottom: 20 }}>
        {chunkProgress && chunkProgress.total > 1
          ? t('scriptImport.chunkProcessing', { done: chunkProgress.done, total: chunkProgress.total })
          : t('scriptImport.smartSplitting')}
      </p>

      {thinkingSteps.length > 0 && (
        <div style={{ textAlign: 'left', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBottom: 8 }}>{t('scriptImport.thinkingProcess')}</div>
          <div style={{
            border: `1px solid ${textMuted}20`, borderRadius: 8,
            padding: '8px 12px', maxHeight: 200, overflow: 'auto',
            background: `${accent}04`,
          }}>
            {thinkingSteps.map((s, i) => (
              <div key={i} style={{ fontSize: 11, color: textMuted, marginBottom: 4, lineHeight: 1.5 }}>
                <span style={{ color: accent, fontWeight: 600 }}>#{i + 1}</span> {s.text}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: textMuted }}>
        {t('scriptImport.inputEstimate', { tokens: totalTokens.toLocaleString() })}
      </div>

      <style>{`@keyframes v2-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** 步骤 6: 预览确认 */
function PreviewStep({
  episodes, onConfirm, onReimport, accent, border, textMuted,
}: {
  episodes: ParsedEpisode[];
  onConfirm: () => void;
  onReimport: () => void;
  accent: string; border: string; textMuted: string;
}): React.ReactElement {
  const [expandedEp, setExpandedEp] = useState<number | null>(null);
  const [viewerEp, setViewerEp] = useState<number | null>(null); // 放大查看:统一资源查看器(Monaco 大文本)
  const { t } = useTranslation();

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(16,185,129,0.12)', color: '#10b981',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 10px',
        }}>
          <span style={{ fontSize: 20 }}>+</span>
        </div>
        <h2 style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          {t('scriptImport.generationDone')}
        </h2>
        <p style={{ fontSize: 12, color: textMuted, margin: 0 }}>
          {t('scriptImport.generationSummary', { count: episodes.length })}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20, maxHeight: 360, overflow: 'auto' }}>
        {episodes.map((ep, idx) => (
          <div key={idx} style={{
            border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden',
          }}>
            <div
              onClick={() => setExpandedEp(expandedEp === idx ? null : idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                cursor: 'pointer', userSelect: 'none',
              }}
            >
              <span style={{ color: accent, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>#{ep.number}</span>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{ep.title}</span>
              <span style={{ fontSize: 11, color: textMuted }}>{t('scriptImport.charCount', { chars: ep.content.length.toLocaleString() })}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setViewerEp(idx); }}
                title={t('scriptImport.viewFullText')}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 4, border: 'none', background: 'transparent', color: textMuted, cursor: 'pointer', flexShrink: 0 }}
              >
                <Maximize2 size={12} />
              </button>
              <span style={{ fontSize: 11, color: textMuted, transform: expandedEp === idx ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <ArrowLeft size={11} />
              </span>
            </div>
            {expandedEp === idx && (
              <div style={{
                padding: '0 12px 12px', maxHeight: 200, overflow: 'auto',
                fontFamily: "'Courier New', monospace", fontSize: 11, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: textMuted,
              }}>
                {ep.content || t('scriptImport.emptyContent')}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button type="button" onClick={onReimport} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 20px', borderRadius: 8, border: `1px solid ${border}`,
          background: 'transparent', color: textMuted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {t('scriptImport.reimport')}
        </button>
        <button type="button" onClick={onConfirm} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 24px', borderRadius: 8, border: 'none',
          background: accent, color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {t('scriptImport.confirmEnterScript')}
        </button>
      </div>

      {/* 放大查看:统一资源查看器 AssetDetailViewer(script 类型, Monaco 大文本) */}
      {viewerEp !== null && episodes[viewerEp] && (
        <AssetDetailViewer
          asset={{
            id: `preview-ep-${viewerEp}`,
            title: `#${episodes[viewerEp]!.number} ${episodes[viewerEp]!.title}`,
            kind: 'script',
            bytes: episodes[viewerEp]!.content.length,
            data: { kind: 'script', content: episodes[viewerEp]!.content },
          }}
          onClose={() => setViewerEp(null)}
        />
      )}
    </div>
  );
}

/** 从 AI 步骤文本中解析 JSON 数据 */
function parseJsonFromStepText(text: string): any {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlockMatch ? codeBlockMatch[1]! : text;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}