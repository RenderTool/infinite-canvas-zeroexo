/**
 * 图片快捷工具定义(11 个可定制工具)
 *
 * 泛型 <T> 解耦节点数据类型(调用方注入具体 node 形状)
 * 零 lucide-react 依赖,自研内联 SVG 图标
 * 持久化配置 normalize/readImageQuickToolsConfig
 *
 * 11 个工具:
 *   copyPrompt / reversePrompt / replace / resize / maskEdit /
 *   crop / split / upscale / superResolve / angle / view
 *
 * 5 个基础工具(info/delete/saveAsset/download/edit)由 app 自行渲染,
 *   不在本数组中(它们固定显示,不参与工具栏自定义)。
 */

import type { ReactNode } from 'react';
import type {
  ImageActionToolId,
  ImageQuickToolId,
  ImageQuickToolsConfig,
} from './types.js';
import {
  BASE_TOOL_IDS,
  DEFAULT_VISIBLE_ACTION_IDS,
  DEFAULT_TOOLS_CONFIG,
  TOOLS_STORAGE_KEY,
} from './types.js';

// ===== 节点查询(可选,用于 resize 等需要读取节点状态的工具) =====

export interface ToolQueries<T> {
  /** 是否自由比例(resize 工具用,默认 false) */
  isFreeResize?: (node: T) => boolean;
}

// ===== 工具回调(11 个) =====

export interface ToolHandlers<T> {
  onCopyPrompt: (node: T) => void;
  onReversePrompt: (node: T) => void;
  onUpload: (node: T) => void;
  onToggleFreeResize: (node: T) => void;
  onMaskEdit: (node: T) => void;
  onCrop: (node: T) => void;
  onSplit: (node: T) => void;
  onUpscale: (node: T) => void;
  onSuperResolve: (node: T) => void;
  onAngle: (node: T) => void;
  onViewImage: (node: T) => void;
}

// ===== 工具定义 =====

export interface ToolDefinition<T> {
  id: ImageActionToolId;
  /** 默认是否可见(用户可在设置 modal 中调整) */
  defaultVisible: boolean;
  /** 设置面板中的标签 */
  panelLabel: string;
  /** 工具栏标签(支持动态,queries 用于 resize 等需要状态的工具) */
  label: string | ((node: T, queries?: ToolQueries<T>) => string);
  /** 鼠标悬浮提示(支持动态) */
  title: string | ((node: T, queries?: ToolQueries<T>) => string);
  /** 图标(支持动态,例如 resize 根据状态切换) */
  icon: (node: T, queries?: ToolQueries<T>) => ReactNode;
  /** 是否激活态(例如自由比例时 resize 高亮) */
  active?: (node: T, queries?: ToolQueries<T>) => boolean;
  /** 执行回调 */
  run: (node: T, handlers: ToolHandlers<T>) => void;
}

// ===== SVG 图标(零 lucide 依赖) =====

const SVG_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 复制(lucide Copy) */
function CopyIcon() {
  return (
    <svg {...SVG_PROPS}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/** 文档(lucide FileText) */
function FileTextIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

/** 上传(lucide Upload) */
function UploadIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

/** 锁(lucide Lock) */
function LockIcon() {
  return (
    <svg {...SVG_PROPS}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** 开锁(lucide LockOpen) */
function LockOpenIcon() {
  return (
    <svg {...SVG_PROPS}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

/** 画笔(lucide Brush) */
function BrushIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </svg>
  );
}

/** 剪刀(lucide Scissors) */
function ScissorsIcon() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </svg>
  );
}

/** 2x2 网格(lucide Grid2x2) */
function Grid2x2Icon() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <path d="M12 2v20" />
      <path d="M2 12h20" />
    </svg>
  );
}

/** 放大镜(lucide ZoomIn) */
function ZoomInIcon() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

/** 闪光(lucide Sparkles) */
function SparklesIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  );
}

/** 相机(lucide Camera) */
function CameraIcon() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

/** 全屏(lucide Maximize2) */
function Maximize2Icon() {
  return (
    <svg {...SVG_PROPS}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" x2="14" y1="3" y2="10" />
      <line x1="3" x2="10" y1="21" y2="14" />
    </svg>
  );
}

// ===== 工具定义表(11 个) =====

/** 全部可定制工具定义(顺序即工具栏默认顺序) */
export const imageToolDefinitions: ToolDefinition<unknown>[] = [
  {
    id: 'copyPrompt',
    defaultVisible: true,
    panelLabel: '复制提示词',
    label: '复制提示词',
    title: '复制生成该图片的提示词',
    icon: () => <CopyIcon />,
    run: (node, handlers) => handlers.onCopyPrompt(node),
  },
  {
    id: 'reversePrompt',
    defaultVisible: true,
    panelLabel: '反推提示词',
    label: '反推提示词',
    title: '创建反推提示词的文本和配置节点',
    icon: () => <FileTextIcon />,
    run: (node, handlers) => handlers.onReversePrompt(node),
  },
  {
    id: 'replace',
    defaultVisible: true,
    panelLabel: '替换图片',
    label: '替换图片',
    title: '替换图片',
    icon: () => <UploadIcon />,
    run: (node, handlers) => handlers.onUpload(node),
  },
  {
    id: 'resize',
    defaultVisible: false,
    panelLabel: '锁比例',
    label: (node, queries) =>
      queries?.isFreeResize?.(node) ? '自由比例' : '锁比例',
    title: (node, queries) =>
      queries?.isFreeResize?.(node) ? '切换为等比缩放' : '切换为自由比例',
    icon: (node, queries) =>
      queries?.isFreeResize?.(node) ? <LockOpenIcon /> : <LockIcon />,
    active: (node, queries) => Boolean(queries?.isFreeResize?.(node)),
    run: (node, handlers) => handlers.onToggleFreeResize(node),
  },
  {
    id: 'maskEdit',
    defaultVisible: true,
    panelLabel: '局部编辑',
    label: '局部编辑',
    title: '添加蒙版遮罩后局部修改',
    icon: () => <BrushIcon />,
    run: (node, handlers) => handlers.onMaskEdit(node),
  },
  {
    id: 'crop',
    defaultVisible: true,
    panelLabel: '裁剪',
    label: '裁剪',
    title: '裁剪并生成新节点',
    icon: () => <ScissorsIcon />,
    run: (node, handlers) => handlers.onCrop(node),
  },
  {
    id: 'split',
    defaultVisible: true,
    panelLabel: '切图',
    label: '切图',
    title: '按行列切分图片',
    icon: () => <Grid2x2Icon />,
    run: (node, handlers) => handlers.onSplit(node),
  },
  {
    id: 'upscale',
    defaultVisible: true,
    panelLabel: '放大',
    label: '放大',
    title: '放大图片分辨率',
    icon: () => <ZoomInIcon />,
    run: (node, handlers) => handlers.onUpscale(node),
  },
  {
    id: 'superResolve',
    defaultVisible: false,
    panelLabel: '超分',
    label: '超分',
    title: 'AI 超分',
    icon: () => <SparklesIcon />,
    run: (node, handlers) => handlers.onSuperResolve(node),
  },
  {
    id: 'angle',
    defaultVisible: false,
    panelLabel: '多角度',
    label: '多角度',
    title: '生成角度',
    icon: () => <CameraIcon />,
    run: (node, handlers) => handlers.onAngle(node),
  },
  {
    id: 'view',
    defaultVisible: true,
    panelLabel: '查看大图',
    label: '查看大图',
    title: '查看图片详情',
    icon: () => <Maximize2Icon />,
    run: (node, handlers) => handlers.onViewImage(node),
  },
];

/** 全部可定制工具 id(顺序同 imageToolDefinitions) */
export const ACTION_TOOL_IDS: ImageActionToolId[] = imageToolDefinitions.map(
  (t) => t.id,
);

/** 默认工具栏 id(5 基础 + 8 默认可见可定制) */
export const DEFAULT_TOOL_IDS: ImageQuickToolId[] = [
  ...BASE_TOOL_IDS,
  ...DEFAULT_VISIBLE_ACTION_IDS,
];

// ===== 工厂:构建工具栏实例 =====

/** 工具栏实例(扁平化后的工具,供 UI 渲染) */
export interface ToolInstance {
  id: ImageQuickToolId;
  label: string;
  title: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}

/**
 * 构建工具栏实例数组
 *
 * @param node 当前节点
 * @param handlers 11 个回调
 * @param queries 可选查询(resize 用)
 * @param visibleIds 可选:仅返回这些 id 的工具(用于工具栏自定义),默认返回全部可定制工具
 */
export function buildImageToolbarTools<T>(
  node: T,
  handlers: ToolHandlers<T>,
  queries?: ToolQueries<T>,
  visibleIds?: ImageActionToolId[],
): ToolInstance[] {
  const filter = visibleIds ? new Set(visibleIds) : null;
  // 工具定义为固化表(unknown),此处断言为 T 以适配调用方节点类型
  const tools = imageToolDefinitions as ToolDefinition<T>[];
  return tools
    .filter((tool) => (filter ? filter.has(tool.id) : true))
    .map((tool) => ({
      id: tool.id,
      label: resolveToolText(tool.label, node, queries),
      title: resolveToolText(tool.title, node, queries),
      icon: tool.icon(node, queries),
      active: tool.active?.(node, queries),
      onClick: () => tool.run(node, handlers),
    }));
}

// ===== 持久化配置读写 =====

/** 规范化工具 id 数组(过滤无效 id,保持合法顺序) */
export function normalizeImageQuickToolIds(value: unknown[]): ImageQuickToolId[] {
  const allIds: ImageQuickToolId[] = [...BASE_TOOL_IDS, ...ACTION_TOOL_IDS];
  const valid = new Set(allIds);
  return allIds.filter((id) => value.includes(id) && valid.has(id));
}

/** 从 localStorage 读取的值解析为 ImageQuickToolsConfig */
export function readImageQuickToolsConfig(value: unknown): ImageQuickToolsConfig {
  // 兼容旧格式(纯 id 数组)
  if (Array.isArray(value)) {
    return {
      ids: normalizeImageQuickToolIds(value),
      showLabels: true,
      autoWrap: false,
      maxLines: 2,
    };
  }
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_TOOLS_CONFIG };
  }
  const data = value as Partial<ImageQuickToolsConfig>;
  return {
    ids: Array.isArray(data.ids)
      ? normalizeImageQuickToolIds(data.ids)
      : [...DEFAULT_TOOL_IDS],
    showLabels: data.showLabels !== false,
    autoWrap: data.autoWrap === true,
    maxLines:
      typeof data.maxLines === 'number' && data.maxLines >= 1
        ? Math.min(data.maxLines, 5)
        : 2,
  };
}

/** 从 localStorage 加载配置(读失败返回默认) */
export function loadImageQuickToolsConfig(): ImageQuickToolsConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_TOOLS_CONFIG };
  try {
    const raw = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TOOLS_CONFIG };
    return readImageQuickToolsConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TOOLS_CONFIG };
  }
}

/** 保存配置到 localStorage */
export function saveImageQuickToolsConfig(config: ImageQuickToolsConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage 不可用或配额满,静默失败
  }
}

// ===== 辅助 =====

function resolveToolText<T>(
  value: string | ((node: T, queries?: ToolQueries<T>) => string),
  node: T,
  queries?: ToolQueries<T>,
): string {
  return typeof value === 'function' ? value(node, queries) : value;
}
