/**
 * StoryboardPromptEditor - 分镜生产台底部提示词区（Plan#53 T9）
 *
 * 三输入框（image/video/negative）+ 模型/时长/画幅选择 + 生成按钮 + 质量门徽章位。
 * 样式复用 production-editor-styles.ts 的 noteInputStyle/formLabelStyle。
 */
import { memo, useCallback, type ReactElement } from 'react';
import { Button, Select, Tooltip } from 'antd';
import { Sparkles, Wand2, Gauge, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formLabelStyle, noteInputStyle } from '../production-manager/production-editor-styles';

export interface QualityGate {
  score: number;
  deductions: Array<{ item: number; reason: string }>;
  checkedAt?: string;
}

export interface StoryboardPromptEditorProps {
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt: string;
  quality?: QualityGate;
  model?: string;
  duration?: number;
  aspectRatio?: string;
  onImagePromptChange: (v: string) => void;
  onVideoPromptChange: (v: string) => void;
  onNegativePromptChange: (v: string) => void;
  onModelChange?: (v: string) => void;
  onDurationChange?: (v: number) => void;
  onAspectRatioChange?: (v: string) => void;
  onGenerate?: () => void;
  onAssembleFromBible?: () => void;
  onAiComplete?: () => void;
  generating?: boolean;
  disabled?: boolean;
  /** 质量门是否阻断（D6 默认 ON） */
  qualityGateBlock?: boolean;
  models?: Array<{ value: string; label: string }>;
  durations?: number[];
  aspectRatios?: string[];
  theme: any;
}

const DEFAULT_MODELS = [
  { value: 'seedance', label: 'Seedance' },
  { value: 'sora', label: 'Sora' },
  { value: 'kling', label: 'Kling' },
  { value: 'veo', label: 'Veo' },
  { value: 'runway', label: 'Runway' },
  { value: 'jimeng', label: '即梦' },
  { value: 'wanxiang', label: '万相' },
];
const DEFAULT_DURATIONS = [4, 8, 12];
const DEFAULT_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '21:9'];

export const StoryboardPromptEditor = memo(function StoryboardPromptEditor({
  imagePrompt, videoPrompt, negativePrompt, quality, model, duration, aspectRatio,
  onImagePromptChange, onVideoPromptChange, onNegativePromptChange,
  onModelChange, onDurationChange, onAspectRatioChange, onGenerate, onAssembleFromBible, onAiComplete,
  generating = false, disabled = false, qualityGateBlock = true,
  models = DEFAULT_MODELS, durations = DEFAULT_DURATIONS, aspectRatios = DEFAULT_ASPECT_RATIOS,
  theme,
}: StoryboardPromptEditorProps): ReactElement {
  const { t } = useTranslation();
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const cardBorder = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const gateBlocked = qualityGateBlock && !!quality && quality.score < 7;
  const qualityColor = quality
    ? (quality.score >= 7 ? (theme.mode === 'dark' ? '#22c55e' : '#16a34a') : (theme.mode === 'dark' ? '#ef4444' : '#dc2626'))
    : textMuted;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onGenerate?.();
    }
  }, [onGenerate]);

  const inputBase: React.CSSProperties = {
    ...noteInputStyle(theme),
    minHeight: 44,
    maxHeight: 80,
    color: textPrimary,
    fontSize: 12,
    resize: 'vertical',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px', background: theme.mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)', borderTop: `1px solid ${cardBorder}`, minHeight: 150, maxHeight: 260, overflow: 'auto' }}>
      {/* 第一行：Image Prompt */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ ...formLabelStyle(theme), marginBottom: 0, minWidth: 96, paddingTop: 10 }}>{t('storyboard.imagePrompt', 'Image Prompt')}</div>
        <textarea
          value={imagePrompt}
          onChange={(e) => onImagePromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('storyboard.promptPlaceholder', '输入首帧/关键帧提示词…')}
          style={{ ...inputBase, flex: 1 }}
        />
      </div>
      {/* 第二行：Video Prompt */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ ...formLabelStyle(theme), marginBottom: 0, minWidth: 96, paddingTop: 10 }}>{t('storyboard.videoPrompt', 'Video Prompt')}</div>
        <textarea
          value={videoPrompt}
          onChange={(e) => onVideoPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('storyboard.videoPromptPlaceholder', '输入运动提示词…')}
          style={{ ...inputBase, flex: 1 }}
        />
      </div>
      {/* 第三行：Negative Prompt */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ ...formLabelStyle(theme), marginBottom: 0, minWidth: 96, paddingTop: 10 }}>{t('storyboard.negativePrompt', 'Negative')}</div>
        <textarea
          value={negativePrompt}
          onChange={(e) => onNegativePromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('storyboard.negativePromptPlaceholder', '输入本镜负面提示词（实例式，避免范畴词）…')}
          style={{ ...inputBase, flex: 1 }}
        />
      </div>
      {/* 第四行：质量门 + F 码 + 参数 + 生成按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* 质量门徽章 */}
        <Tooltip title={quality && quality.deductions.length > 0 ? quality.deductions.map((d) => `#${d.item} ${d.reason}`).join('；') : undefined}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, border: `1px solid ${qualityColor}`, color: qualityColor, fontSize: 11, cursor: quality ? 'help' : 'default' }}>
            <Gauge size={12} />
            {quality ? `${quality.score}/10` : t('storyboard.qualityNotChecked', '未评分')}
            {gateBlocked && <AlertTriangle size={12} />}
          </div>
        </Tooltip>
        {gateBlocked && (
          <span style={{ fontSize: 10, color: qualityColor }}>{t('storyboard.qualityBelowGate', '质量门未通过，禁止生成')}</span>
        )}
        <span style={{ width: 1, height: 16, background: cardBorder }} />
        {/* 模型 / 时长 / 画幅 */}
        <Select
          size="small"
          value={model}
          onChange={onModelChange}
          style={{ width: 110 }}
          options={models}
          placeholder={t('storyboard.model', '模型')}
          popupMatchSelectWidth={false}
        />
        <Select
          size="small"
          value={duration}
          onChange={onDurationChange}
          style={{ width: 80 }}
          options={durations.map((d) => ({ value: d, label: `${d}s` }))}
          placeholder={t('storyboard.duration', '时长')}
          popupMatchSelectWidth={false}
        />
        <Select
          size="small"
          value={aspectRatio}
          onChange={onAspectRatioChange}
          style={{ width: 80 }}
          options={aspectRatios.map((r) => ({ value: r, label: r }))}
          placeholder={t('storyboard.aspectRatio', '画幅')}
          popupMatchSelectWidth={false}
        />
        <span style={{ flex: 1 }} />
        {/* 生成动作组 */}
        {onAssembleFromBible && (
          <Button
            size="small"
            type="text"
            icon={<Wand2 size={13} />}
            onClick={onAssembleFromBible}
            disabled={disabled || generating}
            style={{ fontSize: 12, color: textMuted }}
          >
            {t('storyboard.assembleFromBible', '从圣经组装')}
          </Button>
        )}
        {onAiComplete && (
          <Button
            size="small"
            type="text"
            icon={<Sparkles size={13} />}
            onClick={onAiComplete}
            disabled={disabled || generating}
            style={{ fontSize: 12, color: textMuted }}
          >
            {t('storyboard.aiComplete', 'AI 补全')}
          </Button>
        )}
        <Button
          size="small"
          type="primary"
          icon={<Sparkles size={13} />}
          loading={generating}
          disabled={disabled || gateBlocked}
          onClick={onGenerate}
          style={{ fontSize: 12, background: accent, borderColor: accent, color: '#fff' }}
        >
          {t('storyboard.generateVideo', '生成视频')}
        </Button>
      </div>
    </div>
  );
});
