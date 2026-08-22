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
  Text, Image, Music, Film, Sparkles, LoaderCircle, Square,
  ChevronDown, ChevronUp, Cpu, Trash2, Upload, FileText, Check, X,
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
  nodeType: 'text' | 'image' | 'video' | 'audio' | 'generator';
  initialPrompt?: string;
  isRunning: boolean;
  onPromptChange: (nodeId: string, prompt: string) => void;
  onGenerate: (nodeId: string, mode: GenerationMode, prompt: string) => void;
  onStop: (nodeId: string) => void;
  /** 生成器节点专用:当前生成模式(从 node.data.generationMode 推导) */
  configMode?: GenerationMode;
  /** 当前节点选用的模型值("channelId::model" 编码) */
  model?: string;
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  /** 打开 AI 渠道设置 */
  onOpenAiConfig?: () => void;
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
};

function defaultMode(nodeType: NodeGenerateDockProps['nodeType'], configMode?: GenerationMode): GenerationMode {
  if (nodeType === 'generator') return configMode ?? 'image';
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
}: {
  value: string;
  onChange: (value: string) => void;
  references: ReferenceItem[];
  placeholder: string;
}) {
  const { theme } = useTheme();
  return (
    <>
      <GeneratorPromptEditor
        value={value}
        onChange={onChange}
        references={references}
        readOnly={false}
        placeholder={placeholder}
        textColor={theme.toolbar.text}
        backgroundColor="transparent"
        accentColor={theme.toolbar.accent}
        fontSize={12}
        lineHeight={1.6}
        minHeight={44}
        borderColor={theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)'}
        borderHoverColor={theme.toolbar.accent}
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
  onAction,
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
}: {
  nodeId: string;
  mode: GenerationMode;
  model: string;
  modelOptions: StyledSelectOption[];
  isRunning: boolean;
  hasText: boolean;
  onAction: () => void;
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  onOpenAiConfig?: () => void;
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
  const navBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
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
      {modelOptions.length === 0 && onOpenAiConfig ? (
        <button
          type="button"
          onClick={onOpenAiConfig}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, padding: '4px 8px', borderRadius: 8,
            border: `1px solid ${navBorder}`, background: 'transparent',
            color: theme.toolbar.textMuted ?? '', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Cpu size={12} />
          <span>{t('nodeDock.noModel', '未配置模型,前往设置')}</span>
        </button>
      ) : null}

      <div style={{ flex: 1 }} />

      {/* 生成按钮(accent 胶囊,与生成器一致) */}
      <button
        type="button"
        onClick={onAction}
        disabled={actionDisabled}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, padding: '5px 14px', borderRadius: 9999,
          border: 'none', cursor: actionDisabled ? 'not-allowed' : 'pointer',
          background: actionDisabled
            ? (isDark ? '#333' : '#e5e5e5')
            : isRunning ? (theme.toolbar.danger ?? '#dc2626') : theme.toolbar.accent,
          color: actionDisabled ? (isDark ? '#666' : '#999') : '#fff',
          fontFamily: 'inherit', fontWeight: 500,
          transition: 'opacity 0.15s',
          opacity: actionDisabled ? 0.5 : 1,
        }}
      >
        {isRunning ? (
          <>
            <span ref={spinRef} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <LoaderCircle size={14} />
            </span>
            <Square size={12} fill="currentColor" />
            <span>{t('prompt.stop', '停止')}</span>
          </>
        ) : (
          <>
            <Sparkles size={14} />
            <span>{t('prompt.generate', '生成')}</span>
          </>
        )}
      </button>
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
  store,
  getAnchorBounds,
  node,
  isMobile = false,
}: NodeGenerateDockProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const mode = defaultMode(nodeType, configMode);
  const [prompt, setPrompt] = useState(initialPrompt);
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
      .map((e) => {
        const srcNode = graph.nodes.find((n) => n.id === e.source.nodeId);
        if (!srcNode) return null;
        const d = (srcNode.data ?? {}) as Record<string, unknown>;
        return {
          id: srcNode.id,
          type: srcNode.type,
          content: typeof d.content === 'string' ? d.content : undefined,
          storageKey: typeof d.storageKey === 'string' ? d.storageKey : undefined,
          title: (srcNode.title || (typeof d.title === 'string' ? d.title : undefined) || srcNode.type) as string,
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);
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
        }
      }));
      if (!cancelled) setRefUrlMap(next);
    })();
    return () => { cancelled = true; };
  }, [incomingNodes]);

  // @ 引用列表(与生成器 GeneratorPromptEditor 的 references 契约一致)
  const references: ReferenceItem[] = useMemo(() => {
    return incomingNodes.map((n) => ({
      id: n.id,
      type: (n.type as ReferenceItem['type']) ?? 'text',
      name: n.title || n.id.slice(0, 8),
      url: refUrlMap[n.id] || (n.type === 'image' ? n.content : undefined) || undefined,
    }));
  }, [incomingNodes, refUrlMap]);

  // 断开连入节点连线(移除参考素材)
  const handleRemoveIncoming = useCallback((sourceNodeId: string) => {
    nodeActionBus.emit('nodeDock:removeConnection', { nodeId, sourceNodeId });
  }, [nodeId]);

  // initialPrompt 变化时同步(nodeId 切换)
  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt, nodeId]);

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
    onGenerate(nodeId, mode, text);
    setPrompt('');
    promptRef.current = '';
  }, [isRunning, onGenerate, nodeId, mode]);

  const handleAction = useCallback(() => {
    if (isRunning) onStop(nodeId);
    else submit();
  }, [isRunning, onStop, nodeId, submit]);

  const typeMeta = TYPE_META[nodeType] ?? TYPE_META.generator!;

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

  // ===== 卡片配色(主页创意简报 AiInputBar variant="elevated" 同款;tA9 去磨砂/去内部边线,
  //      改剧本节点同款分层颜色区分区块) =====
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const bgHover = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)';
  // 分区分层色(代替原 sectionDivider 边线):与剧本节点 triggerBackground 分层一致
  const sectionBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)';
  const cardStyle: CSSProperties = {
    width: '100%',
    borderRadius: DOCK_CARD_RADIUS,
    background: theme.toolbar.panel ?? (isDark ? '#1e1e20' : '#fafaf7'),
    boxShadow: prompt.trim()
      ? `inset 0 0 0 1px ${accent}22, 0 8px 32px rgba(0,0,0,0.08)`
      : '0 8px 32px rgba(0,0,0,0.08)',
    transition: 'all .25s',
    color: theme.toolbar.text,
  };
  const sectionStyle: CSSProperties = {
    margin: '0 8px 6px',
    padding: '8px 12px',
    background: sectionBg,
    borderRadius: 10,
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
      {/* 无边框圆角卡片(主页创意简报 elevated 同款:半透明分层背景 + blur + 柔和阴影) */}
      <div style={cardStyle}>
      {/* 卡片头(无边框卡片内轻量标题行) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '10px 14px',
        color: theme.toolbar.text, fontSize: 12, fontWeight: 500,
        userSelect: 'none',
      }}>
        <span style={{ display: 'inline-flex', flexShrink: 0, color: accent }}>{typeMeta.icon}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {typeMeta.label} · {t('nodeDock.generate', '生成')}
        </span>
        <button
          type="button"
          title={t('nodeDock.collapse', '收起')}
          onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, border: 'none', borderRadius: 8,
            background: 'transparent', color: theme.toolbar.text, cursor: 'pointer',
            padding: 0, transition: 'background 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* 参考素材区(卡片内分层色块;memo 隔离) */}
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
        />
      </div>

      {/* 底栏(卡片内操作行;memo 隔离 + hasText 布尔化) */}
      <div style={{ ...sectionStyle, margin: '0 8px 8px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DockFooterBar
          nodeId={nodeId}
          mode={mode}
          model={model ?? ''}
          modelOptions={modelOptions}
          isRunning={isRunning}
          hasText={hasText}
          onAction={handleAction}
          onConfigChange={onConfigChange}
          onOpenAiConfig={onOpenAiConfig}
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
