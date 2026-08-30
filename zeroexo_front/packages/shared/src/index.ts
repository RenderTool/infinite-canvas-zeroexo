/**
 * ZeroExo 共享包 - 入口
 *
 * 包含类型定义、配置常量、工具函数和共享组件
 * 可被 @zeroexo/core 等核心包引入
 */

// ===== 类型 =====

export type {
  ModelConfig,
  ModelCapability,
  ApiCallFormat,
  ModelChannel,
  AiConfig,
} from './types/model-config.js';

export type {
  CanvasOp,
  CanvasOpResult,
} from './types/canvas-op.js';

export type {
  AgentMessage,
  AgentConversation,
} from './types/conversation.js';

// ===== 配置 =====

export {
  SEEDANCE_RESOLUTIONS,
  VIDEO_MODES,
  SEEDANCE_RATIOS,
  SEEDANCE_DURATIONS,
  OPENAI_RESOLUTIONS,
  OPENAI_SIZES,
  OPENAI_SECONDS,
  normalizeSeedanceResolution,
  normalizeSeedanceRatio,
  normalizeSeedanceDuration,
  normalizeOpenaiResolution,
  normalizeOpenaiSize,
  seedanceResolutionLabel,
  seedanceRatioLabel,
  seedanceDurationLabel,
  openaiResolutionLabel,
  openaiSizeLabel,
  openaiSecondsLabel,
  getSpecStringArray,
  getSpecNumberArray,
} from './configs/video-reference-config.js';

export {
  IMAGE_QUALITY_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  IMAGE_COUNT_OPTIONS,
  AUDIO_VOICE_OPTIONS,
  AUDIO_FORMAT_OPTIONS,
  AUDIO_SPEED_RANGE,
} from './configs/parameter-def.js';

// ===== 组件 =====

export type { BrandIconProps } from './components/brand-icons.js';
export {
  DefaultBrandIcon,
  BRAND_ICONS,
  BRAND_COLORS,
  getModelIconComponent,
} from './components/brand-icons.js';

export type { PromptEditorProps } from './components/prompt-editor.js';
export { PromptEditor } from './components/prompt-editor.js';

// ===== 工具函数 =====

export {
  estimateTokenCount,
  isWithinTokenBudget,
  truncateToTokenBudget,
} from './utils/token-budget.js';

export {
  collapseWhitespace,
  removeCommentLines,
  compressPrompt,
  truncate,
} from './utils/compression.js';

// ===== 旧版兼容（保留向后兼容） =====

export const PORT_COLORS: Record<string, string> = {
  exec: '#ffffff',
  bool: '#b3474b',
  int: '#3cb371',
  float: '#3cb371',
  string: '#ee9d3d',
  object: '#3c87b3',
  struct: '#2ecc71',
  enum: '#9b59b6',
  array: '#7f8c8d',
  any: '#95a5a6',
};

/** 主题模式 */
export type ThemeMode = 'light' | 'dark';

/** 画布 token(画布背景 + 网格) */
export interface CanvasTokens {
  /** 画布背景色 */
  background: string;
  /** 网格主线色(向后兼容,等于 gridLine) */
  gridColor: string;
  /** 网格副线色(更淡,用于次级网格) */
  gridColorSubtle: string;
  /** 点阵网格色(rgba 带 alpha,比线条更显眼) */
  gridDot: string;
  /** 线条网格色(rgba 带 alpha,更淡) */
  gridLine: string;
}

/** 节点 token(节点外观 + outline + pin) */
export interface NodeTokens {
  /** 节点默认底色(所有类型共用) */
  fill: string;
  /** 节点默认底色(legacy,与 fill 同义;保留以兼容旧字段) */
  defaultColor: string;
  /** 节点默认 outline 色(非选中) */
  outlineColor: string;
  /** 选中态 outline 色 */
  outlineSelectedColor: string;
  /** 悬停态 outline 色 */
  hoverColor: string;
  /** 标题栏文字色 */
  titleColor: string;
  /** 标题栏底色 */
  titleBackground: string;
  /** 内容区底色 */
  contentBackground: string;
  /** pin 默认色 */
  pinDefaultColor: string;
}

/** 工具栏 token(悬浮工具栏 + 底部工具栏 + 侧边栏) */
export interface ToolbarTokens {
  /** 工具栏底色 */
  background: string;
  /** 面板/浮层底色(半透明,用于弹窗、侧边栏等) */
  panel: string;
  /** 工具栏边框色 */
  border: string;
  /** 主文字色 */
  text: string;
  /** 次要文字色(标签/提示) */
  textMuted: string;
  /** 强调色(按钮激活/选中) */
  accent: string;
  /** 危险色(删除/警告) */
  danger: string;
  /** 编辑器表面色(编辑器容器背景) */
  editorSurface: string;
  /** 编辑器纸张色(纸张内容区背景) */
  editorPaper: string;
}

/** 组 token(组容器外观) */
export interface GroupTokens {
  /** 组默认底色(带透明) */
  background: string;
  /** 组 outline 色(非选中) */
  outlineColor: string;
  /** 组选中态 outline 色 */
  outlineSelectedColor: string;
  /** 组标题色 */
  titleColor: string;
}

/** 边 token(连线) */
export interface EdgeTokens {
  /** 默认边色 */
  color: string;
  /** 选中态边色 */
  selectedColor: string;
  /** 悬浮态边色 */
  hoverColor: string;
  /** 临时连线色(拖拽中) */
  pendingColor: string;
}

/** 主题配置(分 4 类 token + edge) */
export interface ThemeConfig {
  mode: ThemeMode;
  canvas: CanvasTokens;
  node: NodeTokens;
  toolbar: ToolbarTokens;
  group: GroupTokens;
  edge: EdgeTokens;
}

/**
 * 暗色主题（2026-08-31 用户拍板：全站统一画布背景色 #11110f，无棕无黑折腾）
 * 工具栏/面板/节点内容底色全部与画布一致；分隔描边用中性灰 #404040（无棕）。
 */
export const DARK_THEME: ThemeConfig = {
  mode: 'dark',
  canvas: {
    background: '#11110fff',
    gridColor: 'rgba(245,245,244,.10)',
    gridColorSubtle: 'rgba(245,245,244,.05)',
    gridDot: 'rgba(245,245,244,.24)',
    gridLine: 'rgba(245,245,244,.10)',
  },
  node: {
    fill: '#161616',
    defaultColor: '#e94560',
    outlineColor: '#78716c',
    outlineSelectedColor: '#e94560',
    hoverColor: '#f06580',
    titleColor: '#f5f5f4',
    titleBackground: 'transparent',
    contentBackground: '#11110f',
    pinDefaultColor: '#a8a29e',
  },
  toolbar: {
    background: '#11110f',
    panel: 'rgba(17,17,15,0.96)',
    border: '#404040',
    text: '#f5f5f4',
    textMuted: '#a8a29e',
    accent: '#e94560',
    danger: '#ff6b6b',
    editorSurface: '#141414',
    editorPaper: '#141414',
  },
  group: {
    background: 'rgba(233,69,96,0.08)',
    outlineColor: 'rgba(233,69,96,0.5)',
    outlineSelectedColor: '#e94560',
    titleColor: '#d6d3d1',
  },
  edge: {
    color: 'rgba(255,255,255,0.55)',
    selectedColor: '#e94560',
    hoverColor: '#e94560',
    pendingColor: '#e94560',
  },
};

export const LIGHT_THEME: ThemeConfig = {
  mode: 'light',
  canvas: {
    background: '#ffffff',
    gridColor: 'rgba(68,64,60,.12)',
    gridColorSubtle: 'rgba(68,64,60,.06)',
    gridDot: 'rgba(68,64,60,.28)',
    gridLine: 'rgba(68,64,60,.12)',
  },
  node: {
    fill: '#f0ece4',
    defaultColor: '#e94560',
    outlineColor: '#a8a29e',
    outlineSelectedColor: '#e94560',
    hoverColor: '#f06580',
    titleColor: '#292524',
    titleBackground: 'transparent',
    contentBackground: '#fafaf7',
    pinDefaultColor: '#78716c',
  },
  toolbar: {
    background: '#ffffff',
    panel: 'rgba(248,246,242,0.96)',
    border: '#e0dcd6',
    text: '#292524',
    textMuted: '#78716c',
    accent: '#e94560',
    danger: '#dc2626',
    editorSurface: '#f5f4f2',
    editorPaper: '#f5f2e8',
  },
  group: {
    background: 'rgba(233,69,96,0.06)',
    outlineColor: 'rgba(233,69,96,0.4)',
    outlineSelectedColor: '#e94560',
    titleColor: '#1c1917',
  },
  edge: {
    color: 'rgba(0,0,0,0.35)',
    selectedColor: '#e94560',
    hoverColor: '#e94560',
    pendingColor: '#e94560',
  },
};

/** 主题映射表 */
export const THEMES: Record<ThemeMode, ThemeConfig> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};

/**
 * @deprecated 使用 ThemeConfig / DARK_THEME / LIGHT_THEME 代替
 */
export const DEFAULT_THEME = {
  background: DARK_THEME.canvas.background,
  gridColor: DARK_THEME.canvas.gridColor,
  nodeDefaultColor: DARK_THEME.node.defaultColor,
  selectedColor: DARK_THEME.node.outlineSelectedColor,
  hoverColor: DARK_THEME.node.hoverColor,
  edgeColor: DARK_THEME.edge.color,
};