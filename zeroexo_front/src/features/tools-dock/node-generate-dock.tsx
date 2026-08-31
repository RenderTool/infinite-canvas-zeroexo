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
  ChevronDown, ChevronUp, Cpu, Upload, FileText, Check, X, Layers,
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
import { DynamicParamForm, type ChannelConstraints } from '@/features/generator-settings/dynamic-param-form.js';
import { useReadOnly } from '@/shared/readonly-context.js';
import type { WorkbenchShotReference } from '@/features/canvas-nodes/storyboard/workbench-types.js';

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
  /** 契约参数模块:当前模板参数值(存 node.data.paramValues) */
  paramValues?: Record<string, any>;
  /** 图形 store(订阅视口与图变化) */
  store: ReactGraphStore;
  /** 锚点包围盒(世界坐标);null 时回退 node.position + size */
  getAnchorBounds?: () => { x: number; y: number; width: number; height: number } | null;
  /** 回退锚点用节点记录 */
  node?: NodeRecord | Record<string, unknown> | null;
  /** 移动端:保留底部固定定位(避免吸附面板溢出屏幕) */
  isMobile?: boolean;
  /** 内联模式(不 portal 到画布,作为普通流内卡片渲染在宿主面板内容下方,避免依赖画布浮层定位) */
  inline?: boolean;
  /**
   * 卡片圆角(默认 DOCK_CARD_RADIUS=24,画布节点吸附面板保持原样)
   * 2026-08-31 用户拍板:分镜生产台底部提示词栏复用本 dock 时传 0(不要圆角)
   */
  radius?: number;
  /** 初始是否收起(默认 true = 画布节点吸附面板同款「细条」;内嵌常驻面板传 false 直接展开) */
  defaultCollapsed?: boolean;
  /** 容器样式(仅 inline 内嵌模式生效,供宿主按固定高度/最小高度直接布局,无需再包一层 div) */
  style?: CSSProperties;
  /**
   * 适配固定高度容器(内嵌常驻面板,如出片工作台底部提示词区):
   * 参考素材区与底栏(模型/参数/生成)固定可见,仅文本输入区弹性可压缩滚动。
   * 画布节点吸附面板不传(保持内容自适应高度)。
   */
  fitToHeight?: boolean;
  /**
   * 受控参考素材模式(出片工作台):提供后参考区改受控数据——
   * 上传/删除直接写入 items(onChange),不建画布节点、不连线。
   * 数据存 WorkbenchShot.references,随 node.data 云同步,协作可见。
   */
  controlledReferences?: {
    items: WorkbenchShotReference[];
    onChange: (items: WorkbenchShotReference[]) => void;
  };
  /**
   * 受控模式从视频取帧回调（出片工作台：首尾帧槽位旁"从视频取帧"，由宿主实现抽帧+上传）。
   * 传此回调时首帧/尾帧空槽位显示「取帧」小按钮。
   */
  onExtractFrame?: (slot: 'first' | 'last') => void;
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
  forceDropUp = false,
}: {
  value: string;
  options: StyledSelectOption[];
  onChange: (v: string) => void;
  minWidth?: number;
  maxWidth?: number;
  height?: number;
  /** 强制向上弹出(底部 dock 场景);不传时按可用空间自动翻转 */
  forceDropUp?: boolean;
}): React.ReactElement {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [dropUp, setDropUp] = useState(false);
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

  // 2026-08-31 用户拍板:底部 dock 的模型下拉必须向上弹出(向下会被视口/容器裁掉)。
  // 策略:forceDropUp 强制向上;否则按可用空间自动翻转——下方放不下且上方更宽裕时向上。
  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const estimatedH = Math.min(300, options.length * 29 + 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const up = forceDropUp || (spaceBelow < estimatedH + 12 && spaceAbove > spaceBelow);
      setDropUp(up);
      setDropdownPos({ top: up ? rect.top - 4 : rect.bottom + 4, left: rect.left });
    }
    setOpen((prev) => !prev);
  }, [options.length, forceDropUp]);

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
        <>
        <style>{SELECT_ANIM_KEYFRAMES}</style>
        <div
          data-generator-select-panel="true"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            // 向上弹出:以触发器上沿为锚点整体上翻;配合 fade+rise 入场动画
            transform: dropUp ? 'translateY(-100%)' : undefined,
            transformOrigin: dropUp ? 'bottom center' : 'top center',
            animation: dropUp ? 'dockSelectInUp 0.16s ease-out' : 'dockSelectInDown 0.16s ease-out',
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
        </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ===== 卡片外观 tokens(主页创意简报 AiInputBar variant="elevated" 同款:无边框+圆角卡片) =====
const DOCK_CARD_RADIUS = 24;

/** 下拉入场动画:向下弹 = 从上沿轻微下移淡入;向上弹 = 从下沿轻微上移淡入 */
const SELECT_ANIM_KEYFRAMES = `
@keyframes dockSelectInDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dockSelectInUp {
  from { opacity: 0; transform: translateY(-100%) translateY(4px); }
  to { opacity: 1; transform: translateY(-100%) translateY(0); }
}
`;

/** NodeGenerateDock 展开态屏幕高度(供聚焦补偿 focusOnNode 使用) */
export const NODE_DOCK_SCREEN_HEIGHT = 240;

// ===== 参考素材区(memo 隔离:提示词输入/视口变化时不重渲染) =====

/** 参考素材类型上限(与后端模板 channelConstraints.bounds 对齐) */
interface VideoReferenceBounds {
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
}

/**
 * 根据视频生成模式返回参考素材配置(与 Admin getReferenceConfigByMode 一致):
 * - 首尾帧(image-to-video-first-last-frame):首帧/尾帧两个图片槽位,最多 2 张
 * - 多模态(multi-modal-reference):按上限显示图片/视频/音频参考
 */
function getReferenceConfigByMode(
  mode: string,
  bounds: VideoReferenceBounds,
): { isFirstLastFrameMode: boolean; showImages: boolean; showVideos: boolean; showAudio: boolean } {
  const maxReferenceImages = bounds.maxReferenceImages ?? 0;
  const maxReferenceVideos = bounds.maxReferenceVideos ?? 0;
  const maxReferenceAudios = bounds.maxReferenceAudios ?? 0;
  switch (mode) {
    case 'image-to-video-first-last-frame':
      return { isFirstLastFrameMode: true, showImages: false, showVideos: false, showAudio: false };
    case 'multi-modal-reference':
    case 'video-edit':
    case 'video-extend':
      return {
        isFirstLastFrameMode: false,
        showImages: maxReferenceImages > 0,
        showVideos: maxReferenceVideos > 0,
        showAudio: maxReferenceAudios > 0,
      };
    default:
      return { isFirstLastFrameMode: false, showImages: false, showVideos: false, showAudio: false };
  }
}

/**
 * 2026-08-31 导出给出片工作台 WorkbenchPromptDock 复用（数据视图分离）：
 * 参考素材区 UI 原样复用，仅由宿主提供归一化的 incomingNodes/refUrlMap。
 */
export const DockReferencesSection = memo(function DockReferencesSection({
  nodeId,
  incomingNodes,
  refUrlMap,
  nodeCompatibility,
  onRemoveIncoming,
  mode,
  bounds,
  onUpload,
  onExtractFrame,
}: {
  nodeId: string;
  incomingNodes: Array<{ id: string; type: string; title: string; content?: string; storageKey?: string }>;
  refUrlMap: Record<string, string>;
  nodeCompatibility: Record<string, boolean>;
  onRemoveIncoming: (sourceNodeId: string) => void;
  mode: string;
  bounds: VideoReferenceBounds;
  /** 受控模式上传回调（出片工作台：上传后写入镜头 references；不传则走画布节点连线链路） */
  onUpload?: (file: File) => void;
  /** 受控模式从视频取帧回调（首尾帧空槽位旁「从视频取帧」按钮） */
  onExtractFrame?: (slot: 'first' | 'last') => void;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const navBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const bgHover = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)';
  const dangerColor = theme.toolbar.danger ?? '#ef4444';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleAddReference = useCallback(() => { fileInputRef.current?.click(); }, []);

  // 模式感知配置(与 Admin 一致:首尾帧模式切换为首帧/尾帧槽位)
  const config = getReferenceConfigByMode(mode, bounds);
  const isFirstLast = config.isFirstLastFrameMode;
  // 首尾帧:图片按连接顺序填入首帧/尾帧;其余类型(视频/音频/文本)仍可小方块展示用于 @ 引用
  const imageNodes = incomingNodes.filter((n) => n.type === 'image');
  const otherNodes = incomingNodes.filter((n) => n.type !== 'image');
  const slotsFull = imageNodes.length >= 2;
  const accept = isFirstLast ? 'image/*' : 'image/*,video/*,.txt,.md,.docx,.pdf';

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // 受控模式(出片工作台):上传交给外层写入镜头 references,不建画布节点
    if (onUpload) {
      onUpload(file);
      return;
    }
    // 首尾帧模式:仅接受图片且槽位未满(最多 2 张 = 首帧 + 尾帧)
    if (isFirstLast) {
      if (!file.type.startsWith('image/')) return;
      if (slotsFull) return;
    }
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      const base = { nodeId, title: uploaded.title.replace(/\.[^.]+$/, '') };
      if (d.kind === 'text') {
        nodeActionBus.emit('nodeDock:addReferenceNode', { ...base, kind: 'text', content: d.content });
      } else if (d.kind === 'image' || d.kind === 'video') {
        // 携带原始宽高:createAssetNode 依赖它按真实比例定节点尺寸,否则回退 16:9
        nodeActionBus.emit('nodeDock:addReferenceNode', {
          ...base,
          kind: d.kind,
          storageKey: d.storageKey,
          content: d.kind === 'image' ? d.dataUrl : d.url,
          width: d.width,
          height: d.height,
        });
      } else if (d.kind === 'audio') {
        nodeActionBus.emit('nodeDock:addReferenceNode', {
          ...base,
          kind: d.kind,
          storageKey: d.storageKey,
          content: d.url,
        });
      }
      // script 不会从文件上传产生(detectKind 仅出 image/video/audio/text),无需处理
    } catch {
      // 上传失败静默(不打断当前编辑)
    }
  }, [nodeId, isFirstLast, slotsFull, onUpload]);

  /** 单个参考缩略图(多模态统一列表 / 首尾帧非图片项共用) */
  const renderThumb = (n: { id: string; type: string; title: string; content?: string; storageKey?: string }) => {
    const meta = TYPE_META[n.type] ?? { icon: <FileText size={14} />, label: n.type };
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
        title={`${meta.label}: ${n.title}`}
      >
        {hasThumb ? (
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, width: '100%' }}>
            <span style={{ flexShrink: 0, display: 'inline-flex', opacity: 0.7 }}>{meta.icon}</span>
            <span style={{ fontSize: 10, color: theme.toolbar.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 40, textAlign: 'center', lineHeight: 1.2 }}>
              {n.title}
            </span>
          </div>
        )}
        {/* 兼容性指示(绿勾/主题红叉;绿 #a4fd01、红=theme.toolbar.danger,2026-08-25 用户拍板) */}
        <div style={{
          position: 'absolute', top: 2, left: 2, width: 12, height: 12,
          borderRadius: '50%', background: isCompatible ? '#a4fd01' : dangerColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
        }}>
          {isCompatible
            ? <Check size={7} color="#fff" strokeWidth={3} />
            : <X size={7} color="#fff" strokeWidth={3} />}
        </div>
        {/* 删除按钮(右上角,Agent ReferenceChip 圆形叉同款:16px 圆 + 半透明底 + muted 叉) */}
        <button
          type="button"
          onClick={() => onRemoveIncoming(n.id)}
          title={t('nodeDock.removeRef', '移除参考素材')}
          style={{
            position: 'absolute', top: 2, right: 2, width: 16, height: 16,
            borderRadius: '50%', border: 'none',
            background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
            color: theme.toolbar.textMuted ?? '', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1,
            transition: 'background 0.1s', flexShrink: 0, zIndex: 2,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'; }}
        >
          <X size={10} />
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {isFirstLast ? (
        <>
          {/* 首尾帧模式:首帧/尾帧两个槽位(仅图片,按上传顺序),空槽位点击即上传 */}
          {[{ slot: 'first' as const, label: '首帧', node: imageNodes[0] }, { slot: 'last' as const, label: '尾帧', node: imageNodes[1] }].map(({ slot, label, node }) => (
            <div key={slot} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              {node ? (
                <div style={{ position: 'relative', width: 56, height: 48, borderRadius: 14, overflow: 'hidden', border: `1px solid ${navBorder}`, background: 'transparent' }}>
                  <img src={refUrlMap[node.id] || node.content} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <button
                    type="button"
                    onClick={() => onRemoveIncoming(node.id)}
                    title={t('nodeDock.removeRef', '移除参考素材')}
                    style={{
                      position: 'absolute', top: 2, right: 2, width: 16, height: 16,
                      borderRadius: '50%', border: 'none',
                      background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
                      color: theme.toolbar.textMuted ?? '', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1,
                      transition: 'background 0.1s', flexShrink: 0, zIndex: 2,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'; }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAddReference}
                  title={t('nodeDock.uploadFirstFrame', '上传图片作为首帧/尾帧')}
                  style={{
                    width: 56, height: 48, borderRadius: 14,
                    border: `1px dashed ${navBorder}`,
                    background: 'transparent', color: theme.toolbar.textMuted ?? '',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Upload size={14} />
                </button>
              )}
              <span style={{ fontSize: 10, color: theme.toolbar.textMuted ?? '', lineHeight: 1 }}>{label}</span>
              {/* 受控模式:空槽位提供「从视频取帧」入口（出片工作台 T2,2026-08-31） */}
              {!node && onExtractFrame && (
                <button
                  type="button"
                  onClick={() => onExtractFrame(slot)}
                  title="从当前镜头视频取帧"
                  style={{
                    fontSize: 9, color: theme.toolbar.accent, background: 'transparent',
                    border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0,
                  }}
                >
                  从视频取帧
                </button>
              )}
            </div>
          ))}
          {/* 非图片参考(视频/音频/文本)仍可小方块展示,供 @ 引用 */}
          {otherNodes.map(renderThumb)}
        </>
      ) : (
        <>
          {/* 多模态模式:统一上传按钮(图片/视频/文本) */}
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
          {incomingNodes.map(renderThumb)}
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {incomingNodes.length === 0 && (
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted ?? '', flexShrink: 0 }}>
          {isFirstLast
            ? t('nodeDock.firstLastHint', '首尾帧模式:按顺序填入首帧/尾帧,最多 2 张图片')
            : mode === 'video-edit' || mode === 'video-extend'
              ? t('nodeDock.editRefHint', '编辑/延长模式:上传参考视频,并描述要修改或延伸的画面')
              : t('nodeDock.refHint', '拖入节点连入参考,或点击上传素材')}
        </span>
      )}
      {isFirstLast && incomingNodes.length > 0 && imageNodes.length < 2 && (
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted ?? '', flexShrink: 0 }}>
          {t('nodeDock.firstLastHint', '首尾帧模式:按顺序填入首帧/尾帧,最多 2 张图片')}
        </span>
      )}
    </div>
  );
});

// ===== 输入区(memo 隔离:仅 value/引用变化时重渲染,参考区与底栏不受打字影响) =====
/** 2026-08-31 导出给 WorkbenchPromptDock 复用（输入区 UI 原样复用） */
export const DockInputSection = memo(function DockInputSection({
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
    </>
  );
});

// ===== 底栏(memo 隔离:模型/参数/生成按钮 + 字数;textLength 逐字变化驱动字数显示) =====
/** 2026-08-31 导出给 WorkbenchPromptDock 复用（底栏 UI 原样复用） */
export const DockFooterBar = memo(function DockFooterBar({
  nodeId,
  mode,
  model,
  modelOptions,
  paramValues,
  isRunning,
  hasText,
  textLength = 0,
  interruptible = true,
  onAction,
  onConfigChange,
  onParamValuesChange,
  onConstraintsReady,
  mentionRequired,
  dropUp = false,
}: {
  nodeId: string;
  mode: GenerationMode;
  model: string;
  modelOptions: StyledSelectOption[];
  paramValues: Record<string, any>;
  isRunning: boolean;
  hasText: boolean;
  /** 提示词字数(显示在生成按钮旁,2026-08-31 用户拍板从输入区底部移入) */
  textLength?: number;
  /** 生成中是否可打断(文本可打断=停止按钮;媒体不可打断=锁徽标) */
  interruptible?: boolean;
  /** 模型下拉强制向上弹出(内嵌于底部面板时) */
  dropUp?: boolean;
  onAction: () => void;
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  onParamValuesChange: (patch: Record<string, any>) => void;
  /** 模板约束就绪回调(参考区读取参考素材上限) */
  onConstraintsReady?: (constraints?: ChannelConstraints) => void;
  /** 有堆叠内部卡片但未在输入框 @ 引用(仅提示,不禁用生成) */
  mentionRequired?: boolean;
}) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const spinRef = useRef<HTMLSpanElement>(null);
  const actionDisabled = !isRunning && !hasText;
  // 未 @ 堆叠内部卡片时的按钮提示(仅提示,不禁用:非堆叠连入素材自动作为输入源)
  const actionTitle = mentionRequired
    ? t('nodeDock.mentionStackedHint', '堆叠节点需 @ 内部资源才会作为输入源')
    : isRunning ? t('prompt.stop', '停止') : t('prompt.generate', '生成');

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
        forceDropUp={dropUp}
      />

      {/* 参数弹层(契约参数模块:模板驱动渲染,读写 node.data.paramValues;text 模式无参数面板) */}
      {onConfigChange && mode !== 'text' && modelOptions.length > 0 ? (
        <DynamicParamForm
          model={model}
          generationMode={mode}
          paramValues={paramValues}
          onChange={(patch) => onParamValuesChange(patch)}
          theme={theme}
          onConstraintsReady={onConstraintsReady}
        />
      ) : null}
      {/* 未配置模型:直接不显示(用户拍板:不展示跳转入口,避免误导) */}

      {/* 字数统计:右对齐,显示在生成按钮旁 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: theme.toolbar.textMuted ?? '', lineHeight: 1, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {textLength} 字
        </span>
      </div>

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
        /* 生成按钮(2026-08-31 用户拍板:Agent 同款方形 34px accent,无呼吸/缩放动画) */
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          aria-label={isRunning ? t('prompt.stop', '停止') : t('prompt.generate', '生成')}
          title={actionTitle}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, flexShrink: 0, minWidth: 34, height: 34, padding: 0,
            border: 'none', borderRadius: 8,
            background: actionDisabled
              ? (isDark ? '#262626' : '#e5e5e5')
              : isRunning ? (theme.toolbar.danger ?? '#dc2626') : theme.toolbar.accent,
            color: actionDisabled ? (isDark ? '#666' : '#999') : '#fff',
            cursor: actionDisabled ? 'not-allowed' : 'pointer',
            opacity: actionDisabled ? 0.4 : 1,
            transition: 'opacity 140ms ease',
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
  paramValues,
  store,
  getAnchorBounds,
  node,
  isMobile = false,
  inline = false,
  radius = DOCK_CARD_RADIUS,
  defaultCollapsed = true,
  style,
  fitToHeight = false,
  controlledReferences,
  onExtractFrame,
}: NodeGenerateDockProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  // 生成类型由宿主节点类型推导(堆叠不作为生成目标,见下方 return null)
  const mode: GenerationMode = defaultMode(nodeType, configMode);
  const [prompt, setPrompt] = useState(initialPrompt.trim());
  // 默认收起(用户验收反馈:选中节点即弹大面板碍眼):点顶栏细条展开,展开态右上角按钮收起;
  // 聚焦补偿 NODE_DOCK_SCREEN_HEIGHT 仅预留空间,收起态下无副作用
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

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

  // ===== 受控参考素材模式(出片工作台):数据存 WorkbenchShot.references,不建画布节点 =====
  const controlledItems = controlledReferences?.items ?? [];

  // 受控模式展示数据:把 references 转成参考区需要的节点形状(无画布连线)
  const displayIncomingNodes = useMemo(() => {
    if (!controlledReferences) return incomingNodes;
    return controlledItems.map((r) => ({
      id: r.id,
      type: r.kind,
      title: r.title ?? (r.kind === 'image' ? '图片' : r.kind),
      content: r.url,
      storageKey: r.storageKey,
    }));
  }, [controlledReferences, controlledItems, incomingNodes]);

  // 受控模式缩略图:直接用 items 的 url(无需异步解析)
  const displayRefUrlMap = useMemo(() => {
    if (!controlledReferences) return refUrlMap;
    const m: Record<string, string> = {};
    for (const r of controlledItems) {
      if (r.url) m[r.id] = r.url;
    }
    return m;
  }, [controlledReferences, controlledItems, refUrlMap]);

  // 受控模式全部视为兼容(无模型兼容性校验)
  const displayNodeCompatibility = controlledReferences ? {} : nodeCompatibility;

  // 断开连入节点连线 / 受控模式下移除 references 条目
  const handleRemoveIncoming = useCallback((sourceNodeId: string) => {
    if (controlledReferences) {
      controlledReferences.onChange(controlledItems.filter((r) => r.id !== sourceNodeId));
      return;
    }
    nodeActionBus.emit('nodeDock:removeConnection', { nodeId, sourceNodeId });
  }, [nodeId, controlledReferences, controlledItems]);

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

  // 契约参数模块:增量 patch 直传,由 handleNodeConfigChange 基于 graph 最新 paramValues 合并,
  // 避免组件层旧闭包合并导致一次点击连发的多个 patch 互相覆盖(分辨率/宽高比联动曾丢更新)
  const handleParamValuesChange = useCallback(
    (patch: Record<string, any>) => {
      onConfigChange?.(nodeId, { paramValues: patch });
    },
    [onConfigChange, nodeId],
  );

  // 模型未选择且渠道已加载出可用模型时,自动选中第一个:
  // 左侧模型下拉会显示 options[0] 但值仍为空 → 参数面板匹配不到模板显示"无自定义参数",
  // 用户以为坏了;自动选中后参数面板随模型立即刷新
  useEffect(() => {
    if (!model && modelOptions.length > 0 && modelOptions[0]) {
      onConfigChange?.(nodeId, { model: modelOptions[0].value });
    }
  }, [model, modelOptions, nodeId, onConfigChange]);

  // 视频参考模式:仅视频模式且参数中显式选择了模式时才切换参考区
  // (图片节点永远多模态;视频未在参数面板选择模式时也保持多模态,避免误入首尾帧)
  const currentVideoMode = mode === 'video' && typeof paramValues?.mode === 'string'
    ? paramValues.mode
    : 'multi-modal-reference';
  // 参考素材上限(从模板约束回调读取,与后端 channelConstraints.bounds 对齐)
  const [refBounds, setRefBounds] = useState<VideoReferenceBounds>({});
  const handleConstraintsReady = useCallback((constraints?: ChannelConstraints) => {
    setRefBounds({
      maxReferenceImages: constraints?.bounds?.maxReferenceImages,
      maxReferenceVideos: constraints?.bounds?.maxReferenceVideos,
      maxReferenceAudios: constraints?.bounds?.maxReferenceAudios,
    });
  }, []);

  // 首尾帧模式判断(受控上传时分配槽位)
  const refConfig = getReferenceConfigByMode(currentVideoMode, refBounds);
  const isFirstLastMode = refConfig.isFirstLastFrameMode;

  // 受控上传:上传 → 写入 references(首尾帧模式图片按槽位填入)
  const handleControlledUpload = useCallback(async (file: File) => {
    if (!controlledReferences) return;
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      // 类型收窄:uploadAsset 的 data 是 text/script/plan/image/video/audio 联合,按 kind 分别取字段
      let refKind: WorkbenchShotReference['kind'] = 'text';
      let storageKey: string | undefined;
      let url: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      if (d.kind === 'image') {
        refKind = 'image';
        storageKey = d.storageKey;
        url = d.dataUrl;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'video') {
        refKind = 'video';
        storageKey = d.storageKey;
        url = d.url;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'audio') {
        refKind = 'audio';
        storageKey = d.storageKey;
        url = d.url;
      }
      const ref: WorkbenchShotReference = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: refKind,
        title: uploaded.title.replace(/\.[^.]+$/, ''),
        storageKey,
        url,
        width,
        height,
      };
      if (isFirstLastMode && ref.kind === 'image') {
        const images = controlledItems.filter((r) => r.kind === 'image');
        if (images.length >= 2) return; // 首尾帧槽位已满
        ref.slot = images.some((r) => r.slot === 'first') ? 'last' : 'first';
      }
      controlledReferences.onChange([...controlledItems, ref]);
    } catch {
      // 上传失败静默(不打断当前编辑)
    }
  }, [controlledReferences, controlledItems, isFirstLastMode]);

  const submit = useCallback(() => {
    const text = promptRef.current.trim();
    if (!text || isRunning) return;
    // 输入源 = 全部连入素材(非堆叠节点自动作为 API 输入源,符合用户习惯:连线即输入,无需逐个 @)
    // + @ 到的堆叠内部卡片(堆叠整体不发送,内部资源需显式 @ 才会作为输入源)
    const mentionedStacked = references.filter((r) => r.id.includes('::') && text.includes(`@${r.name}`));
    const nonStacked = references.filter((r) => !r.id.includes('::'));
    onGenerate(nodeId, mode, text, [...nonStacked, ...mentionedStacked]);
    setPrompt('');
    promptRef.current = '';
  }, [isRunning, onGenerate, nodeId, mode, references]);

  const handleAction = useCallback(() => {
    if (isRunning) onStop(nodeId);
    else submit();
  }, [isRunning, onStop, nodeId, submit]);

  const typeMeta = TYPE_META[nodeType] ?? TYPE_META.generator!;

  // 堆叠内部卡片未 @ 引用 → 该卡片不发送(仅提示,不禁用生成;非堆叠连入素材自动作为输入源)
  // 注意:必须在任何条件 return 之前调用(React Hooks 顺序铁律)
  const stackedRefs = useMemo(() => references.filter((r) => r.id.includes('::')), [references]);
  const hasMentionedStacked = useMemo(
    () => stackedRefs.some((r) => prompt.includes(`@${r.name}`)),
    [stackedRefs, prompt],
  );
  const mentionRequired = stackedRefs.length > 0 && !hasMentionedStacked;

  // 只读模式整体隐藏（2026-08-25 系统性只读防护）：提示词输入/生成按钮是核心编辑入口，
  // portal 浮层逃逸画布遮罩，必须组件级拦截
  if (readOnly) return null;

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
    borderRadius: radius,
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

  // ===== 展开/收起(2026-08-31 用户拍板:收纳要有过渡,不能硬切) =====
  // 折叠细条与展开内容始终同在 DOM:细条 height→0 + 淡出,内容用 grid-template-rows 0fr→1fr 过渡
  // (0fr↔1fr 是唯一能对「内容自适应高度」做平滑过渡的写法;max-height 猜值要么卡顿要么截断)。
  // 折叠态内容 overflow hidden + pointerEvents none:不可点、不可聚焦,但不卸载 → 再次展开无白屏。
  const COLLAPSE_EASE = '0.28s cubic-bezier(0.22, 1, 0.36, 1)';
  const COLLAPSED_BAR_HEIGHT = 34;

  return (
    <div
      style={inline ? {
        position: 'relative', width: '100%', maxWidth: '100%', zIndex: 'auto' as unknown as number,
        ...style,
        // fitToHeight(出片工作台底部 dock)：折叠时收起为细条并吸附到底部，而不是贴顶部
        ...(fitToHeight
          ? {
              display: 'flex',
              flexDirection: 'column',
              transition: `height ${COLLAPSE_EASE}`,
              ...(collapsed ? { height: COLLAPSED_BAR_HEIGHT, flexShrink: 0, marginTop: 'auto' } : {}),
            }
          : {}),
      } : isMobile ? mobileWrapStyle : {
        position: 'absolute', left: centerX, top: bottomY, transform: 'translateX(-50%)',
        zIndex: 48, width: collapsed ? 220 : 720, maxWidth: 'calc(100vw - 24px)',
        transition: `width ${COLLAPSE_EASE}`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 无边框卡片(主页创意简报 elevated 同款:整体单色 + 柔和阴影) */}
      <div style={{ ...cardStyle, height: fitToHeight ? '100%' : undefined, display: fitToHeight ? 'flex' : undefined, flexDirection: fitToHeight ? 'column' : undefined, overflow: 'hidden', transition: `box-shadow ${COLLAPSE_EASE}, background ${COLLAPSE_EASE}, border-radius ${COLLAPSE_EASE}` }}>
        {/* 折叠细条(展开时高度收为 0 并淡出) */}
        <div
          style={{
            height: collapsed ? COLLAPSED_BAR_HEIGHT : 0,
            opacity: collapsed ? 1 : 0,
            transform: collapsed ? 'translateY(0)' : 'translateY(-6px)',
            transition: `height ${COLLAPSE_EASE}, opacity 0.18s ease, transform ${COLLAPSE_EASE}`,
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            padding: '0 14px', boxSizing: 'border-box', overflow: 'hidden',
            color: theme.toolbar.text, fontSize: 12, cursor: 'pointer', userSelect: 'none',
            pointerEvents: collapsed ? 'auto' : 'none',
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

        {/* 展开内容(折叠时 grid rows 收为 0fr) */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: collapsed ? '0fr' : '1fr',
            opacity: collapsed ? 0 : 1,
            transform: collapsed ? 'translateY(-4px)' : 'translateY(0)',
            transition: `grid-template-rows ${COLLAPSE_EASE}, opacity 0.2s ease, transform ${COLLAPSE_EASE}`,
            pointerEvents: collapsed ? 'none' : 'auto',
            flex: fitToHeight ? 1 : undefined,
            minHeight: fitToHeight ? 0 : undefined,
          }}
          aria-hidden={collapsed}
        >
        <div style={fitToHeight
          ? { overflow: 'hidden', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }
          : { overflow: 'hidden', minHeight: 0, position: 'relative' }}>
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

      {/* 参考素材区(单色融入;memo 隔离;按 paramValues.mode 智能切换首尾帧/多模态) */}
      <div style={{ ...sectionStyle, flexShrink: fitToHeight ? 0 : undefined, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DockReferencesSection
          nodeId={nodeId}
          incomingNodes={displayIncomingNodes}
          refUrlMap={displayRefUrlMap}
          nodeCompatibility={displayNodeCompatibility}
          onRemoveIncoming={handleRemoveIncoming}
          mode={currentVideoMode}
          bounds={refBounds}
          onUpload={controlledReferences ? handleControlledUpload : undefined}
          onExtractFrame={onExtractFrame}
        />
      </div>

      {/* 输入区(生成器同款 @ 引用 contentEditable;memo 隔离)
          fitToHeight:唯一可压缩的区域——超高时内部滚动,参考区与底栏始终可见;
          scrollbar-gutter stable:滚动条占位,避免字数统计被滚动条遮挡 */}
      <div style={{ ...sectionStyle, flex: fitToHeight ? 1 : undefined, minHeight: fitToHeight ? 0 : undefined, overflowY: fitToHeight ? 'auto' : undefined, scrollbarGutter: fitToHeight ? 'stable' : undefined, display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
        <DockInputSection
          value={prompt}
          onChange={updatePrompt}
          references={references}
          placeholder={t('nodeDock.placeholder', '输入提示词... 连入的素材会自动作为输入源(堆叠节点需 @ 内部资源)')}
          mentionTypeFilter={mentionTypeFilter}
        />
      </div>

      {/* 底栏(卡片内操作行;memo 隔离 + hasText 布尔化) */}
      <div style={{ ...sectionStyle, margin: '0 10px 10px', flexShrink: fitToHeight ? 0 : undefined, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DockFooterBar
          nodeId={nodeId}
          mode={mode}
          model={model ?? ''}
          modelOptions={modelOptions}
          paramValues={paramValues ?? {}}
          isRunning={isRunning}
          hasText={hasText}
          textLength={prompt.length}
          interruptible={mode === 'text'}
          onAction={handleAction}
          onConfigChange={onConfigChange}
          onParamValuesChange={handleParamValuesChange}
          onConstraintsReady={handleConstraintsReady}
          mentionRequired={mentionRequired}
          dropUp={inline}
        />
      </div>
        </div>
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
