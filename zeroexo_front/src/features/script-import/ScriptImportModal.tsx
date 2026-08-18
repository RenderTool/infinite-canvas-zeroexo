/**
 * ScriptImportModal - 剧本导入主弹窗
 *
 * 二选一入口：
 * - 已有剧本 → 上传 → AI 真实分析分集 → AI 生成报告+剧本+方案概览 → 微调
 * - 只有灵感 → 关闭弹窗，回到创意简报步骤
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Lightbulb, FileText, ArrowLeft } from 'lucide-react';
import { Modal } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ScriptImportModalProps, ScriptSourceType, ScriptImportState, EpisodeConfig, ParamComparison, ImportFileInfo } from './types.js';
import type { ScriptEditorState } from '@/features/canvas-nodes/storyboard/script-types.js';
import { FileUploadStep } from './FileUploadStep.js';
import { EpisodeConfigStep } from './EpisodeConfigStep.js';
import { ParamComparisonStep } from './ParamComparisonStep.js';
import { ScriptViewer } from './ScriptViewer.js';

export function ScriptImportModal({ open, onClose, projectSetupConfig, onComplete }: ScriptImportModalProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;

  const [, setSourceType] = useState<ScriptSourceType | null>(null);
  const [step, setStep] = useState<'select' | 'upload' | 'episode_config' | 'param_compare' | 'preview'>('select');
  const [, setImportState] = useState<ScriptImportState | null>(null);
  const [mergedContent, setMergedContent] = useState('');

  const handleClose = useCallback(() => {
    setSourceType(null);
    setStep('select');
    setImportState(null);
    setMergedContent('');
    onClose();
  }, [onClose]);

  const handleSelectType = useCallback((type: ScriptSourceType) => {
    setSourceType(type);
    if (type === 'inspire') {
      // 只有灵感：直接关闭弹窗，让用户去创意简报步骤输入
      onComplete(null as unknown as ScriptEditorState);
      handleClose();
    } else {
      // 已有剧本：进入上传流程
      setStep('upload');
    }
  }, [onComplete, handleClose]);

  const handleFilesComplete = useCallback((_files: ImportFileInfo[], merged: string) => {
    setMergedContent(merged);
    setStep('episode_config');
  }, []);

  const handleEpisodeConfigComplete = useCallback((_config: EpisodeConfig) => {
    // Store episode config and move to param comparison
    setStep('param_compare');
  }, []);

  const handleParamCompareComplete = useCallback((_comparison: ParamComparison) => {
    setStep('preview');
  }, []);

  const handleConfirmPreview = useCallback(() => {
    const scriptState: ScriptEditorState = {
      versions: [{
        id: 'v-1',
        name: '初始版本',
        source: '导入创作',
        createdAt: new Date().toISOString(),
        episodes: [{
          id: 'ep-1',
          number: 1,
          title: '第1集',
          content: mergedContent,
        }],
      }],
      activeVersionId: 'v-1',
      activeEpisodeId: 'ep-1',
      loading: false,
      saving: false,
      lastSavedAt: null,
    };
    onComplete(scriptState);
    handleClose();
  }, [mergedContent, onComplete, handleClose]);

  const handleBack = useCallback(() => {
    if (step === 'upload') { setSourceType(null); setStep('select'); }
    else if (step === 'episode_config') { setStep('upload'); }
    else if (step === 'param_compare') { setStep('episode_config'); }
    else if (step === 'preview') { setStep('param_compare'); }
  }, [step]);

  const base: React.CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif", color: theme.toolbar.text };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      width={step === 'select' ? 600 : 700}
      centered
      closable={false}
      destroyOnHidden
      styles={{ body: { padding: 0, overflow: 'hidden' } }}
    >
      <div style={base}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: `1px solid ${border}`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: "'Sora', system-ui, sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', color: textMuted,
          }}>
            {step !== 'select' && (
              <button type="button" onClick={handleBack}
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'transparent', color: textMuted, cursor: 'pointer' }}>
                <ArrowLeft size={14} />
              </button>
            )}
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />
            ZEROEXO
          </div>
          <button type="button" onClick={handleClose}
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'transparent', color: '#78716c', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '32px 32px 24px', minHeight: 300 }}>
          {step === 'select' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>如何开始剧本创作？</div>
              <div style={{ fontSize: 13, color: textMuted, marginBottom: 28 }}>选择一种方式开始你的剧本创作之旅</div>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                {[
                  { type: 'import' as ScriptSourceType, icon: <FileText size={28} />, title: '已有剧本', desc: '上传 .txt .docx .md 文件\nAI 自动分析并生成报告' },
                  { type: 'inspire' as ScriptSourceType, icon: <Lightbulb size={28} />, title: '只有灵感', desc: '回到创意简报\n让 AI 从一句话开始' },
                ].map((opt) => (
                  <button key={opt.type} type="button" onClick={() => handleSelectType(opt.type)}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                      padding: '32px 24px', borderRadius: 12, border: `1.5px solid ${border}`,
                      background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                      cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', transition: 'all .2s',
                      minHeight: 180,
                    }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${accent}12`, color: accent }}>{opt.icon}</div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{opt.title}</div>
                    <div style={{ fontSize: 11, color: textMuted, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'upload' && (
            <FileUploadStep
              onComplete={handleFilesComplete}
            />
          )}

          {step === 'episode_config' && (
            <EpisodeConfigStep
              onComplete={handleEpisodeConfigComplete}
              onBack={handleBack}
            />
          )}

          {step === 'param_compare' && (
            <ParamComparisonStep
              mergedContent={mergedContent}
              projectSetupConfig={projectSetupConfig}
              onComplete={handleParamCompareComplete}
              onBack={handleBack}
            />
          )}

          {step === 'preview' && (
            <div>
              <div style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 16, textAlign: 'center' }}>
                {t('scriptImport.scriptConverted')}
              </div>
              <ScriptViewer content={mergedContent} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
                <button type="button" onClick={() => setStep('upload')}
                  style={{ padding: '8px 20px', borderRadius: 8, border: `1px solid ${border}`, background: 'transparent', color: textMuted, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {t('scriptImport.reimport')}
                </button>
                <button type="button" onClick={handleConfirmPreview}
                  style={{ padding: '8px 24px', borderRadius: 8, border: 'none', background: accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {t('scriptImport.confirmAndEdit')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}