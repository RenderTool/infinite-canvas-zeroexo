/**
 * PreFlightModal - 预飞确认弹窗
 *
 * 在 AI 生成前展示步骤明细、Token 估算和费用，供用户确认。
 * 支持模型切换实时重算、并行数滑条调节。
 */
import { useState, useMemo, useEffect, type CSSProperties } from 'react';
import { Modal, Select, Slider } from 'antd';
import { Lock, Cloud, CloudLightning, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useAiConfigStore, filterChannelModelsByCapability, modelOptionLabel } from '@/features/ai-config/use-ai-config-store';

export interface PreFlightModalProps {
  open: boolean;
  /** 源文本名 */
  sourceTextName: string;
  /** 章节总数 */
  chapterCount: number;
  /** 已选章节数 */
  selectedChapterCount: number;
  /** 总字符数 */
  totalChars: number;
  /** 初始模型 ID */
  initialModelId?: string;
  /** 初始并行数 */
  initialParallelism?: number;
  /** 确认回调 */
  onConfirm: (modelId: string, parallelism: number) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** z-index（需高于父 Modal） */
  zIndex?: number;
}

export function PreFlightModal({
  open,
  sourceTextName,
  chapterCount,
  selectedChapterCount,
  totalChars,
  initialModelId = 'gpt-4o',
  initialParallelism = 3,
  onConfirm,
  onCancel,
  zIndex,
}: PreFlightModalProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  // 从admin后端动态获取渠道/模型列表
  const config = useAiConfigStore((s) => s.config);
  const loaded = useAiConfigStore((s) => s.loaded);
  const loadChannels = useAiConfigStore((s) => s.loadChannels);
  useEffect(() => {
    if (!loaded) void loadChannels();
  }, [loaded, loadChannels]);

  // 按text能力筛选模型(编码后)
  const textModelOptions = useMemo(() => {
    const encoded = filterChannelModelsByCapability(config.channels, 'text');
    return encoded.map((enc) => ({
      value: enc,
      label: modelOptionLabel(config, enc),
    }));
  }, [config.channels]);

  // 默认模型:取第一个可用text模型,回退到initialModelId
  const defaultModel = useMemo(() => {
    if (textModelOptions.length > 0) return textModelOptions[0]!.value;
    return initialModelId;
  }, [textModelOptions, initialModelId]);

  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [parallelism, setParallelism] = useState(initialParallelism);

  // 每次打开弹窗时重置状态
  useEffect(() => {
    if (open) {
      setSelectedModel(defaultModel);
      setParallelism(initialParallelism);
    }
  }, [open, defaultModel, initialParallelism]);

  // 当前选中模型定价(取第一个匹配的)
  const currentPricing = useMemo(() => {
    const parts = selectedModel.split('::');
    const modelName = parts[1] ?? selectedModel;
    // 简单估算:假定text模型价格
    return { id: modelName, label: modelName, inputPricePerM: 2.5, outputPricePerM: 10 };
  }, [selectedModel]);

  // 步骤明细
  const steps: Array<{ icon: LucideIcon; label: string; location: string; tokenCost: string }> = [
    { icon: Lock, label: t('sourceMaterial.stepChapterDetect'), location: t('sourceMaterial.stepLocal'), tokenCost: t('sourceMaterial.stepNoToken') },
    { icon: Lock, label: t('sourceMaterial.stepChapterSelect'), location: t('sourceMaterial.stepLocal'), tokenCost: t('sourceMaterial.stepNoToken') },
    { icon: Lock, label: t('sourceMaterial.stepBuildZeroexo'), location: t('sourceMaterial.stepLocal'), tokenCost: t('sourceMaterial.stepNoToken') },
    { icon: Cloud, label: t('sourceMaterial.stepSaveToLibrary'), location: t('sourceMaterial.stepCloud'), tokenCost: t('sourceMaterial.stepNoToken') },
    { icon: CloudLightning, label: t('sourceMaterial.stepAiScript'), location: t('sourceMaterial.stepCloud'), tokenCost: t('sourceMaterial.stepConsumeToken') },
  ];

  // ── 主题色 ──
  const bg = theme.toolbar.background;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const accent = theme.toolbar.accent;
  const bgHeader = isDark ? '#1f1f1f' : '#fafaf7';

  // ── 样式 ──
  const contentStyle: CSSProperties = {
    background: bg,
    padding: 0,
    overflow: 'hidden',
    borderRadius: 16,
    border: `1px solid ${border}`,
  };
  const modalBodyStyle: CSSProperties = { padding: 0, display: 'flex', flexDirection: 'column' };
  const maskStyle: CSSProperties = {
    background: 'transparent',
  };
  const headerStyle: CSSProperties = {
    padding: '18px 24px',
    borderBottom: `1px solid ${border}`,
    background: bgHeader,
  };
  const sectionStyle: CSSProperties = {
    padding: '14px 24px',
    borderBottom: `1px solid ${border}`,
  };
  const sectionLabel: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: textMuted,
    marginBottom: 10,
    letterSpacing: '0.5px',
  };
  const stepRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '7px 0',
    fontSize: 13,
    color: text,
    gap: 8,
  };
  const stepIconStyle: CSSProperties = {
    width: 28,
    textAlign: 'center',
    fontSize: 13,
    flexShrink: 0,
  };
  const stepLabelStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
  };
  const stepLocationStyle: CSSProperties = {
    width: 48,
    fontSize: 11,
    color: textMuted,
    textAlign: 'center',
    flexShrink: 0,
  };
  const stepTokenCostStyle: CSSProperties = {
    width: 90,
    fontSize: 11,
    color: textMuted,
    textAlign: 'right',
    flexShrink: 0,
  };
  const summaryRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: 13,
    color: text,
  };
  const summaryValueStyle: CSSProperties = {
    color: accent,
    fontWeight: 600,
  };
  const sliderRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '4px 0',
  };
  const sliderLabelStyle: CSSProperties = {
    fontSize: 13,
    color: text,
    flexShrink: 0,
    minWidth: 48,
  };
  const sliderValueStyle: CSSProperties = {
    fontSize: 13,
    color: accent,
    fontWeight: 600,
    flexShrink: 0,
    minWidth: 20,
    textAlign: 'right',
  };
  const modelSelectStyle: CSSProperties = {
    minWidth: 150,
  };
  const footerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '14px 24px',
    borderTop: `1px solid ${border}`,
    background: bgHeader,
  };
  const btnBase: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'inherit',
  };
  const primaryBtn: CSSProperties = { ...btnBase, background: accent, color: '#fff' };
  const ghostBtn: CSSProperties = {
    ...btnBase,
    border: `1px solid ${border}`,
    background: 'transparent',
    color: textMuted,
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      centered
      width={480}
      footer={null}
      destroyOnHidden
      closeIcon={null}
      mask={{ closable: false }}
      zIndex={zIndex}
      styles={{ container: contentStyle, body: modalBodyStyle, mask: maskStyle }}
    >
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ fontSize: 16, fontWeight: 600, color: text, letterSpacing: '0.3px' }}>
          {t('sourceMaterial.confirmGenerate')}
        </div>
        <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
          {t('sourceMaterial.headerSubtitle', { name: sourceTextName, selected: selectedChapterCount, total: chapterCount })}
        </div>
      </div>

      {/* 步骤明细 */}
      <div style={sectionStyle}>
        <div style={sectionLabel}>{t('sourceMaterial.stepsSection')}</div>
        {steps.map((step, idx) => (
          <div key={idx} style={stepRowStyle}>
            <span style={stepIconStyle}><step.icon size={14} style={{ verticalAlign: 'middle' }} /></span>
            <span style={stepLabelStyle}>{(idx + 1) + '. ' + step.label}</span>
            <span style={stepLocationStyle}>{step.location}</span>
            <span style={stepTokenCostStyle}>{step.tokenCost}</span>
          </div>
        ))}
      </div>

      {/* Token 估算 */}
      <div style={sectionStyle}>
        <div style={sectionLabel}>{t('sourceMaterial.costSection')}</div>
        <div style={summaryRowStyle}>
          <span style={{ color: textMuted }}>{t('sourceMaterial.inputToken')}</span>
          <span>{totalChars > 0 ? Math.ceil(totalChars / 2).toLocaleString() : '--'}</span>
        </div>
        <div style={summaryRowStyle}>
          <span style={{ color: textMuted }}>{t('sourceMaterial.outputToken')}</span>
          <span>{(selectedChapterCount * 4000).toLocaleString()}</span>
        </div>
        <div style={summaryRowStyle}>
          <span style={{ color: textMuted }}>{t('sourceMaterial.totalToken')}</span>
          <span style={summaryValueStyle}>
            {(Math.ceil(totalChars / 2) + selectedChapterCount * 4000).toLocaleString()}
          </span>
        </div>
        <div style={summaryRowStyle}>
          <span style={{ color: textMuted }}>{t('sourceMaterial.estimatedCost')}</span>
          <span style={summaryValueStyle}>
            {currentPricing
              ? `$${((Math.ceil(totalChars / 2) / 1000000) * currentPricing.inputPricePerM + (selectedChapterCount * 4000 / 1000000) * currentPricing.outputPricePerM).toFixed(4)}`
              : '--'}
          </span>
        </div>
      </div>

      {/* 模型选择(动态从admin后端获取) */}
      <div style={sectionStyle}>
        <div style={sectionLabel}>{t('sourceMaterial.modelSection')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: textMuted, flexShrink: 0 }}>{t('sourceMaterial.model')}</span>
          <Select
            value={selectedModel}
            onChange={(value) => setSelectedModel(value)}
            size="small"
            style={modelSelectStyle}
            options={textModelOptions}
          />
          <span style={{ fontSize: 12, color: textMuted }}>
            {currentPricing
              ? `$${currentPricing.inputPricePerM}/M in · $${currentPricing.outputPricePerM}/M out`
              : ''}
          </span>
        </div>
      </div>

      {/* 并行数 */}
      <div style={sectionStyle}>
        <div style={sectionLabel}>{t('sourceMaterial.parallelSection')}</div>
        <div style={sliderRowStyle}>
          <span style={sliderLabelStyle}>{t('sourceMaterial.parallelism')}</span>
          <Slider
            min={1}
            max={10}
            value={parallelism}
            onChange={(val) => setParallelism(val)}
            style={{ flex: 1, margin: '0 8px' }}
            trackStyle={{ background: accent }}
            handleStyle={{ borderColor: accent }}
          />
          <span style={sliderValueStyle}>{parallelism}</span>
        </div>
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <button type="button" style={ghostBtn} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          style={primaryBtn}
          onClick={() => {
            // 解码模型名(去掉channelId前缀)
            const parts = selectedModel.split('::');
            const modelName = parts[1] ?? selectedModel;
            onConfirm(modelName, parallelism);
          }}
        >
          {t('sourceMaterial.startGeneration')}
        </button>
      </div>
    </Modal>
  );
}