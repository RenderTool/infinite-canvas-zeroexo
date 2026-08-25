/**
 * 生成器节点视图 - 统一生成节点(图片/视频/音频)
 *
 * ⚠️ [DEPRECATED] 生成器节点已废弃(2026-08-22 tA5,画布冗余):
 * 生成语义由「空 media 节点三态」承担——NodeGenerateDock 吸附面板(选中空 media/text 节点
 * 时渲染,复用本视图同款参考素材/提示词/底栏 UI)。本文件仅保留用于旧项目数据中的
 * generator 节点渲染兼容,禁止再新建生成器节点(创建入口已从右键菜单/连线端点菜单移除)。
 * 参考素材计算工具函数(deriveIncomingReferences 等)由 NodeGenerateDock 继续复用,不受影响。
 *
 * MVVM 迁移(Plan#10 第二批试点):数据变换/兼容性计算/命令构造已移至 generator-model.ts,
 * 视图只消费模型派生数据并经 commandQueue 提交命令(回退 updateNode)。布局与配色对齐 StackNode。
 *
 * 布局:
 * ┌─────────────────────────────────────────────────────────┐
 * │  参考素材区                                               │
 * │  [图缩略图] [音频名+图标] [文本名+图标] [视频缩略图] [+]  │
 * │  ✓ ✓ ✗ ✓  (模型兼容指示)                                │
 * │  ─────────────────────────────────────────────────────── │
 * │  提示词                                                   │
 * │  ┌─ contentEditable ─────────────────────────────────┐  │
 * │  │ 描述画面主体、风格、构图...                             │  │
 * │  │                                             字数N  │  │
 * │  └───────────────────────────────────────────────────┘  │
 * │  ─────────────────────────────────────────────────────── │
 * │  [生成类型▼] [模型▼] [参数⚙]                [⚡ 生成]    │
 * └─────────────────────────────────────────────────────────┘
 */

import React, { useRef, useState, useCallback, useMemo, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles, Image, Music, X, Text, Film, Clapperboard, Cpu, FileText, Check, Upload } from 'lucide-react';
import { getModelIconComponent } from '@zeroexo/shared';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import { resolveVideoThumbnail } from '@zeroexo/plugin-persistence';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { BaseNodeView, nodeActionBus } from '../base-node-view.js';
import { apiGet } from '@/services/api-client.js';
import { filterChannelModelsByCapability } from '@/features/ai-config/use-ai-config-store.js';
import { getModelInputTypes } from '@/features/ai-config/utils/model-utils.js';
import type { ModelChannel } from '@/features/ai-config/use-ai-config-store.js';
import { DynamicParamForm } from '@/features/generator-settings/dynamic-param-form.js';
import { SettingsPopoverShell, SettingGroup, OptionPill, SwitchRow } from '@/features/generator-settings/settings-popover-shell.js';
import GeneratorPromptEditor, { type GeneratorPromptEditorHandle, type ReferenceItem } from './generator-prompt-editor.js';
import { useHydratedContent, resolveContentUrl, resolveAnyThumbUrl } from '../utils/hydrate.js';
import { resolveVideoThumbUrl } from '../utils/video-thumb.js';
import {
  appendReferenceImages,
  computeReferenceCompatibility,
  deriveIncomingReferences,
  encodeModelValue,
  GENERATOR_TYPE_META,
  getTargetNodeType,
  mergeGeneratorParams,
  referencesChanged,
  setGenerationMode,
  setGeneratorPrompt,
  setModelSelection,
  type GeneratorMode,
  type GeneratorNodeData,
  type GeneratorParamDef,
} from './generator-model.js';

// 类型重导出(保持既有消费方 import 路径兼容)
export type { GeneratorNodeData };

// ===== 引脚定义 =====
export function getGeneratorNodePins(): Pin[] {
  return [
    { id: 'input', name: 'Input', direction: 'input' },
    { id: 'output', name: 'Output', direction: 'output' },
  ];
}

// ===== 类型定义 =====

export interface GeneratorNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  store: ReactGraphStore | null;
}

// 生成模式选项(Plan#33 D1: 全类型化 6 类)
const MODE_OPTIONS = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'text', label: '文本' },
  { value: 'script', label: '剧本' },
  { value: 'storyboard', label: '分镜' },
];

// 节点类型 → 图标/Label 映射
const NODE_TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  text: { icon: <Text size={14} />, label: '文本' },
  image: { icon: <Image size={14} />, label: '图片' },
  video: { icon: <Film size={14} />, label: '视频' },
  audio: { icon: <Music size={14} />, label: '音频' },
  script: { icon: <Clapperboard size={14} />, label: '剧本' },
  storyboard: { icon: <Clapperboard size={14} />, label: '分镜' },
  generator: { icon: <Sparkles size={14} />, label: '生成器' },
};

// ===== 轻量主题化 Select 组件(内联,避免插件包依赖外部 shared 组件) =====

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

// ===== GeneratorNodeView =====

export function GeneratorNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  commandQueue,
  invK,
  connectionController,
  store: _store,
  externalRenaming,
  onRenameFinish,
}: GeneratorNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<GeneratorNodeData>;
  const { t } = useTranslation();
  const { theme } = useTheme();

  const nodeColor = theme.node.fill;
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const isDark = theme.mode === 'dark';
  const dangerColor = theme.toolbar.danger ?? '#ef4444';
  // 顶部参考栏/底部操作栏配色对齐 StackNode 导航栏(StackBottomNav 同源 token)
  const navBg = isDark ? '#1b1b1b' : '#fafaf7';
  const navBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const cardBorder = navBorder;
  const bgHover = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)';

  // ===== 从 node.data 解构 =====
  const generationMode = data.generationMode ?? 'image';
  const prompt = data.prompt ?? '';
  const referenceImages = data.referenceImages ?? [];
  const channelId = data.channelId ?? '';
  const model = data.model ?? '';

  // ===== 渠道/模型选项(直接从后端API加载,按能力筛选) =====
  const [channels, setChannels] = useState<ModelChannel[]>([]);
  const [, setChannelsLoading] = useState(false);

  // 加载所有渠道
  useEffect(() => {
    let cancelled = false;
    setChannelsLoading(true);
    apiGet<{ items: Array<{
      id: string; name: string; provider: string; baseUrl: string;
      apiFormat: string; modelIcons?: Record<string, string>;
      models: Array<{ name: string; capabilities?: string[] }>;
    }> }>('/ai/channels')
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        const chs: ModelChannel[] = items.map((item) => ({
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
        }));
        setChannels(chs);
      })
      .catch(() => {
        if (!cancelled) setChannels([]);
      })
      .finally(() => {
        if (!cancelled) setChannelsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 按生成模式筛选具有对应能力的模型(script/storyboard 走文本能力)
  const capability = generationMode === 'image' ? 'image' : generationMode === 'video' ? 'video' : generationMode === 'audio' ? 'audio' : 'text';
  const filteredModelOptions = useMemo(() => {
    const encoded = filterChannelModelsByCapability(channels, capability);
    return encoded.map((enc) => {
      const parts = enc.split('::');
      const modelName = parts[1] ?? enc;
      const ch = channels.find((c) => c.id === parts[0]);
      const iconKey = ch?.modelIcons?.[modelName] || ch?.provider || undefined;
      return { value: enc, label: ch ? `${modelName}(${ch.name})` : modelName, iconKey };
    });
  }, [channels, capability]);

  // 简化渠道选择:直接展示所有模型(不区分渠道)
  const modelOptions = useMemo(() => {
    return filteredModelOptions;
  }, [filteredModelOptions]);

  // 当前选择的模型编码值
  const currentModelValue = encodeModelValue(channelId, model);

  // 获取当前模型支持的输入类型
  const supportedInputTypes = useMemo(() => {
    if (!currentModelValue) return ['text']; // 默认至少支持 text
    return getModelInputTypes(channels, currentModelValue);
  }, [channels, currentModelValue]);

  const [promptInput, setPromptInput] = useState(prompt);
  const editorRef = useRef<GeneratorPromptEditorHandle | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== 获取连入节点信息 =====
  const [graphVersion, setGraphVersion] = useState(0);
  useEffect(() => {
    if (!_store) return;
    const unsub = _store.subscribeGraph(() => setGraphVersion((v) => v + 1));
    return unsub;
  }, [_store]);

  const incomingNodesRaw = useMemo(() => {
    if (!connectionController) return [];
    const incoming = connectionController.getIncomingNodeTypes(node.id);
    return deriveIncomingReferences(incoming.map((item) => {
      const nodeData = _store?.getNode(item.id);
      const nodeContent = (nodeData?.data as Record<string, unknown>)?.content as string | undefined;
      const nodeStorageKey = (nodeData?.data as Record<string, unknown>)?.storageKey as string | undefined;
      const nodeTitle = nodeData?.title || (nodeData?.data as Record<string, unknown> | undefined)?.title || item.type;
      return { id: item.id, type: item.type, content: nodeContent, storageKey: nodeStorageKey, title: nodeTitle as string };
    }));
  }, [connectionController, node.id, _store, graphVersion]);

  // 稳定化 incomingNodes:仅当数据实际变化时更新引用,避免 graphVersion 变化导致无意义重渲染
  const incomingNodesRef = useRef(incomingNodesRaw);
  const [incomingNodes, setIncomingNodes] = useState(incomingNodesRaw);
  useEffect(() => {
    const prev = incomingNodesRef.current;
    if (!referencesChanged(prev, incomingNodesRaw)) return;
    incomingNodesRef.current = incomingNodesRaw;
    setIncomingNodes(incomingNodesRaw);
  }, [incomingNodesRaw]);

  // 检查每个连入节点是否被当前模型支持(规则集中于 generator-model.computeReferenceCompatibility)
  const nodeCompatibility = useMemo(() => {
    return computeReferenceCompatibility(incomingNodes, {
      hasModelSelected: !!currentModelValue,
      supportedInputTypes,
      generationMode,
    });
  }, [incomingNodes, supportedInputTypes, currentModelValue, generationMode]);

  // ===== 双击编辑模式 =====
  const [isEditing, setIsEditing] = useState(false);
  const handleDoubleClick = useCallback(() => {
    setIsEditing(true);
  }, []);

  // 编辑态:监听 document mousedown,检测点击是否在节点外
  const nodeShellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isEditing) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (nodeShellRef.current?.contains(target)) return;
      if (target.closest('[data-node-shell]')) return;
      if (target.closest('[data-capsule-toolbar]')) return;
      setIsEditing(false);
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [isEditing]);

  // ===== 自动从连入图片节点获取参考图 =====
  // @deprecated 旧数据兼容路径:连入参考已由顶部参考栏直接读取 incomingNodes,
  // 该 effect 仅为历史 referenceImages 数据兼容保留,验收后移除(Plan#10 T4)
  const syncedRefNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!connectionController) return;
    const incoming = connectionController.getIncomingNodeTypes(node.id);
    const imageNodes = incoming.filter((n) => n.type === 'image');
    if (imageNodes.length === 0) return;

    const newIds = imageNodes
      .filter((n) => !syncedRefNodeIdsRef.current.has(n.id))
      .map((n) => n.id);
    if (newIds.length === 0) return;

    const addNewRefs = async () => {
      const newRefs: string[] = [];
      for (const id of newIds) {
        const nodeData = _store?.getNode(id);
        if (!nodeData) continue;
        const content = (nodeData.data as Record<string, unknown>)?.content as string | undefined;
        if (content && content.startsWith('data:')) {
          if (!referenceImages.includes(content)) {
            newRefs.push(content);
          }
          syncedRefNodeIdsRef.current.add(id);
        } else if (content && content.startsWith('blob:')) {
          try {
            const res = await fetch(content);
            const blob = await res.blob();
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            if (!referenceImages.includes(dataUrl)) {
              newRefs.push(dataUrl);
            }
            syncedRefNodeIdsRef.current.add(id);
          } catch { /* 静默跳过 */ }
        }
      }
      if (newRefs.length > 0) {
        const currentData = (node.data ?? {}) as Partial<GeneratorNodeData>;
        if (commandQueue) {
          commandQueue.execute(appendReferenceImages(node.id, currentData, newRefs));
        } else {
          const existingRefs = currentData.referenceImages ?? [];
          updateNode({ data: { ...currentData, referenceImages: [...existingRefs, ...newRefs] } });
        }
      }
    };
    void addNewRefs();
  }, [connectionController, node.id, _store, referenceImages, graphVersion, commandQueue, updateNode]);

  // ===== node 引用(用于稳定回调,避免闭包捕获新对象) =====
  const nodeRef = useRef(node);
  nodeRef.current = node;

  // ===== 生成类型切换(命令化,支持撤销) =====
  // Plan#33 D2: 切换类型后通知编辑器层——下游产物类型若不匹配则自动转换/重建
  const handleModeChange = useCallback((mode: string) => {
    const currentData = nodeRef.current.data ?? {};
    if (commandQueue) {
      commandQueue.execute(setGenerationMode(node.id, currentData as Partial<GeneratorNodeData>, mode as GeneratorMode));
    } else {
      updateNode({ data: { ...currentData, generationMode: mode } });
    }
    nodeActionBus.emit('generator:modeChanged', {
      nodeId: node.id,
      mode: mode as GeneratorMode,
      targetNodeType: getTargetNodeType(mode as GeneratorMode),
    });
  }, [commandQueue, node.id, updateNode]);

  // ===== 模型切换(命令化,编码值由模型层解析) =====
  const handleModelChange = useCallback((m: string) => {
    const currentData = nodeRef.current.data ?? {};
    if (commandQueue) {
      commandQueue.execute(setModelSelection(node.id, currentData as Partial<GeneratorNodeData>, m));
      return;
    }
    const parts = m.split('::');
    updateNode({ data: { ...currentData, channelId: parts[0] ?? '', model: parts[1] ?? '' } });
  }, [commandQueue, node.id, updateNode]);

  // ===== 参数配置变更(动态参数存储在 data.params 中,命令化) =====
  const params = useMemo(() => data.params ?? {}, [data.params]);
  const handleConfigChange = useCallback((patch: Record<string, any>) => {
    const currentData = (nodeRef.current.data ?? {}) as Record<string, unknown>;
    if (commandQueue) {
      commandQueue.execute(mergeGeneratorParams(node.id, currentData as Partial<GeneratorNodeData>, patch));
      return;
    }
    const currentParams = (currentData.params ?? {}) as Record<string, unknown>;
    updateNode({ data: { ...currentData, params: { ...currentParams, ...patch } } });
  }, [commandQueue, node.id, updateNode]);

  // ===== 编码模型值(用于 SettingsPopover) =====
  const encodedModel = currentModelValue;

  // ===== 提示词输入(防抖写入 node data,命令化) =====
  const handlePromptChange = useCallback((val: string) => {
    setPromptInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const currentData = nodeRef.current.data ?? {};
      if (commandQueue) {
        commandQueue.execute(setGeneratorPrompt(node.id, currentData as Partial<GeneratorNodeData>, val));
      } else {
        updateNode({ data: { ...currentData, prompt: val } });
      }
    }, 300);
  }, [commandQueue, node.id, updateNode]);

  // ===== 构建 references 数据供编辑器使用 =====
  // @引用预览图解析:图片 hydrate / 视频走缩略图回退链(视频 URL 无法直接作 <img> src)
  const [refUrlMap, setRefUrlMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(incomingNodes.map(async (n) => {
        if (n.type === 'video') {
          const u = await resolveVideoThumbUrl(n.storageKey, n.content);
          if (u) next[n.id] = u;
        } else if (n.type === 'image' && (n.content || n.storageKey)) {
          const u = await resolveContentUrl(n.storageKey, n.content ?? '');
          if (u) next[n.id] = u;
        }
      }));
      if (!cancelled) setRefUrlMap(next);
    })();
    return () => { cancelled = true; };
  }, [incomingNodes]);

  const references: ReferenceItem[] = useMemo(() => {
    return incomingNodes.map((n) => {
      const ref: ReferenceItem = {
        id: n.id,
        type: n.type as ReferenceItem['type'],
        name: n.title || n.id.slice(0, 8),
        url: refUrlMap[n.id] || (n.type === 'image' ? n.content : undefined) || undefined,
      };
      return ref;
    });
  }, [incomingNodes, refUrlMap]);

  // ===== 参考素材管理 =====
  // "+" 按钮:打开文件选择器,支持文本/图片/视频,通过 nodeActionBus 传递给父组件处理
  const handleAddReference = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,.txt,.md,.docx,.pdf';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      const fileArray = Array.from(files);
      // 通过 nodeActionBus 发送事件,由父组件(editor)处理上传和节点创建
      nodeActionBus.emit('generator:importFile', {
        nodeId: node.id,
        files: fileArray,
      });
    };
    input.click();
  }, [node.id]);

  // 删除某个连入节点(删除边)
  const handleRemoveIncoming = useCallback((incomingNodeId: string) => {
    nodeActionBus.emit('generator:removeConnection', {
      nodeId: node.id,
      incomingNodeId,
    });
  }, [node.id]);

  // ===== 生成按钮 =====
  // 过滤掉不兼容的连入节点,只传兼容的 referenceImages
  const compatibleRefs = useMemo(() => {
    return referenceImages.filter(() => true);
  }, [referenceImages]);

  // 连入的剧本节点集数(供 storyboard 参数面板集数多选 / 生成事件携带)
  const scriptEpisodes = useMemo(() => {
    const scriptNode = incomingNodes.find((n) => n.type === 'script');
    if (!scriptNode) return [];
    const nodeData = _store?.getNode(scriptNode.id);
    const eps = (nodeData?.data as Record<string, unknown>)?.episodes as
      Array<{ id: string; number?: number; title?: string }> | undefined;
    return (eps ?? []).map((e) => ({
      id: e.id,
      label: e.title || `第 ${e.number ?? ''} 集`,
    }));
  }, [incomingNodes, _store]);

  const handleGenerate = useCallback(() => {
    const genData = (nodeRef.current.data ?? {}) as Partial<GeneratorNodeData>;
    nodeActionBus.emit('generator:generate', {
      nodeId: node.id,
      generationMode,
      prompt: promptInput,
      channelId,
      model,
      referenceImages: compatibleRefs,
      params: genData.params ?? {}, // Plan#33: 携带类型专用参数(分镜集数/剧管提取/小说附件)
      scriptEpisodes,
    });
  }, [node.id, generationMode, promptInput, channelId, model, compatibleRefs, scriptEpisodes]);

  // ===== 标题图标 =====
  // T10: 图标尺寸 CSS 连续化——原 JS 量化(Math.max/min + 量化 invK)缩放跨桶瞬间跳变,
  // 改 clamp(9, 13×--zx-invk, 16) 与标题 fontSize 同源连续,桶内漂移/跨桶猛跳一并消除
  const TITLE_ICON_CLAMP = 'clamp(9px, calc(13px * var(--zx-invk, 1)), 16px)';
  const modeIcon = <Sparkles size={16} style={{ width: TITLE_ICON_CLAMP, height: TITLE_ICON_CLAMP }} />;

  // ===== 视频缩略图组件(回退链:持久化缩略图→后端 thumb→重建内容 URL video 首帧,不加载全量视频;无缩略图时回退图标) =====
const VideoThumbnail = memo(function VideoThumbnail({ storageKey, src }: { storageKey?: string; src: string }): React.ReactElement {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    // 回退链:持久化缩略图 → 后端 thumb 级资源 → 重建内容 URL(video preload=metadata 首帧)
    (async () => {
      // 1. 持久化缩略图(video-node-view 上传/播放时经 storeVideoThumbnail 存入)
      try {
        const persisted = await resolveVideoThumbnail(storageKey);
        if (persisted && !cancelled) { setThumbUrl(persisted); return; }
      } catch { /* 继续下一级 */ }
      // 2. 后端 thumb 级资源(resources/ 后端 size=thumb 认证链路)
      const thumb = await resolveAnyThumbUrl(storageKey);
      if (thumb && !cancelled) { setThumbUrl(thumb); return; }
      // 3. 重建内容 URL(刷新后 blob 失效场景,本地键从 IndexedDB 读,零网络)
      const url = await resolveContentUrl(storageKey, src);
      if (url && !cancelled) setVideoSrc(url);
    })();
    return () => { cancelled = true; };
  }, [storageKey, src]);
  if (thumbUrl) {
    return <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  if (videoSrc) {
    // 小槽位 video 回退:preload=metadata 仅拉头部显示首帧,不加载全量视频
    return <video src={videoSrc} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  }
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
      <Film size={20} />
    </div>
  );
});

// ===== 图片引用组件(useHydratedContent 解决 blob URL 失效;52px 槽位优先 thumb 级资源) =====
const HydratedImage = memo(function HydratedImage({ storageKey, content, size }: { storageKey?: string; content?: string; size?: number }): React.ReactElement {
  const hydrated = useHydratedContent(storageKey, content ?? '');
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveAnyThumbUrl(storageKey).then((u) => { if (!cancelled) setThumb(u); });
    return () => { cancelled = true; };
  }, [storageKey]);
  const final = thumb || hydrated;
  if (!final) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
        <Image size={size ?? 20} />
      </div>
    );
  }
  return <img src={final} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
});

// ===== 首尾帧槽位组件(视频首尾帧模式专用) =====
const ReferenceSlot = memo(function ReferenceSlot({
  node: incomingNode,
  label,
  isCompatible,
  thumbnail,
  nodeTypeConfig,
  onRemove,
  cardBorder,
  bgHover,
}: {
  node: { id: string; type: string; content?: string; title: string; storageKey?: string };
  label: string;
  isCompatible: boolean;
  thumbnail: string | null;
  nodeTypeConfig: { icon: React.ReactNode; label: string } | undefined;
  onRemove: () => void;
  cardBorder: string;
  bgHover: string;
}): React.ReactElement {
  const config = nodeTypeConfig ?? { icon: <FileText size={14} />, label: incomingNode.type };
  const hasThumbnail = !!thumbnail && incomingNode.type === 'image';
  return (
    <div
      style={{
        position: 'relative',
        width: 52,
        height: 52,
        borderRadius: 6,
        overflow: 'hidden',
        flexShrink: 0,
        border: `1px solid ${cardBorder}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: hasThumbnail ? 'transparent' : bgHover,
        cursor: 'default',
      }}
      title={`${label}: ${incomingNode.title}`}
    >
      {hasThumbnail ? (
        <HydratedImage storageKey={incomingNode.storageKey} content={thumbnail!} size={96} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          <span style={{ flexShrink: 0, display: 'inline-flex', opacity: 0.7 }}>
            {config.icon}
          </span>
        </div>
      )}
      {/* 标签(首帧/尾帧) */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 14,
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontSize: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          zIndex: 2,
        }}
      >
        {label}
      </div>
      {/* 兼容性指示(绿勾/主题红叉;绿 #a4fd01、红=theme.toolbar.danger,2026-08-25 用户拍板) */}
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: isCompatible ? '#a4fd01' : dangerColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}
      >
        {isCompatible ? (
          <Check size={7} color="#fff" strokeWidth={3} />
        ) : (
          <X size={7} color="#fff" strokeWidth={3} />
        )}
      </div>
      {/* 删除按钮(右上角,Agent ReferenceChip 圆形叉同款:16px 圆 + 半透明底 + muted 叉) */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="移除参考素材"
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: 'none',
          background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
          color: mutedColor,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          lineHeight: 1,
          zIndex: 2,
          transition: 'background 0.1s',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'; }}
      >
        <X size={10} />
      </button>
    </div>
  );
});

// ===== 获取节点内容缩略图(用于图片/视频节点) =====
const getNodeThumbnail = useCallback((incomingNode: { id: string; type: string; content?: string; title: string }): string | null => {
  if (incomingNode.type === 'image' && incomingNode.content) {
    return incomingNode.content;
  }
  if (incomingNode.type === 'video' && incomingNode.content) {
    return incomingNode.content; // 视频用 VideoThumbnail 组件处理
  }
  return null;
}, []);

  // ===== 拖拽辅助:仅对交互元素阻止冒泡 =====
  const isInteractiveElement = useCallback((target: EventTarget): boolean => {
    const el = target as HTMLElement;
    return !!(el.closest('button, input, select, textarea, [contenteditable], [data-interactive]'));
  }, []);

  const handleInteractivePointerDown = useCallback((e: React.PointerEvent) => {
    if (isInteractiveElement(e.target)) {
      e.stopPropagation();
    }
  }, [isInteractiveElement]);

  const handleInteractiveMouseDown = useCallback((e: React.MouseEvent) => {
    if (isInteractiveElement(e.target)) {
      e.stopPropagation();
    }
  }, [isInteractiveElement]);

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? t('nodes.generatorTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      contentPadding={0}
      invK={invK}
      titleIcon={modeIcon}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      store={_store}
    >
      <div 
        ref={nodeShellRef}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
        onDoubleClick={handleDoubleClick}
      >
        {/* 参考素材区(顶部,配色对齐 StackNode 导航栏) */}
        <div
          style={{
            padding: '8px 12px',
            borderBottom: `1px solid ${cardBorder}`,
            background: navBg,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 52,
            flexWrap: 'wrap',
          }}
          onPointerDown={handleInteractivePointerDown}
          onMouseDown={handleInteractiveMouseDown}
        >
          {/* 上传按钮(移到最前;显隐与节点激活态对齐:仅选中时显示,空节点亦然,保持卡片清爽) */}
          <button
            type="button"
            onClick={handleAddReference}
            style={{
              width: 52,
              height: 52,
              borderRadius: 6,
              border: `1px dashed ${cardBorder}`,
              background: 'transparent',
              color: mutedColor,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.12s',
              opacity: isSelected ? 1 : 0,
              pointerEvents: isSelected ? 'auto' : 'none',
            }}
            title="上传参考素材(支持图片/视频/文本)"
            onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Upload size={16} />
          </button>

          {/* 视频首尾帧模式:渲染首帧/尾帧专用槽位 */}
          {generationMode === 'video' && params.mode === 'image-to-video-first-last-frame' ? (
            (() => {
              // 从连入节点中筛选出图片节点(最多2个)
              const imageNodes = incomingNodes.filter((n) => n.type === 'image');
              const firstFrameNode = imageNodes[0] ?? null;
              const lastFrameNode = imageNodes[1] ?? null;
              return (
                <>
                  {/* 首帧槽位 */}
                  {firstFrameNode ? (
                    <ReferenceSlot
                      node={firstFrameNode}
                      label="首帧"
                      isCompatible={nodeCompatibility[firstFrameNode.id] ?? true}
                      thumbnail={getNodeThumbnail(firstFrameNode)}
                      nodeTypeConfig={NODE_TYPE_CONFIG[firstFrameNode.type]}
                      onRemove={() => handleRemoveIncoming(firstFrameNode.id)}
                      cardBorder={cardBorder}
                      bgHover={bgHover}
                    />
                  ) : (
                    <div style={{
                      width: 52, height: 52, borderRadius: 6, border: `1px dashed ${cardBorder}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, gap: 1, color: mutedColor, fontSize: 9, cursor: 'default',
                    }}>
                      <span style={{ fontSize: 9, opacity: 0.5 }}>首帧</span>
                    </div>
                  )}
                  {/* 尾帧槽位 */}
                  {lastFrameNode ? (
                    <ReferenceSlot
                      node={lastFrameNode}
                      label="尾帧"
                      isCompatible={nodeCompatibility[lastFrameNode.id] ?? true}
                      thumbnail={getNodeThumbnail(lastFrameNode)}
                      nodeTypeConfig={NODE_TYPE_CONFIG[lastFrameNode.type]}
                      onRemove={() => handleRemoveIncoming(lastFrameNode.id)}
                      cardBorder={cardBorder}
                      bgHover={bgHover}
                    />
                  ) : (
                    <div style={{
                      width: 52, height: 52, borderRadius: 6, border: `1px dashed ${cardBorder}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, gap: 1, color: mutedColor, fontSize: 9, cursor: 'default',
                    }}>
                      <span style={{ fontSize: 9, opacity: 0.5 }}>尾帧</span>
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            /* 普通模式:渲染所有连入节点 */
            incomingNodes.map((incomingNode) => {
              const config = NODE_TYPE_CONFIG[incomingNode.type] ?? { icon: <FileText size={14} />, label: incomingNode.type };
              const isCompatible = nodeCompatibility[incomingNode.id] ?? true;
              const thumbnail = getNodeThumbnail(incomingNode);
              const hasThumbnail = thumbnail && (incomingNode.type === 'image' || incomingNode.type === 'video');

              return (
                <div
                  key={incomingNode.id}
                  style={{
                    position: 'relative',
                    width: 52,
                    height: 52,
                    borderRadius: 6,
                    overflow: 'hidden',
                    flexShrink: 0,
                    border: `1px solid ${cardBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: hasThumbnail ? 'transparent' : bgHover,
                    cursor: 'default',
                  }}
                  title={`${config.label}: ${incomingNode.title}`}
                >
                  {hasThumbnail ? (
                    incomingNode.type === 'video' ? (
                      <VideoThumbnail storageKey={incomingNode.storageKey} src={thumbnail!} />
                    ) : (
                      <HydratedImage storageKey={incomingNode.storageKey} content={thumbnail!} size={52} />
                    )
                  ) : (
                    /* 无缩略图才回退图标(标题保留,与原方块风格一致) */
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, width: '100%' }}>
                      <span style={{ flexShrink: 0, display: 'inline-flex', opacity: 0.7 }}>
                        {config.icon}
                      </span>
                      <span style={{ fontSize: 10, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 44, textAlign: 'center', lineHeight: 1.2 }}>
                        {incomingNode.title}
                      </span>
                    </div>
                  )}

                  {/* 兼容性指示(绿勾/主题红叉 - 左上角;2026-08-25 用户拍板) */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: 2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: isCompatible ? '#a4fd01' : dangerColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 2,
                    }}
                  >
                    {isCompatible ? (
                      <Check size={7} color="#fff" strokeWidth={3} />
                    ) : (
                      <X size={7} color="#fff" strokeWidth={3} />
                    )}
                  </div>

                  {/* 删除按钮(右上角,Agent ReferenceChip 圆形叉同款:16px 圆 + 半透明底 + muted 叉) */}
                  <button
                    type="button"
                    onClick={() => handleRemoveIncoming(incomingNode.id)}
                    aria-label="移除参考素材"
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: 'none',
                      background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)',
                      color: mutedColor,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      lineHeight: 1,
                      zIndex: 2,
                      transition: 'background 0.1s',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.14)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)'; }}
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })
          )}

          {incomingNodes.length === 0 && isSelected && (
            <span style={{ fontSize: 11, color: mutedColor }}>拖入节点连入参考,或点击上传素材</span>
          )}
          {/* Plan#33 C4: 输入源提醒——text/script/storyboard 需要文本输入源,缺文本源时非阻断提示 */}
          {(generationMode === 'text' || generationMode === 'script' || generationMode === 'storyboard')
            && !incomingNodes.some((n) => n.type === 'text' || n.type === 'script' || n.type === 'generator')
            && isSelected && (
              <span style={{ fontSize: 11, color: '#d97706', fontStyle: 'normal', flexShrink: 0 }}>
                {t('nodes.generatorNoTextSource')}
              </span>
            )}
        </div>

        {/* 提示词输入框 - 使用 contentEditable 实现支持 @ 引用 */}
        <div
          style={{ 
            flex: 1, 
            position: 'relative', 
            minHeight: 60, 
            borderBottom: `1px solid ${cardBorder}`,
            padding: '8px 12px',
          }}
          // 编辑态:阻止 pointer/mouse 事件冒泡,避免触发节点移动拖拽
          onPointerDown={isEditing ? handleInteractivePointerDown : undefined}
          onMouseDown={isEditing ? handleInteractiveMouseDown : undefined}
        >
          <GeneratorPromptEditor
            ref={editorRef}
            value={promptInput}
            onChange={handlePromptChange}
            references={references}
            readOnly={!isEditing}
            placeholder={isEditing ? '输入提示词... (输入 @ 引用素材)' : '双击进入编辑模式...'}
            textColor={textColor}
            accentColor={theme.toolbar.accent}
            fontSize={12}
            lineHeight={1.6}
            minHeight={44}
            onLengthChange={() => {}}
            // @ 弹窗主题色:亮色白底/暗色 toolbar.panel(暗色主题下 textColor 是亮色,亮度推断会误判为白底)
            popupBackground={isDark ? (theme.toolbar.panel ?? '#26262b') : '#ffffff'}
            popupBorderColor={isDark ? (theme.toolbar.border ?? 'rgba(255,255,255,0.14)') : '#e7e5e4'}
          />
          {isEditing && (
            <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: 10, color: mutedColor, pointerEvents: 'none' }}>
              {promptInput.length} 字
            </div>
          )}
        </div>

        {/* 底部操作栏(配色对齐 StackNode 导航栏) */}
        <div
          style={{ padding: '8px 12px', borderTop: `1px solid ${cardBorder}`, background: navBg, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}
          onPointerDown={handleInteractivePointerDown}
          onMouseDown={handleInteractiveMouseDown}
        >
          {/* 生成类型 Select */}
          <StyledSelect
            value={generationMode}
            options={MODE_OPTIONS}
            onChange={handleModeChange}
            minWidth={64}
            height={26}
          />

          {/* 模型 Select(简化:直接展示所有模型,不区分渠道) */}
          <StyledSelect
            value={currentModelValue}
            options={modelOptions}
            onChange={handleModelChange}
            minWidth={120}
            maxWidth={180}
            height={26}
          />

          {/* 参数设置 — image/video/audio/text 走 AI 渠道模板;script/storyboard 走类型专用参数面板(Plan#33 D1/D3) */}
          {(generationMode === 'image' || generationMode === 'video' || generationMode === 'audio' || generationMode === 'text') ? (
            <DynamicParamForm
              model={encodedModel}
              generationMode={generationMode}
              paramValues={params}
              onChange={handleConfigChange}
              theme={theme}
              titlePrefix={GENERATOR_TYPE_META[generationMode]?.label ?? ''}
            />
          ) : (
            <GeneratorStaticParams
              mode={generationMode}
              params={params}
              onChange={handleConfigChange}
              theme={theme}
              scriptEpisodes={scriptEpisodes}
            />
          )}

          <div style={{ flex: 1 }} />

          {/* 生成按钮 */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!promptInput.trim()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 12, padding: '4px 12px', borderRadius: 9999,
              border: 'none', cursor: promptInput.trim() ? 'pointer' : 'not-allowed',
              background: promptInput.trim() ? theme.toolbar.accent : (theme.mode === 'dark' ? '#333' : '#e5e5e5'),
              color: promptInput.trim() ? '#fff' : (theme.mode === 'dark' ? '#666' : '#999'),
              fontFamily: 'inherit', fontWeight: 500,
              transition: 'opacity 0.15s',
              opacity: promptInput.trim() ? 1 : 0.5,
            }}
          >
            <Sparkles size={14} />
            <span>生成</span>
          </button>
        </div>
      </div>
    </BaseNodeView>
  );
}

// ===== 类型专用参数面板(Plan#33 D3: storyboard/script 静态参数) =====

/** 智能读取文本文件:严格 UTF-8 优先,失败回落 GB18030(text-import-encoding-detect 契约) */
async function readTextFileSmart(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(buf);
    } catch {
      return new TextDecoder('utf-8').decode(buf);
    }
  }
}

/** 剧本小说附件参数(string dynamic: 本地读取文本,不产生画布节点) */
function ScriptAttachmentParam({
  value,
  onChange,
  theme,
}: {
  value: unknown;
  onChange: (v: { name: string; content: string }) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  const [reading, setReading] = useState(false);
  const attachName = typeof value === 'object' && value ? (value as { name: string }).name : '';

  const handleUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.md,.doc,.docx';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setReading(true);
      void readTextFileSmart(file)
        .then((content) => onChange({ name: file.name, content }))
        .catch(() => { /* 读取失败保持原值 */ })
        .finally(() => setReading(false));
    };
    input.click();
  }, [onChange]);

  const btnBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)';
  const textMuted = theme.toolbar.textMuted ?? '';
  const textColor = theme.toolbar.text ?? '';
  const borderColor = theme.toolbar.border ?? '';

  return (
    <SettingGroup title="小说附件" color={textMuted}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={handleUpload}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 28, padding: '0 10px', borderRadius: 6,
            border: `1px solid ${borderColor}`,
            background: btnBg, color: textColor,
            fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Upload size={12} />
          <span>{reading ? '读取中...' : attachName ? '重新上传' : '上传附件'}</span>
        </button>
        {attachName && (
          <span style={{ fontSize: 11, color: textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
            {attachName}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: textMuted, marginTop: 4, lineHeight: 1.5 }}>
        可选:上传小说文本作为剧本生成的小说原文;仅输入框内容会作为提示词追加
      </div>
    </SettingGroup>
  );
}

function GeneratorStaticParams({
  mode,
  params,
  onChange,
  theme,
  scriptEpisodes,
}: {
  mode: GeneratorMode;
  params: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  theme: ThemeConfig;
  scriptEpisodes: Array<{ id: string; label: string }>;
}): React.ReactElement {
  const meta = GENERATOR_TYPE_META[mode];
  const template = meta?.paramTemplate ?? [];
  const textColor = theme.toolbar.text ?? '';
  const mutedColor = theme.toolbar.textMuted ?? '';

  // 集数多选: 默认全选(候选来自连入剧本)
  const episodesValue = useMemo(() => {
    const current = (params.episodes as string[] | undefined) ?? [];
    if (current.length === 0 && scriptEpisodes.length > 0) {
      return scriptEpisodes.map((e) => e.id);
    }
    return current;
  }, [params.episodes, scriptEpisodes]);
  const allSelected = episodesValue.length === scriptEpisodes.length && scriptEpisodes.length > 0;

  // 参数摘要(与 DynamicParamForm 风格一致,位于弹层入口)
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (mode === 'storyboard') {
      if (scriptEpisodes.length > 0) {
        parts.push(allSelected ? '全部集数' : `${episodesValue.length} 集`);
      }
      if (params.autoExtractProductionManager !== false) parts.push('提取剧管');
      if (params.useSubjectDictionary === false) parts.push('无主体字典');
    } else if (mode === 'script') {
      const att = params.attachment;
      if (typeof att === 'object' && att) parts.push(`附件:${(att as { name: string }).name}`);
    }
    return parts.length > 0 ? parts.join(' · ') : '参数';
  }, [mode, params, scriptEpisodes.length, episodesValue.length, allSelected]);

  const renderParam = (param: GeneratorParamDef): React.ReactNode => {
    const value = params[param.name] ?? param.default;
    switch (param.type) {
      case 'boolean':
        return (
          <SwitchRow
            key={param.name}
            label={param.label}
            checked={!!value}
            theme={theme}
            onChange={(checked) => onChange({ [param.name]: checked })}
          />
        );
      case 'multi': {
        if (scriptEpisodes.length === 0) {
          return (
            <SettingGroup key={param.name} title={param.label} color={mutedColor}>
              <div style={{ fontSize: 11, color: mutedColor }}>
                连入剧本节点后可选生成集数,默认全选
              </div>
            </SettingGroup>
          );
        }
        return (
          <SettingGroup key={param.name} title={param.label} color={mutedColor}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <OptionPill
                selected={allSelected}
                theme={theme}
                onClick={() => onChange({ [param.name]: allSelected ? [] : scriptEpisodes.map((e) => e.id) })}
              >
                全选
              </OptionPill>
              {scriptEpisodes.map((ep) => {
                const selected = episodesValue.includes(ep.id);
                return (
                  <OptionPill
                    key={ep.id}
                    selected={selected}
                    theme={theme}
                    onClick={() => {
                      const next = selected
                        ? episodesValue.filter((id) => id !== ep.id)
                        : [...episodesValue, ep.id];
                      onChange({ [param.name]: next });
                    }}
                  >
                    {ep.label}
                  </OptionPill>
                );
              })}
            </div>
            {param.tooltip && (
              <div style={{ fontSize: 10, color: mutedColor, marginTop: 6 }}>{param.tooltip}</div>
            )}
          </SettingGroup>
        );
      }
      case 'string': {
        if (param.name === 'attachment') {
          return (
            <ScriptAttachmentParam
              key={param.name}
              value={value}
              onChange={(v) => onChange({ attachment: v })}
              theme={theme}
            />
          );
        }
        return null;
      }
      default:
        return null;
    }
  };

  return (
    <SettingsPopoverShell summary={summary} theme={theme} panelWidth={320}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: textColor }}>
          {meta?.label ?? mode} 参数
        </div>
        {template.length === 0 ? (
          <div style={{ fontSize: 12, color: mutedColor }}>该类型无额外参数</div>
        ) : (
          template.map((p) => renderParam(p))
        )}
      </div>
    </SettingsPopoverShell>
  );
}