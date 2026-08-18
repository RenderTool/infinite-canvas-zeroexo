/**
 * PromptPanel - 节点提示词面板(容器)
 *
 * 受控组件:接收 node 信息 + isRunning + 回调,内部管理 prompt 文本状态。
 * 简化版(Phase C.4):仅 textarea + 生成/停止按钮 + 模式标签。
 * ModelPicker / SettingsPopover / PromptLibrary / ResourceMention 留待 Phase E 补齐。
 *
 * 事件 stopPropagation(onMouseDown + onPointerDown + onWheel)避免触发画布交互。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowUp, LoaderCircle, Square } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { PromptTextarea } from './prompt-textarea.js';
import { ResourceMentionTextarea } from './resource-mention-textarea.js';
import { ModelPicker } from './model-picker.js';
import { ImageSettingsPopover } from './image-settings-popover.js';
import { VideoSettingsPopover } from './video-settings-popover.js';
import { AudioSettingsPopover } from './audio-settings-popover.js';
import type { ResourceReference } from '../resource-references.js';
import { useAiConfigStore, filterChannelModelsByCapability } from '../../ai-config/use-ai-config-store.js';
import type { ModelCapability } from '../../ai-config/use-ai-config-store.js';

export type GenerationMode = 'text' | 'image' | 'video' | 'audio';

export interface PromptPanelProps {
  nodeId: string;
  nodeType: 'text' | 'image' | 'video' | 'audio' | 'generator';
  initialPrompt?: string;
  isRunning: boolean;
  onPromptChange: (nodeId: string, prompt: string) => void;
  onGenerate: (nodeId: string, mode: GenerationMode, prompt: string) => void;
  onStop: (nodeId: string) => void;
  /** 配置节点专用:当前生成模式(从 node.data.generationMode 推导) */
  configMode?: GenerationMode;
  /** 配置节点专用:组装提示词引用文案描述(从连接节点收集,只读展示) */
  composerDescription?: string;
  /** 配置节点专用:@ 弹出引用面板的候选资源列表(从连接节点构建,active 标记是否已连接) */
  references?: ResourceReference[];
  /** 当前节点选用的模型值("channelId::model" 编码),用于 ModelPicker 显示 */
  model?: string;
  /** 节点配置变更回调(更新 node.data 的 model/size/quality 等字段) */
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  /** 打开 AI 渠道设置(ModelPicker 无模型时触发) */
  onOpenAiConfig?: () => void;
  /** 图片节点专用:当前质量(从 node.data.quality 读取) */
  imageQuality?: string;
  /** 图片节点专用:当前尺寸(从 node.data.size 读取) */
  imageSize?: string;
  /** 图片节点专用:当前生成数量(从 node.data.count 读取) */
  imageCount?: number;
  /** 视频节点专用:当前分辨率/清晰度(从 node.data.vquality 读取) */
  videoVquality?: string;
  /** 视频节点专用:当前尺寸/比例(从 node.data.size 读取) */
  videoSize?: string;
  /** 视频节点专用:当前时长秒(从 node.data.seconds 读取) */
  videoSeconds?: number;
  /** 视频节点专用:是否生成声音(从 node.data.generateAudio 读取) */
  videoGenerateAudio?: boolean;
  /** 视频节点专用:是否添加水印(从 node.data.watermark 读取) */
  videoWatermark?: boolean;
  /** BUG8.5: 视频节点专用:视频生成模式(从 node.data.videoMode 读取,Seedance 专用) */
  videoMode?: string;
  /** 音频节点专用:当前音色(从 node.data.voice 读取) */
  audioVoice?: string;
  /** 音频节点专用:当前格式(从 node.data.audioFormat 读取) */
  audioFormat?: string;
  /** 音频节点专用:当前语速(从 node.data.audioSpeed 读取) */
  audioSpeed?: number;
  /** 音频节点专用:声音指令(从 node.data.audioInstructions 读取) */
  audioInstructions?: string;
}

function defaultMode(nodeType: PromptPanelProps['nodeType'], configMode?: GenerationMode): GenerationMode {
  if (nodeType === 'generator') return configMode ?? 'image';
  if (nodeType === 'text') return 'text';
  if (nodeType === 'video') return 'video';
  if (nodeType === 'audio') return 'audio';
  return 'image';
}

export function PromptPanel({
  nodeId,
  nodeType,
  initialPrompt = '',
  isRunning,
  onPromptChange,
  onGenerate,
  onStop,
  configMode,
  composerDescription,
  references,
  model,
  onConfigChange,
  onOpenAiConfig,
  imageQuality,
  imageSize,
  imageCount,
  videoVquality,
  videoSize,
  videoSeconds,
  videoGenerateAudio,
  videoWatermark,
  videoMode,
  audioVoice,
  audioFormat,
  audioSpeed,
  audioInstructions,
}: PromptPanelProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const mode = defaultMode(nodeType, configMode);
  const [prompt, setPrompt] = useState(initialPrompt);
  const spinRef = useRef<HTMLSpanElement>(null);

  const aiConfig = useAiConfigStore((state) => state.config);

  const hasModelsForCapability = (capability: ModelCapability): boolean => {
    const models = filterChannelModelsByCapability(aiConfig.channels, capability);
    return models.length > 0;
  };

  const hasImageModels = hasModelsForCapability('image');
  const hasVideoModels = hasModelsForCapability('video');
  const hasAudioModels = hasModelsForCapability('audio');

  // initialPrompt 变化时同步(nodeId 切换)
  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt, nodeId]);

  // LoaderCircle 旋转动画:无全局 CSS,用 Web Animations API 自包含实现
  useEffect(() => {
    const el = spinRef.current;
    if (!el || !isRunning) return;
    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 1000, iterations: Infinity },
    );
    return () => anim.cancel();
  }, [isRunning]);

  const updatePrompt = useCallback(
    (value: string) => {
      setPrompt(value);
      onPromptChange(nodeId, value);
    },
    [onPromptChange, nodeId],
  );

  const submit = useCallback(() => {
    const text = prompt.trim();
    if (!text || isRunning) return;
    onGenerate(nodeId, mode, text);
    setPrompt('');
  }, [prompt, isRunning, onGenerate, nodeId, mode]);

  const handleAction = useCallback(() => {
    if (isRunning) onStop(nodeId);
    else submit();
  }, [isRunning, onStop, nodeId, submit]);

  const modeLabel = t(`prompt.mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
  // 运行中按钮始终可用(可停止);非运行时空 prompt 禁用
  const actionDisabled = !isRunning && prompt.trim().length === 0;

  return (
    <div
      style={containerStyle(theme.toolbar.background, theme.toolbar.border, theme.toolbar.text)}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {/* 问题6②: 配置节点的组装提示词引用文案描述区域(只读展示从连接节点收集的引用) */}
      {nodeType === 'generator' && composerDescription ? (
        <div style={composerDescStyle(theme.toolbar.panel, theme.toolbar.border, theme.toolbar.textMuted)}>
          <span style={composerLabelStyle(theme.toolbar.text)}>{t('prompt.composerLabel')}</span>
          <span style={composerTextStyle(theme.toolbar.textMuted)}>{composerDescription}</span>
        </div>
      ) : null}

      {/* 配置节点使用带 @ 资源引用的 textarea;其他节点用普通 textarea */}
      {nodeType === 'generator' ? (
        <ResourceMentionTextarea
          value={prompt}
          mode={mode}
          theme={theme}
          references={references ?? []}
          onChange={updatePrompt}
          onSubmit={submit}
          disabled={isRunning}
        />
      ) : (
        <PromptTextarea
          value={prompt}
          mode={mode}
          theme={theme}
          onChange={updatePrompt}
          onSubmit={submit}
          disabled={isRunning}
        />
      )}

      <div style={bottomRowStyle}>
        {/* 生成中锁定参数编辑区(模型/质量/尺寸等),仅保留右侧停止按钮可操作 */}
        <div style={{ ...leftClusterStyle, pointerEvents: isRunning ? 'none' : 'auto', opacity: isRunning ? 0.55 : 1 }}>
          <span style={modeLabelStyle(theme.toolbar.textMuted)}>{modeLabel}</span>
          {onConfigChange ? (
            <ModelPicker
              value={model ?? ''}
              onChange={(nextModel) => onConfigChange(nodeId, { model: nextModel })}
              capability={mode}
              theme={theme}
              onMissingConfig={onOpenAiConfig}
              disabled={isRunning}
            />
          ) : null}
          {/* BUG8.2: 图片节点生成配置(质量/尺寸/数量),仅 image 模式且有模型时显示 */}
          {onConfigChange && mode === 'image' && hasImageModels ? (
            <ImageSettingsPopover
              model={model ?? ''}
              quality={imageQuality ?? 'auto'}
              size={imageSize ?? 'auto'}
              count={imageCount ?? 1}
              theme={theme}
              onChange={(patch) => onConfigChange(nodeId, patch)}
            />
          ) : null}
          {/* BUG8.3: 视频节点生成配置(分辨率/比例/时长,Seedance/OpenAI 分支),仅 video 模式且有模型时显示 */}
          {onConfigChange && mode === 'video' && hasVideoModels ? (
            <VideoSettingsPopover
              model={model ?? ''}
              vquality={videoVquality ?? '720p'}
              size={videoSize ?? 'adaptive'}
              seconds={videoSeconds ?? 5}
              generateAudio={videoGenerateAudio ?? true}
              watermark={videoWatermark ?? false}
              videoMode={videoMode}
              theme={theme}
              onChange={(patch) => onConfigChange(nodeId, patch)}
            />
          ) : null}
          {/* BUG8.4: 音频节点生成配置(音色/格式/语速/指令),仅 audio 模式且有模型时显示 */}
          {onConfigChange && mode === 'audio' && hasAudioModels ? (
            <AudioSettingsPopover
              model={model ?? ''}
              voice={audioVoice ?? 'alloy'}
              format={audioFormat ?? 'mp3'}
              speed={audioSpeed ?? 1}
              instructions={audioInstructions}
              theme={theme}
              onChange={(patch) => onConfigChange(nodeId, patch)}
            />
          ) : null}
          {/* TODO Phase E: CanvasPromptLibrary(提示词库选择) */}
        </div>

        <Button
          type="primary"
          danger={isRunning}
          size="middle"
          disabled={actionDisabled}
          onClick={handleAction}
          aria-label={isRunning ? t('prompt.stopGenerate') : t('prompt.generate')}
          style={actionButtonStyle}
        >
          {isRunning ? (
            <>
              <span ref={spinRef} style={spinHostStyle}>
                <LoaderCircle size={16} />
              </span>
              <Square size={14} fill="currentColor" />
              <span style={actionTextStyle}>{t('prompt.stop')}</span>
            </>
          ) : (
            <>
              <ArrowUp size={16} />
              <span style={actionTextStyle}>{t('prompt.generate')}</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

const containerStyle = (background: string, border: string, color: string): CSSProperties => ({
  borderRadius: 16,
  border: `1px solid ${border}`,
  padding: 12,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  backdropFilter: 'blur(8px)',
  background,
  color,
});

const bottomRowStyle: CSSProperties = {
  marginTop: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minWidth: 0,
};

const leftClusterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const modeLabelStyle = (textMuted: string): CSSProperties => ({
  color: textMuted,
  fontSize: 12,
  fontWeight: 500,
});

const actionButtonStyle: CSSProperties = {
  height: 36,
  minWidth: 64,
  borderRadius: 9999,
  padding: '0 12px',
  flexShrink: 0,
};

const actionTextStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
};

const spinHostStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
};

// 问题6②: 配置节点组装提示词引用文案描述区域样式
const composerDescStyle = (background: string, border: string, _textMuted: string): CSSProperties => ({
  marginBottom: 8,
  padding: '6px 10px',
  borderRadius: 8,
  border: `1px solid ${border}`,
  background,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flexShrink: 0,
});

const composerLabelStyle = (text: string): CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  color: text,
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

const composerTextStyle = (textMuted: string): CSSProperties => ({
  fontSize: 11,
  color: textMuted,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flex: 1,
});
