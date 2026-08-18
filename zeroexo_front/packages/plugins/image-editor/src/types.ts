/**
 * 图片编辑器类型定义
 */

/** 图片裁剪矩形(归一化 0-1 比例,非像素) */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 切分参数(行列网格,支持手动微调分割线) */
export interface SplitParams {
  rows: number;
  columns: number;
  /** 列分割线归一化位置(0–1,升序),长度 = columns-1;缺省 = 均匀分割 */
  columnBreaks?: number[];
  /** 行分割线归一化位置(0–1,升序),长度 = rows-1;缺省 = 均匀分割 */
  rowBreaks?: number[];
}

/** 放大算法 */
export type UpscaleAlgorithm = 'high' | 'bilinear' | 'nearest';

/** 放大参数 */
export interface UpscaleParams {
  targetLongEdge: number;
  algorithm: UpscaleAlgorithm;
}

/** 蒙版编辑输出(透明=修改区,白色=保留区) */
export interface MaskEditPayload {
  prompt: string;
  maskDataUrl: string;
}

/** 多角度参数 */
export interface AngleParams {
  horizontalAngle: number;
  pitchAngle: number;
  cameraDistance: number;
  wideAngle: boolean;
}

/** 图片元信息 */
export interface ImageMeta {
  width: number;
  height: number;
}

/** 工具栏配置(持久化到 localStorage) */
export interface ImageQuickToolsConfig {
  /** 可见工具 id 顺序 */
  ids: ImageQuickToolId[];
  /** 是否显示标签 */
  showLabels: boolean;
  /** 是否自动换行 */
  autoWrap: boolean;
  /** 最大行数(1-5) */
  maxLines: number;
}

/** 基础工具 id(工具栏固定,不参与自定义) */
export type ImageBaseToolId = 'info' | 'delete' | 'saveAsset' | 'download' | 'edit';

/** 可定制工具 id(参与工具栏自定义) */
export type ImageActionToolId =
  | 'copyPrompt'
  | 'reversePrompt'
  | 'replace'
  | 'resize'
  | 'maskEdit'
  | 'crop'
  | 'split'
  | 'upscale'
  | 'superResolve'
  | 'angle'
  | 'view';

/** 全部工具 id */
export type ImageQuickToolId = ImageBaseToolId | ImageActionToolId;

/** 默认可见的可定制工具(defaultVisible: true) */
export const DEFAULT_VISIBLE_ACTION_IDS: ImageActionToolId[] = [
  'copyPrompt',
  'reversePrompt',
  'replace',
  'maskEdit',
  'crop',
  'split',
  'upscale',
  'view',
];

/** 默认基础工具(固定显示) */
export const BASE_TOOL_IDS: ImageBaseToolId[] = ['info', 'delete', 'saveAsset', 'download', 'edit'];

/** 默认工具栏配置 */
export const DEFAULT_TOOLS_CONFIG: ImageQuickToolsConfig = {
  ids: [...BASE_TOOL_IDS, ...DEFAULT_VISIBLE_ACTION_IDS],
  showLabels: true,
  autoWrap: false,
  maxLines: 2,
};

/** localStorage key(版本化,ZeroExo v1) */
export const TOOLS_STORAGE_KEY = 'zeroexo-image-quick-tools-v1';

/** 放大目标档位 */
export const UPSCALE_TARGETS = [
  { label: '1K', value: 1024 },
  { label: '2K', value: 2048 },
  { label: '4K', value: 4096 },
] as const;

/** 放大算法选项 */
export const UPSCALE_ALGORITHMS = [
  { value: 'high' as const, title: '高清插值', description: '适合照片和细节图' },
  { value: 'bilinear' as const, title: '双线性', description: '平滑、速度快' },
  { value: 'nearest' as const, title: '最近邻', description: '适合像素风格' },
];

/** 放大长边上限 */
export const MAX_UPSCALE_LONG_EDGE = 4096;
