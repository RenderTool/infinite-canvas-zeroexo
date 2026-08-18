/**
 * 生成器节点视图 - 统一生成节点(图片/视频/音频)
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
import { Sparkles, Image, Music, X, Text, Film, Clapperboard, Cpu, FileText, Check, Trash2, Upload } from 'lucide-react';
import { getModelIconComponent } from '@zeroexo/shared';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { BaseNodeView, nodeActionBus } from '../base-node-view.js';
import { apiGet } from '@/services/api-client.js';
import { filterChannelModelsByCapability } from '@/features/ai-config/use-ai-config-store.js';
import { getModelInputTypes } from '@/features/ai-config/utils/model-utils.js';
import type { ModelChannel } from '@/features/ai-config/use-ai-config-store.js';
import { DynamicParamForm } from '@/features/prompt-panel/components/dynamic-param-form.js';
import GeneratorPromptEditor, { type GeneratorPromptEditorHandle, type ReferenceItem } from './generator-prompt-editor.js';
import { useHydratedContent } from '../utils/hydrate.js';

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

interface GeneratorNodeData {
  generationMode: 'image' | 'video' | 'audio';
  prompt: string;
  status: 'idle' | 'generating' | 'success' | 'error';
  referenceImages: string[];
  channelId: string;
  model: string;
  /** 动态参数存储(与 Admin 配置的参数系统一致) */
  params: Record<string, any>;
  /** @deprecated 保留向后兼容,迁移到 params 字段 */
  size?: string;
  quality?: string;
  count?: number;
}

// 生成模式选项
const MODE_OPTIONS = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
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

// 节点类型 → 输入类型映射(用于模型兼容性检查)
const NODE_TYPE_TO_INPUT_TYPE: Record<string, string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  script: 'text',
  storyboard: 'text',
  generator: 'text',
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
  const cardBorder = theme.mode === 'dark' ? '#2e2e2e' : '#e5e5e5';
  const bgHover = theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';

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

  // 按生成模式筛选具有对应能力的模型
  const capability = generationMode === 'image' ? 'image' : generationMode === 'video' ? 'video' : 'audio';
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
  const currentModelValue = channelId && model ? `${channelId}::${model}` : '';

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
    return incoming.map((item) => {
      const nodeData = _store?.getNode(item.id);
      const nodeContent = (nodeData?.data as Record<string, unknown>)?.content as string | undefined;
      const nodeStorageKey = (nodeData?.data as Record<string, unknown>)?.storageKey as string | undefined;
      const nodeTitle = nodeData?.title || (nodeData?.data as Record<string, unknown> | undefined)?.title || item.type;
      return {
        id: item.id,
        type: item.type,
        content: nodeContent,
        storageKey: nodeStorageKey,
        title: nodeTitle as string,
      };
    });
  }, [connectionController, node.id, _store, graphVersion]);

  // 稳定化 incomingNodes:仅当数据实际变化时更新引用,避免 graphVersion 变化导致无意义重渲染
  const incomingNodesRef = useRef(incomingNodesRaw);
  const [incomingNodes, setIncomingNodes] = useState(incomingNodesRaw);
  useEffect(() => {
    const prev = incomingNodesRef.current;
    if (prev.length !== incomingNodesRaw.length) {
      incomingNodesRef.current = incomingNodesRaw;
      setIncomingNodes(incomingNodesRaw);
      return;
    }
    const changed = incomingNodesRaw.some((n, i) => n.id !== prev[i]?.id || n.type !== prev[i]?.type || n.content !== prev[i]?.content);
    if (changed) {
      incomingNodesRef.current = incomingNodesRaw;
      setIncomingNodes(incomingNodesRaw);
    }
  }, [incomingNodesRaw]);

  // 检查每个连入节点是否被当前模型支持
  // 兼容性判断规则:
  // 1. 未选择模型时默认所有节点兼容
  // 2. 文本类节点永远兼容(text/script/storyboard/generator)
  // 3. 图片/视频/音频节点:模型支持对应输入类型 或 生成模式匹配
  const nodeCompatibility = useMemo(() => {
    const map: Record<string, boolean> = {};
    const hasModelSelected = !!currentModelValue;
    for (const n of incomingNodes) {
      const inputType = NODE_TYPE_TO_INPUT_TYPE[n.type] || 'text';
      // 文本类节点永远兼容
      if (inputType === 'text') {
        map[n.id] = true;
        continue;
      }
      // 未选择模型时默认兼容
      if (!hasModelSelected) {
        map[n.id] = true;
        continue;
      }
      // 已选择模型:检查模型输入类型是否包含该节点类型
      const modelSupportsType = supportedInputTypes.includes(inputType);
      // 额外:如果生成模式与节点类型匹配,也视为兼容(即使模型inputTypes未显式包含)
      const modeMatches = generationMode === inputType;
      map[n.id] = modelSupportsType || modeMatches;
    }
    return map;
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

  // ===== 自动从连入图片节点获取参考图(仅用于兼容旧数据) =====
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
        const existingRefs = currentData.referenceImages ?? [];
        updateNode({ data: { ...currentData, referenceImages: [...existingRefs, ...newRefs] } });
      }
    };
    void addNewRefs();
  }, [connectionController, node.id, _store, referenceImages, graphVersion]);

  // ===== node 引用(用于稳定回调,避免闭包捕获新对象) =====
  const nodeRef = useRef(node);
  nodeRef.current = node;

  // ===== 生成类型切换 =====
  const handleModeChange = useCallback((mode: string) => {
    const currentData = nodeRef.current.data ?? {};
    updateNode({ data: { ...currentData, generationMode: mode } });
  }, [updateNode]);

  // ===== 模型切换(简化:直接选择编码值) =====
  const handleModelChange = useCallback((m: string) => {
    const currentData = nodeRef.current.data ?? {};
    const parts = m.split('::');
    updateNode({ data: { ...currentData, channelId: parts[0] ?? '', model: parts[1] ?? '' } });
  }, [updateNode]);

  // ===== 参数配置变更(动态参数存储在 data.params 中) =====
  const params = useMemo(() => data.params ?? {}, [data.params]);
  const handleConfigChange = useCallback((patch: Record<string, any>) => {
    const currentData = (nodeRef.current.data ?? {}) as Record<string, unknown>;
    const currentParams = (currentData.params ?? {}) as Record<string, unknown>;
    updateNode({ data: { ...currentData, params: { ...currentParams, ...patch } } });
  }, [updateNode]);

  // ===== 编码模型值(用于 SettingsPopover) =====
  const encodedModel = channelId && model ? `${channelId}::${model}` : '';

  // ===== 提示词输入(防抖写入 node data) =====
  const handlePromptChange = useCallback((val: string) => {
    setPromptInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const currentData = nodeRef.current.data ?? {};
      updateNode({ data: { ...currentData, prompt: val } });
    }, 300);
  }, [updateNode]);

  // ===== 构建 references 数据供编辑器使用 =====
  const references: ReferenceItem[] = useMemo(() => {
    return incomingNodes.map((n) => {
      const ref: ReferenceItem = {
        id: n.id,
        type: n.type as ReferenceItem['type'],
        name: n.title || n.id.slice(0, 8),
        url: n.content || undefined,
      };
      return ref;
    });
  }, [incomingNodes]);

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

  const handleGenerate = useCallback(() => {
    nodeActionBus.emit('generator:generate', {
      nodeId: node.id,
      generationMode,
      prompt: promptInput,
      channelId,
      model,
      referenceImages: compatibleRefs,
    });
  }, [node.id, generationMode, promptInput, channelId, model, compatibleRefs]);

  // ===== 标题图标 =====
  const titleIconSize = Math.max(9, Math.min(13 * (invK ?? 1), 16));
  const modeIcon = <Sparkles size={titleIconSize} />;

  // ===== 视频缩略图生成组件(缓存缩略图避免闪烁) =====
// 模块级缓存 Map,跨所有 VideoThumbnail 实例共享,避免重复创建视频元素
const thumbnailCache = new Map<string, string>();

const VideoThumbnail = memo(function VideoThumbnail({ src, size }: { src: string; size: number }): React.ReactElement {
  const [thumb, setThumb] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, string>>(thumbnailCache);

  useEffect(() => {
    if (!src) return;
    // 检查模块级缓存
    const cached = cacheRef.current.get(src);
    if (cached) {
      setThumb(cached);
      return;
    }

    let cancelled = false;
    const vid = document.createElement('video');
    vid.muted = true;
    vid.preload = 'metadata';
    vid.crossOrigin = 'anonymous';
    vid.playsInline = true;

    const cleanup = () => {
      cancelled = true;
      // 正确停止视频加载:移除 src 后调用 load()
      vid.removeAttribute('src');
      vid.load();
      vid.remove();
    };

    const handleError = () => {
      if (!cancelled) cleanup();
    };

    const handleLoadedMetadata = () => {
      if (cancelled) return;
      // 跳转到 0.5s 位置获取帧(比第一帧更可靠,避免首帧黑屏)
      vid.currentTime = Math.min(0.5, vid.duration / 2);
    };

    const handleSeeked = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); return; }
        // 绘制视频帧到 canvas
        ctx.drawImage(vid, 0, 0, size, size);
        const url = canvas.toDataURL('image/jpeg', 0.6);
        if (!cancelled) {
          cacheRef.current.set(src, url);
          setThumb(url);
        }
      } catch { /* 静默 */ }
      cleanup();
    };

    vid.onerror = handleError;
    vid.onloadedmetadata = handleLoadedMetadata;
    vid.onseeked = handleSeeked;

    vid.src = src;
    vid.load();

    // 超时保护(10秒,blob URL 可能需要更长加载时间)
    const timeoutId = setTimeout(() => {
      if (!cancelled) cleanup();
    }, 10000);

    return () => {
      clearTimeout(timeoutId);
      cleanup();
    };
  }, [src, size]);

  if (thumb) {
    return <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
      <Film size={20} />
    </div>
  );
});

// ===== 图片引用组件(使用 useHydratedContent 解决 blob URL 失效问题) =====
const HydratedImage = memo(function HydratedImage({ storageKey, content, size }: { storageKey?: string; content?: string; size?: number }): React.ReactElement {
  const hydrated = useHydratedContent(storageKey, content ?? '');
  if (!hydrated) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
        <Image size={size ?? 20} />
      </div>
    );
  }
  return <img src={hydrated} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
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
  textColor,
}: {
  node: { id: string; type: string; content?: string; title: string; storageKey?: string };
  label: string;
  isCompatible: boolean;
  thumbnail: string | null;
  nodeTypeConfig: { icon: React.ReactNode; label: string } | undefined;
  onRemove: () => void;
  cardBorder: string;
  bgHover: string;
  textColor: string;
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, width: '100%' }}>
          <span style={{ flexShrink: 0, display: 'inline-flex', opacity: 0.7 }}>
            {config.icon}
          </span>
          <span style={{ fontSize: 10, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 44, textAlign: 'center', lineHeight: 1.2 }}>
            {incomingNode.title}
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
      {/* 兼容性指示(左上角) */}
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: isCompatible ? '#3b82f6' : '#ef4444',
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
      {/* 删除按钮(右上角) */}
      <button
        type="button"
        onClick={onRemove}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 12,
          height: 12,
          borderRadius: 2,
          background: '#ff4d4f',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          zIndex: 2,
          opacity: 0.85,
          transition: 'opacity 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.85'; }}
      >
        <Trash2 size={7} />
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
        {/* 参考素材区 */}
        <div
          style={{
            padding: '8px 12px',
            borderBottom: `1px solid ${cardBorder}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 52,
            flexWrap: 'wrap',
          }}
          onPointerDown={handleInteractivePointerDown}
          onMouseDown={handleInteractiveMouseDown}
        >
          {/* 上传按钮(移到最前) */}
          <button
            type="button"
            onClick={handleAddReference}
            style={{
              width: 44,
              height: 44,
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
            }}
            title="上传参考素材(支持图片/视频/文本)"
            onMouseEnter={(e) => { e.currentTarget.style.background = bgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Upload size={18} />
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
                      textColor={textColor}
                    />
                  ) : (
                    <div style={{
                      width: 52, height: 52, borderRadius: 6, border: `1px dashed ${cardBorder}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, gap: 1, color: mutedColor, fontSize: 9, cursor: 'default',
                    }}>
                      <span style={{ fontSize: 10, opacity: 0.5 }}>首帧</span>
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
                      textColor={textColor}
                    />
                  ) : (
                    <div style={{
                      width: 52, height: 52, borderRadius: 6, border: `1px dashed ${cardBorder}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, gap: 1, color: mutedColor, fontSize: 9, cursor: 'default',
                    }}>
                      <span style={{ fontSize: 10, opacity: 0.5 }}>尾帧</span>
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
                      <VideoThumbnail src={thumbnail!} size={52} />
                    ) : (
                      <HydratedImage storageKey={(incomingNode as any).storageKey} content={thumbnail!} size={52} />
                    )
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: 4, width: '100%' }}>
                      <span style={{ flexShrink: 0, display: 'inline-flex', opacity: 0.7 }}>
                        {config.icon}
                      </span>
                      <span style={{ fontSize: 10, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 44, textAlign: 'center', lineHeight: 1.2 }}>
                        {incomingNode.title}
                      </span>
                    </div>
                  )}

                  {/* 兼容性指示(勾蓝色/叉红色 - 左上角) */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: 2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: isCompatible ? '#3b82f6' : '#ef4444',
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

                  {/* 删除按钮(方块样式,右上角) */}
                  <button
                    type="button"
                    onClick={() => handleRemoveIncoming(incomingNode.id)}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: '#ff4d4f',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      zIndex: 2,
                      opacity: 0.85,
                      transition: 'opacity 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                  >
                    <Trash2 size={7} />
                  </button>
                </div>
              );
            })
          )}

          {incomingNodes.length === 0 && (
            <span style={{ fontSize: 11, color: mutedColor }}>拖入节点连入参考,或点击上传素材</span>
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
            backgroundColor={theme.toolbar.panel}
            accentColor={theme.toolbar.accent}
            fontSize={12}
            lineHeight={1.6}
            minHeight={44}
            borderColor={cardBorder}
            borderHoverColor={theme.toolbar.accent}
            onLengthChange={() => {}}
          />
          {isEditing && (
            <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: 10, color: mutedColor, pointerEvents: 'none' }}>
              {promptInput.length} 字
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div
          style={{ padding: '8px 12px', borderTop: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}
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

          {/* 参数设置 — 使用 DynamicParamForm 动态加载参数(与 Admin 配置一致) */}
          <DynamicParamForm
            model={encodedModel}
            generationMode={generationMode}
            paramValues={params}
            onChange={handleConfigChange}
            theme={theme}
            titlePrefix={generationMode === 'image' ? '图片' : generationMode === 'video' ? '视频' : '音频'}
          />

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