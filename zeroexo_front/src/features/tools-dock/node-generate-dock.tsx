/**
 * NodeGenerateDock - 吸附在选中节点正下方的生成输入面板(生成器同款 UI)
 *
 * Plan#33 生成器冗余收敛原型:不再依赖画布内独立的生成器节点,
 * 选中 text/image/video/audio 节点时,在节点正下方渲染「生成器同款」输入界面:
 * - 顶栏(navBg): 类型图标 + 类型名 + 折叠按钮
 * - 输入区: contentEditable(对齐 GeneratorPromptEditor 视觉: 透明底/占位符/字数)
 * - 底栏(navBg): 模型 Select + 参数弹层(SettingsPopoverShell) + accent 胶囊生成按钮
 *
 * 行为与底部 PromptPanel 完全一致:onPromptChange / onGenerate / onStop /
 * onConfigChange 全部转发,生成类型由宿主节点类型推导,无需选择。
 *
 * 定位:通过 useViewport 订阅视口,锚点由宿主注入的 getAnchorBounds 提供
 * (与 NodeCapsuleToolbar 同一套世界坐标→屏幕坐标换算),渲染在节点正下方。
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Text, Image, Music, Film, Sparkles, LoaderCircle, Lock,
  ChevronDown, ChevronUp, Cpu, Trash2, Upload, FileText, Check, X, Layers,
} from 'lucide-react';
import { useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeRecord } from '@zeroexo/core';
import { resolveNodeSize } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { getModelIconComponent } from '@zeroexo/shared';
import {
  GeneratorPromptEditor,
  type ReferenceItem,
  nodeActionBus,
  deriveIncomingReferences,
  referencesChanged,
  computeReferenceCompatibility,
  resolveAnyThumbUrl,
  GENERATOR_TYPE_META,
  NODE_TYPE_TO_INPUT_TYPE,
} from '@zeroexo/plugin-nodes';
import { apiGet } from '@/services/api-client.js';
import { filterChannelModelsByCapability } from '@/features/ai-config/use-ai-config-store.js';
import type { ModelCapability, ModelChannel } from '@/features/ai-config/use-ai-config-store.js';
import { getModelInputTypes } from '@/features/ai-config/utils/model-utils.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { ImageSettingsPopover } from '@/features/generator-settings/image-settings-popover.js';
import { VideoSettingsPopover } from '@/features/generator-settings/video-settings-popover.js';
import { AudioSettingsPopover } from '@/features/generator-settings/audio-settings-popover.js';

/** 生成模式(宿主节点类型映射;text 模式走文本能力) */
export type GenerationMode = 'text' | 'image' | 'video' | 'audio';

export interface NodeGenerateDockProps {
  nodeId: string;
  nodeType: 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media';
  initialPrompt?: string;
  isRunning: boolean;
  onPromptChange: (nodeId: string, prompt: string) => void;
  onGenerate: (nodeId: string, mode: GenerationMode, prompt: string, refs?: ReferenceItem[]) => void;
  onStop: (nodeId: string) => void;
  /** 生成器节点专用:当前生成模式(从 node.data.generationMode 推导) */
  configMode?: GenerationMode;
  /** 当前节点选用的模型值("channelId::model" 编码) */
  model?: string;
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  imageQuality?: string;
  imageSize?: string;
  imageCount?: number;
  videoVquality?: string;
  videoSize?: string;
  videoSeconds?: number;
  videoGenerateAudio?: boolean;
  videoWatermark?: boolean;
  videoMode?: string;
  audioVoice?: string;
  audioFormat?: string;
  audioSpeed?: number;
  audioInstructions?: string;
  /** 图形 store(订阅视口与图变化) */
  store: ReactGraphStore;
  /** 锚点包围盒(世界坐标);null 时回退 node.position + size */
  getAnchorBounds?: () => { x: number; y: number; width: number; height: number } | null;
  /** 回退锚点用节点记录 */
  node?: NodeRecord | Record<string, unknown> | null;
  /** 移动端:保留底部固定定位(避免吸附面板溢出屏幕) */
  isMobile?: boolean;
}

// ===== 类型 → 图标/名称(对齐生成器 NODE_TYPE_CONFIG) =====
const TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  text: { icon: <Text size={14} />, label: '文本' },
  image: { icon: <Image size={14} />, label: '图片' },
  video: { icon: <Film size={14} />, label: '视频' },
  audio: { icon: <Music size={14} />, label: '音频' },
  generator: { icon: <Sparkles size={14} />, label: '生成器' },
  'stacked-media': { icon: <Layers size={14} />, label: '堆叠' },
};

// 堆叠节点可切换的生成类型已移除(用户拍板:堆叠不作为生成目标,下方不显示提示词面板)

function defaultMode(nodeType: NodeGenerateDockProps['nodeType'], configMode?: GenerationMode): GenerationMode {
  if (nodeType === 'generator' || nodeType === 'stacked-media') return configMode ?? 'image';
  if (nodeType === 'text') return 'text';
  if (nodeType === 'video') return 'video';
  if (nodeType === 'audio') return 'audio';
  return 'image';
}

// capability(模型能力) 与生成模式同值,text 模式走文本能力
function modeCapability(mode: GenerationMode): ModelCapability {
  if (mode === 'image' || mode === 'video' || mode === 'audio') return mode;
  return 'text';
}

// ===== 轻量主题化 Select(内联,与生成器 StyledSelect 同款视觉) =====

interface StyledSelectOption {
  value: string;
  label: string;
  iconKey?: string;
}

function StyledSelect({
  value,
  options,
  onChange,
  minWidth = 64,
  maxWidth = 120,
  height = 26,
}: {
  value: string;
  options: StyledSelectOption[];
  onChange: (v: string) => void;
  minWidth?: number;
  maxWidth?: number;
  height?: number;
}): React.ReactElement {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const isDark = theme.mode === 'dark';
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const panels = document.querySelectorAll('[data-generator-select-panel]');
        let insidePanel = false;
        panels.forEach((panel) => { if (panel.contains(e.target as Node)) insidePanel = true; });
        if (!insidePanel) setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open]);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((prev) => !prev);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        style={{
          minWidth, maxWidth, height, padding: '0 6px',
          display: 'inline-flex', alignItems: 'center', gap: 3,
          border: 'none', borderRadius: 4, background: 'transparent',
          color: theme.toolbar.text, fontSize: 12,
          fontFamily: 'inherit', cursor: 'pointer',
          boxSizing: 'border-box', userSelect: 'none',
          transition: 'background 0.12s',
        }}
        onClick={handleOpen}
        onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        title={selected?.label}
      >
        {selected?.iconKey ? (
          <span style={{ flexShrink: 0, display: 'inline-flex' }}>
            {React.createElement(getModelIconComponent(selected.iconKey), { size: 12 })}
          </span>
        ) : null}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {selected?.label ?? options[0]?.label ?? ''}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {open && dropdownPos && createPortal(
        <div
          data-generator-select-panel="true"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 9999,
            minWidth: Math.max(minWidth, 120),
            background: theme.toolbar.panel,
            border: `1px solid ${theme.toolbar.border}`,
            borderRadius: 8,
            boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
            padding: 4,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {options.map((opt) => {
            const IconComponent = opt.iconKey ? getModelIconComponent(opt.iconKey) : null;
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                style={{
                  padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  color: theme.toolbar.text,
                  background: isSelected ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : 'transparent',
                  whiteSpace: 'nowrap',
                  borderRadius: 4,
                  transition: 'background 0.1s',
                  maxWidth: 240,
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = hoverBg; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
                title={opt.label}
              >
                {IconComponent ? (
                  <span style={{ flexShrink: 0, display: 'inline-flex' }}>
                    {React.createElement(IconComponent, { size: 12 })}
                  </span>
                ) : <Cpu size={12} style={{ flexShrink: 0, opacity: 0.6 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {opt.label}
                </span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ===== 卡片外观 tokens(主页创意简报 AiInputBar variant="elevated" 同款:无边框+圆角卡片) =====
const DOCK_CARD_RADIUS = 24;

/** NodeGenerateDock 展开态屏幕高度(供聚焦补偿 focusOnNode 使用) */
export const NODE_DOCK_SCREEN_HEIGHT = 240;

// ===== 呼吸动画关键帧(主页 AiInputBar zeroexo-ripple 同款) =====
const dockRippleKeyframes = `
@keyframes zeroexo-ripple {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
`;

// ===== 参考素材区(memo 隔离:提示词输入/视口变化时不重渲染) =====
const DockReferencesSection = memo(function DockReferencesSection({
  nodeId,
  incomingNodes,
  refUrlMap,
  nodeCompatibility,
  onRemoveIncoming,
}: {
  nodeId: string;
  incomingNodes: Array<{ id: string; type: string; title: string; content?: string; storageKey?: string }>;
  refUrlMap: Record<string, string>;
  nodeCompatibility: Record<string, boolean>;
  onRemoveIncoming: (sourceNodeId: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const navBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const bgHover = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleAddReference = useCallback(() => { fileInputRef.current?.click(); }, []);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      const base = { nodeId, title: uploaded.title.replace(/\.[^.]+$/, '') };
      if (d.kind === 'text') {
        nodeActionBus.emit('nodeDock:addReferenceNode', { ...base, kind: 'text', content: d.content });
      } else {
        nodeActionBus.emit('nodeDock:addReferenceNode', {
          ...base,
          kind: d.kind,
          storageKey: d.storageKey,
          content: d.kind === 'image' ? d.dataUrl : d.url,
        });
      }
    } catch {
      // 上传失败静默(不打断当前编辑)
    }
  }, [nodeId]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {/* 上传按钮(吸附面板内常显) */}
      <button
        type="button"
        onClick={handleAddReference}
        style={{
          width: 48, height: 48, borderRadius: 14,
          border: `1px dashed ${navBorder}`,
          background: 'transparent', color: theme.toolbar.textMuted ?? '',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, transition: 'background 0.12s',
        }}
        title={t('nodeDock.uploadRef', '上传参考素材(支持图片/视频/文本)')}
        onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Upload size={15} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,.txt,.md,.docx,.pdf"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {incomingNodes.map((n) => {
        const config = TYPE_META[n.type] ?? { icon: <FileText size={14} />, label: n.type };
        const isCompatible = nodeCompatibility[n.id] ?? true;
        const url = refUrlMap[n.id] || (n.type === 'image' ? n.content : undefined);
        const hasThumb = !!url;
        return (
          <div
            key={n.id}
            style={{
              position: 'relative', width: 48, height: 48, borderRadius: 14,
              overflow: 'hidden', flexShrink: 0, border: `1px solid ${navBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: hasThumb ? 'transparent' : bgHover, cursor: 'default',
            }}
            title={`${config.label}: ${n.title}`}
          >
            {hasThumb ? (
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, width: '100%' }}>
                <span style={{ flexShrink: 0, display: 'inline-flex', opacity: 0.7 }}>{config.icon}</span>
                <span style={{ fontSize: 10, color: theme.toolbar.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 40, textAlign: 'center', lineHeight: 1.2 }}>
                  {n.title}
                </span>
              </div>
            )}
            {/* 兼容性指示(蓝勾/红叉,与生成器一致) */}
            <div style={{
              position: 'absolute', top: 2, left: 2, width: 12, height: 12,
              borderRadius: '50%', background: isCompatible ? '#3b82f6' : '#ef4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
            }}>
              {isCompatible
                ? <Check size={7} color="#fff" strokeWidth={3} />
                : <X size={7} color="#fff" strokeWidth={3} />}
            </div>
            {/* 删除按钮(方块样式,与生成器一致) */}
            <button
              type="button"
              onClick={() => onRemoveIncoming(n.id)}
              style={{
                position: 'absolute', top: 2, right: 2, width: 12, height: 12,
                borderRadius: 4, background: '#ff4d4f', color: '#fff', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, zIndex: 2, opacity: 0.85, transition: 'opacity 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            >
              <Trash2 size={7} />
            </button>
          </div>
        );
      })}

      {incomingNodes.length === 0 && (
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted ?? '', flexShrink: 0 }}>
          {t('nodeDock.refHint', '拖入节点连入参考,或点击上传素材')}
        </span>
      )}
    </div>
  );
});

// ===== 输入区(memo 隔离:仅 value/引用变化时重渲染,参考区与底栏不受打字影响) =====
const DockInputSection = memo(function DockInputSection({
  value,
  onChange,
  references,
  placeholder,
  mentionTypeFilter,
}: {
  value: string;
  onChange: (value: string) => void;
  references: ReferenceItem[];
  placeholder: string;
  mentionTypeFilter?: (ref: ReferenceItem) => boolean;
}) {
  const { theme } = useTheme();
  // @ 弹窗主题色:亮色白底/暗色 toolbar.panel(不依赖 textColor 亮度推断,暗色主题下 textColor 是亮色会误判)
  const isDark = theme.mode === 'dark';
  const popupBg = isDark ? (theme.toolbar.panel ?? '#26262b') : '#ffffff';
  const popupBorder = isDark ? (theme.toolbar.border ?? 'rgba(255,255,255,0.14)') : '#e7e5e4';
  return (
    <>
      <GeneratorPromptEditor
        value={value}
        onChange={onChange}
        references={references}
        readOnly={false}
        placeholder={placeholder}
        textColor={theme.toolbar.text}
        accentColor={theme.toolbar.accent}
        fontSize={13}
        lineHeight={1.7}
        minHeight={96}
        mentionTypeFilter={mentionTypeFilter}
        popupBackground={popupBg}
        popupBorderColor={popupBorder}
      />
      <div style={{ fontSize: 10, color: theme.toolbar.textMuted ?? '', pointerEvents: 'none', textAlign: 'right', lineHeight: 1 }}>
        {value.length} 字
      </div>
    </>
  );
});

// ===== 底栏(memo 隔离:模型/参数/生成按钮;hasText 布尔化避免逐字重渲染) =====
const DockFooterBar = memo(function DockFooterBar({
  nodeId,
  mode,
  model,
  modelOptions,
  isRunning,
  hasText,
  interruptible = true,
  onAction,
  onConfigChange,
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
}: {
  nodeId: string;
  mode: GenerationMode;
  model: string;
  modelOptions: StyledSelectOption[];
  isRunning: boolean;
  hasText: boolean;
  /** 生成中是否可打断(文本可打断=停止按钮;媒体不可打断=锁徽标) */
  interruptible?: boolean;
  onAction: () => void;
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  imageQuality?: string;
  imageSize?: string;
  imageCount?: number;
  videoVquality?: string;
  videoSize?: string;
  videoSeconds?: number;
  videoGenerateAudio?: boolean;
  videoWatermark?: boolean;
  videoMode?: string;
  audioVoice?: string;
  audioFormat?: string;
  audioSpeed?: number;
  audioInstructions?: string;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const spinRef = useRef<HTMLSpanElement>(null);
  const actionDisabled = !isRunning && !hasText;

  // LoaderCircle 旋转动画(Web Animations API 自包含)
  useEffect(() => {
    const el = spinRef.current;
    if (!el || !isRunning) return;
    const anim = el.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 1000, iterations: Infinity },
    );
    return () => anim.cancel();
  }, [isRunning]);

  return (
    <>
      {/* 模型 Select(生成器同款) */}
      <StyledSelect
        value={model}
        options={modelOptions}
        onChange={(m) => onConfigChange?.(nodeId, { model: m })}
        minWidth={120}
        maxWidth={180}
        height={26}
      />

      {/* 参数弹层(SettingsPopoverShell 同款,读写 node.data 字段契约不变) */}
      {onConfigChange && mode === 'image' && modelOptions.length > 0 ? (
        <ImageSettingsPopover
          model={model}
          quality={imageQuality ?? 'auto'}
          size={imageSize ?? 'auto'}
          count={imageCount ?? 1}
          theme={theme}
          onChange={(patch) => onConfigChange(nodeId, patch)}
        />
      ) : null}
      {onConfigChange && mode === 'video' && modelOptions.length > 0 ? (
        <VideoSettingsPopover
          model={model}
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
      {onConfigChange && mode === 'audio' && modelOptions.length > 0 ? (
        <AudioSettingsPopover
          model={model}
          voice={audioVoice ?? 'alloy'}
          format={audioFormat ?? 'mp3'}
          speed={audioSpeed ?? 1}
          instructions={audioInstructions}
          theme={theme}
          onChange={(patch) => onConfigChange(nodeId, patch)}
        />
      ) : null}
      {/* 未配置模型:直接不显示(用户拍板:不展示跳转入口,避免误导) */}

      <div style={{ flex: 1 }} />

      {isRunning && !interruptible ? (
        /* 媒体类生成中:不可打断(拍板 2026-08-23 R3 D2)——锁徽标替代停止按钮,进度由 agent 消息流步骤卡承载 */
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 36, padding: '0 12px', borderRadius: 18, flexShrink: 0,
            background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            color: theme.toolbar.textMuted ?? '',
            fontSize: 12, fontWeight: 500, userSelect: 'none',
          }}
          title={t('nodeDock.lockedGenerating', '媒体生成提交后不可取消,请稍候')}
        >
          <Lock size={13} style={{ flexShrink: 0 }} />
          {t('nodeDock.lockedGenerating', '生成中，不可取消')}
        </span>
      ) : (
        /* 生成按钮(主页 AiInputBar 同款:圆形 accent + zeroexo-ripple 呼吸动画;文本生成中保留停止按钮=可打断) */
        <>
          <style>{dockRippleKeyframes}</style>
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            aria-label={isRunning ? t('prompt.stop', '停止') : t('prompt.generate', '生成')}
            title={isRunning ? t('prompt.stop', '停止') : t('prompt.generate', '生成')}
            style={{
              width: 36, height: 36, flexShrink: 0,
              borderRadius: '50%',
              border: '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0,
              background: actionDisabled
                ? (isDark ? '#262626' : '#e5e5e5')
                : isRunning ? (theme.toolbar.danger ?? '#dc2626') : theme.toolbar.accent,
              color: actionDisabled ? (isDark ? '#666' : '#999') : '#fff',
              cursor: actionDisabled ? 'not-allowed' : 'pointer',
              boxShadow: actionDisabled
                ? 'none'
                : `0 4px 12px ${(isRunning ? (theme.toolbar.danger ?? '#dc2626') : theme.toolbar.accent)}40`,
              transition: 'all .2s',
              animation: actionDisabled ? 'none' : 'zeroexo-ripple 3s ease-in-out infinite',
              fontFamily: 'inherit',
            }}
          >
            {isRunning ? (
              <span ref={spinRef} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <LoaderCircle size={16} />
              </span>
            ) : (
              <Sparkles size={16} />
            )}
          </button>
        </>
      )}
    </>
  );
});

// ===== NodeGenerateDock =====

export function NodeGenerateDock({
  nodeId,
  nodeType,
  initialPrompt = '',
  isRunning,
  onPromptChange,
  onGenerate,
  onStop,
  configMode,
  model,
  onConfigChange,
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
  store,
  getAnchorBounds,
  node,
  isMobile = false,
}: NodeGenerateDockProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  // 生成类型由宿主节点类型推导(堆叠不作为生成目标,见下方 return null)
  const mode: GenerationMode = defaultMode(nodeType, configMode);
  const [prompt, setPrompt] = useState(initialPrompt.trim());
  const [collapsed, setCollapsed] = useState(false);

  // 订阅视口(锚点换算依赖 viewport scale/offset;图变化由 getAnchorBounds 回调驱动)
  const viewport = useViewport(store);

  // 拖拽期间隐藏(tA9):移动节点时吸附面板每帧跟随重算消耗大,改为拖动期间整体隐藏,
  // 移动结束(setDragOffsets 清空)再显示 —— 剔除移动时的大量计算消耗
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (!store.subscribeDragOffsets) return;
    return store.subscribeDragOffsets(() => {
      const offsets = store.getDragOffsets();
      setIsDragging(!!offsets && offsets.size > 0);
    });
  }, [store]);

  // ===== 渠道/模型选项(与生成器一致:后端加载 + 按能力筛选) =====
  const [channels, setChannels] = useState<ModelChannel[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: Array<{
      id: string; name: string; provider: string; baseUrl: string;
      apiFormat: string; modelIcons?: Record<string, string>;
      models: Array<{ name: string; capabilities?: string[] }>;
    }> }>('/ai/channels')
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        setChannels(items.map((item) => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
          baseUrl: item.baseUrl,
          apiKey: '',
          apiFormat: (item.apiFormat as 'openai' | 'gemini') || 'openai',
          models: Array.isArray(item.models) ? item.models.map((m) => m.name) : [],
          modelConfigs: Array.isArray(item.models) ? item.models.map((m) => ({
            name: m.name,
            capabilities: m.capabilities ?? [],
          })) : undefined,
          modelIcons: item.modelIcons || {},
        })));
      })
      .catch(() => { if (!cancelled) setChannels([]); });
    return () => { cancelled = true; };
  }, []);

  const modelOptions = useMemo(() => {
    const encoded = filterChannelModelsByCapability(channels, modeCapability(mode));
    return encoded.map((enc) => {
      const parts = enc.split('::');
      const modelName = parts[1] ?? enc;
      const ch = channels.find((c) => c.id === parts[0]);
      const iconKey = ch?.modelIcons?.[modelName] || ch?.provider || undefined;
      return { value: enc, label: ch ? `${modelName}(${ch.name})` : modelName, iconKey };
    });
  }, [channels, mode]);

  // ===== 连入参考素材(复用生成器 deriveIncomingReferences 归一化) =====
  const [graphVersion, setGraphVersion] = useState(0);
  useEffect(() => {
    const unsub = store.subscribeGraph(() => setGraphVersion((v) => v + 1));
    return unsub;
  }, [store]);

  const incomingNodesRaw = useMemo(() => {
    const graph = store.getGraph();
    const incoming = graph.edges
      .filter((e) => e.target.nodeId === nodeId)
      .flatMap((e) => {
        const srcNode = graph.nodes.find((n) => n.id === e.source.nodeId);
        if (!srcNode) return [];
        const d = (srcNode.data ?? {}) as Record<string, unknown>;
        // 堆叠节点保持整体条目(不展开成卡片:展开会导致 @ 列表 20+ 条目截断选不到;
        // 整体语义 = 堆叠所有卡片作为整体参考素材,与 stacked-media 输出契约一致)
        if (srcNode.type === 'stacked-media') {
          const cards = (d.cards as Array<{ id: string; sourceType: string; title?: string; data?: Record<string, unknown> }> | undefined) ?? [];
          return [{
            id: srcNode.id,
            type: 'stacked-media',
            content: undefined,
            storageKey: undefined,
            title: `${srcNode.title || srcNode.id.slice(0, 8)}(${cards.length})`,
          }];
        }
        return [{
          id: srcNode.id,
          type: srcNode.type,
          content: typeof d.content === 'string' ? d.content : undefined,
          storageKey: typeof d.storageKey === 'string' ? d.storageKey : undefined,
          title: (srcNode.title || (typeof d.title === 'string' ? d.title : undefined) || srcNode.type) as string,
        }];
      });
    return deriveIncomingReferences(incoming);
  }, [store, nodeId, graphVersion]);

  // 稳定化引用(隔离 graphVersion 高频变化导致的无意义重渲染)
  const incomingNodesRef = useRef(incomingNodesRaw);
  const [incomingNodes, setIncomingNodes] = useState(incomingNodesRaw);
  useEffect(() => {
    const prev = incomingNodesRef.current;
    if (!referencesChanged(prev, incomingNodesRaw)) return;
    incomingNodesRef.current = incomingNodesRaw;
    setIncomingNodes(incomingNodesRaw);
  }, [incomingNodesRaw]);

  // 当前模型支持的输入类型(兼容性计算,与生成器一致)
  const currentModelValue = model ?? '';
  const supportedInputTypes = useMemo(() => {
    if (!currentModelValue) return ['text'];
    return getModelInputTypes(channels, currentModelValue);
  }, [channels, currentModelValue]);

  // 每个连入节点与当前模型的兼容性(蓝勾/红叉)
  const nodeCompatibility = useMemo(() => {
    return computeReferenceCompatibility(incomingNodes, {
      hasModelSelected: !!currentModelValue,
      supportedInputTypes,
      generationMode: mode,
    });
  }, [incomingNodes, supportedInputTypes, currentModelValue, mode]);

  // 连入参考素材缩略图(异步解析 storageKey → thumb 级 URL,与生成器 refUrlMap 同链)
  // 堆叠整体条目无图;展开卡片(id 为 `${nodeId}::${cardId}`)也在此解析,供 @ 列表展示
  const [refUrlMap, setRefUrlMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(incomingNodes.map(async (n) => {
        if ((n.type === 'image' || n.type === 'video') && n.storageKey) {
          try {
            const u = await resolveAnyThumbUrl(n.storageKey);
            if (u) next[n.id] = u;
          } catch { /* 无缩略图回退内容直链 */ }
        } else if (n.type === 'stacked-media') {
          // 堆叠:展开解析各卡片缩略图(@ 列表与参考区展示用)
          const graph = store.getGraph();
          const src = graph.nodes.find((g) => g.id === n.id);
          const cards = ((src?.data as { cards?: Array<{ id: string; sourceType: string; data?: Record<string, unknown> }> } | undefined)?.cards) ?? [];
          for (const card of cards) {
            const key = `${n.id}::${card.id}`;
            const st = typeof card.data?.storageKey === 'string' ? card.data.storageKey : undefined;
            if (st) {
              try {
                const u = await resolveAnyThumbUrl(st);
                if (u) { next[key] = u; continue; }
              } catch { /* 回退 content 直链 */ }
            }
            const ct = typeof card.data?.content === 'string' ? card.data.content : undefined;
            if (ct && (card.sourceType === 'image' || card.sourceType === 'video')) next[key] = ct;
          }
        }
      }));
      if (!cancelled) setRefUrlMap(next);
    })();
    return () => { cancelled = true; };
  }, [incomingNodes, store]);

  // @ 引用列表(与生成器 GeneratorPromptEditor 的 references 契约一致)
  // 堆叠在此展开为具体卡片条目:只有明确 @ 到支持类型的卡片才会作为 API 资产源输入;
  // 参考列表区(DockReferencesSection)仍显示堆叠整体图标,两者分离
  const references: ReferenceItem[] = useMemo(() => {
    const graph = store.getGraph();
    const out: ReferenceItem[] = [];
    for (const n of incomingNodes) {
      if (n.type === 'stacked-media') {
        const src = graph.nodes.find((g) => g.id === n.id);
        const cards = ((src?.data as { cards?: Array<{ id: string; sourceType: string; title?: string; data?: Record<string, unknown> }> } | undefined)?.cards) ?? [];
        for (const card of cards) {
          out.push({
            id: `${n.id}::${card.id}`,
            type: (card.sourceType as ReferenceItem['type']) ?? 'text',
            name: card.title || card.sourceType || src?.title || n.id.slice(0, 8),
            url: refUrlMap[`${n.id}::${card.id}`] || (typeof card.data?.content === 'string' ? card.data.content : undefined),
            asset: {
              content: typeof card.data?.content === 'string' ? card.data.content : undefined,
              storageKey: typeof card.data?.storageKey === 'string' ? card.data.storageKey : undefined,
            },
          });
        }
      } else {
        out.push({
          id: n.id,
          type: (n.type as ReferenceItem['type']) ?? 'text',
          name: n.title || n.id.slice(0, 8),
          url: refUrlMap[n.id] || (n.type === 'image' ? n.content : undefined) || undefined,
          asset: { content: n.content, storageKey: n.storageKey },
        });
      }
    }
    return out;
  }, [incomingNodes, refUrlMap, store]);

  // 断开连入节点连线(移除参考素材)
  const handleRemoveIncoming = useCallback((sourceNodeId: string) => {
    nodeActionBus.emit('nodeDock:removeConnection', { nodeId, sourceNodeId });
  }, [nodeId]);

  // @ 引用类型过滤:按当前生成类型过滤支持媒体;文本/剧本等恒可作为提示参考
  const mentionTypeFilter = useCallback((r: ReferenceItem): boolean => {
    const inputType = NODE_TYPE_TO_INPUT_TYPE[r.type] ?? 'text';
    if (inputType === 'text') return true;
    return (GENERATOR_TYPE_META[mode]?.supportedInputs ?? []).includes(inputType);
  }, [mode]);

  // nodeId 切换时以该节点已保存的 prompt 为初始值;
  // 不依赖 initialPrompt 变化:编辑期间的父级回写(存储/云同步)不得重置正在编辑的输入,
  // 否则 value 被旧纯文本覆盖 → GeneratorPromptEditor 初始化会重写 innerText 摧毁 @badge
  useEffect(() => {
    // 重置为节点已保存的 prompt(trim 掉边界空白,避免未生成仅编辑时残留尾部换行产生空行)
    setPrompt(initialPrompt.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // prompt 最新值 ref(保证 submit 闭包稳定,不随逐字输入重建 → 底栏 memo 生效)
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  const updatePrompt = useCallback(
    (value: string) => {
      setPrompt(value);
      onPromptChange(nodeId, value);
    },
    [onPromptChange, nodeId],
  );

  const submit = useCallback(() => {
    const text = promptRef.current.trim();
    if (!text || isRunning) return;
    // 解析 @ 选中引用:badge 文本化为 "@名称",按名称匹配 references;
    // 明确 @ 到的引用(含堆叠展开卡片)作为 API 资产源输入传给生成
    const mentioned = references.filter((r) => text.includes(`@${r.name}`));
    onGenerate(nodeId, mode, text, mentioned);
    setPrompt('');
    promptRef.current = '';
  }, [isRunning, onGenerate, nodeId, mode, references]);

  const handleAction = useCallback(() => {
    if (isRunning) onStop(nodeId);
    else submit();
  }, [isRunning, onStop, nodeId, submit]);

  const typeMeta = TYPE_META[nodeType] ?? TYPE_META.generator!;

  // 堆叠节点:资源浏览器语义,不作为生成目标(用户拍板:下方不显示提示词面板,
  // 堆叠只作为上游参考输入,具体卡片经 @ 在生成节点面板中引用)
  if (nodeType === 'stacked-media') return null;

  // ===== 吸附定位(世界坐标 → 屏幕坐标,对齐 NodeCapsuleToolbar) =====
  const liveBounds = getAnchorBounds ? getAnchorBounds() : null;
  const fallbackNode = node as NodeRecord | null | undefined;
  const size = resolveNodeSize(fallbackNode ?? {}, undefined);
  const boundsX = liveBounds?.x ?? fallbackNode?.position.x ?? 0;
  const boundsY = liveBounds?.y ?? fallbackNode?.position.y ?? 0;
  const boundsW = liveBounds?.width ?? size.width;
  const boundsH = liveBounds?.height ?? size.height;
  const centerX = boundsX * viewport.k + viewport.x + (boundsW * viewport.k) / 2;
  const bottomY = (boundsY + boundsH) * viewport.k + viewport.y + 8;

  // ===== 卡片配色(主页创意简报 AiInputBar variant="elevated" 同款;
  //      用户反馈:去除分区分层色块,整体单色自然融合) =====
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const cardStyle: CSSProperties = {
    width: '100%',
    position: 'relative',
    borderRadius: DOCK_CARD_RADIUS,
    background: theme.toolbar.panel ?? (isDark ? '#1e1e20' : '#fafaf7'),
    boxShadow: prompt.trim()
      ? `inset 0 0 0 1px ${accent}22, 0 8px 32px rgba(0,0,0,0.08)`
      : '0 8px 32px rgba(0,0,0,0.08)',
    transition: 'all .25s',
    color: theme.toolbar.text,
  };
  // 内部分区:不加色块背景(整体单色),仅用间距自然分隔
  const sectionStyle: CSSProperties = {
    margin: '0 10px',
    padding: '10px 14px',
  };
  const hasText = prompt.trim().length > 0;

  // 拖动中隐藏(移动结束恢复):剔除移动时每帧跟随计算消耗
  if (isDragging) return null;

  // 折叠态:仅显示顶栏细条(同款无边框圆角卡片风)
  if (collapsed) {
    return (
      <div
        style={isMobile ? mobileWrapStyle : {
          position: 'absolute', left: centerX, top: bottomY, transform: 'translateX(-50%)',
          zIndex: 48, width: 220,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', borderRadius: DOCK_CARD_RADIUS,
          background: theme.toolbar.panel ?? (isDark ? '#1e1e20' : '#fafaf7'),
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          color: theme.toolbar.text, fontSize: 12, cursor: 'pointer',
          userSelect: 'none',
        }}
          onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}
          title={t('nodeDock.expand', '展开生成面板')}
        >
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>{typeMeta.icon}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {typeMeta.label} · {t('nodeDock.generate', '生成')}
          </span>
          <ChevronUp size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={isMobile ? mobileWrapStyle : {
        position: 'absolute', left: centerX, top: bottomY, transform: 'translateX(-50%)',
        zIndex: 48, width: 720, maxWidth: 'calc(100vw - 24px)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 无边框圆角卡片(主页创意简报 elevated 同款:整体单色 + 柔和阴影) */}
      <div style={cardStyle}>
      {/* 收起按钮(右上角小图标,替代原标题行折叠入口,节省空间) */}
      <button
        type="button"
        title={t('nodeDock.collapse', '收起')}
        onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 2,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, border: 'none', borderRadius: 8,
          background: 'transparent', color: theme.toolbar.text, cursor: 'pointer',
          padding: 0, transition: 'opacity 0.12s',
          opacity: 0.45,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.45'; }}
      >
        <ChevronDown size={13} />
      </button>

      {/* 参考素材区(单色融入;memo 隔离) */}
      <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DockReferencesSection
          nodeId={nodeId}
          incomingNodes={incomingNodes}
          refUrlMap={refUrlMap}
          nodeCompatibility={nodeCompatibility}
          onRemoveIncoming={handleRemoveIncoming}
        />
      </div>

      {/* 输入区(生成器同款 @ 引用 contentEditable;memo 隔离) */}
      <div style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
        <DockInputSection
          value={prompt}
          onChange={updatePrompt}
          references={references}
          placeholder={t('nodeDock.placeholder', '输入提示词... (输入 @ 引用素材)')}
          mentionTypeFilter={mentionTypeFilter}
        />
      </div>

      {/* 底栏(卡片内操作行;memo 隔离 + hasText 布尔化) */}
      <div style={{ ...sectionStyle, margin: '0 10px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DockFooterBar
          nodeId={nodeId}
          mode={mode}
          model={model ?? ''}
          modelOptions={modelOptions}
          isRunning={isRunning}
          hasText={hasText}
          interruptible={mode === 'text'}
          onAction={handleAction}
          onConfigChange={onConfigChange}
          imageQuality={imageQuality}
          imageSize={imageSize}
          imageCount={imageCount}
          videoVquality={videoVquality}
          videoSize={videoSize}
          videoSeconds={videoSeconds}
          videoGenerateAudio={videoGenerateAudio}
          videoWatermark={videoWatermark}
          videoMode={videoMode}
          audioVoice={audioVoice}
          audioFormat={audioFormat}
          audioSpeed={audioSpeed}
          audioInstructions={audioInstructions}
        />
      </div>
      </div>
    </div>
  );
}

// 移动端:保留底部固定定位(原 mobilePromptPanelWrapStyle 行为)
const mobileWrapStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 60px)',
  left: 12, right: 12,
  zIndex: 48,
};
