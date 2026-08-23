/**
 * AI Provider 类型定义
 *
 * 抽象 AI 生成能力(图片/文本/视频/音频),业务节点通过此接口调用 AI 服务。
 * Phase 7 实现 DirectProvider(前端直连) 和 ProxyProvider(后端代理)。
 */

// ===== 图片生成 =====

/**
 * 生成引用快照项(征集#43 方案 A):提交生成时随请求携带,
 * 后端写入 AiGeneration.params._inputs,供"一键同款"复原生成链路。
 * 失效判定见复原侧(节点被删/资产被清理/跨画布)。
 */
export interface GenerationInputRef {
  nodeId: string;
  nodeType: string;
  assetStorageKey?: string;
  title?: string;
  /** 文本类引用的内容存档(截断),供引用节点被删后重建复原 */
  textPreview?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  count: number;
  /** 参考图(dataUrl 或公网 URL 列表),图生图时传入,由后端适配器转换后提交 */
  referenceImages?: string[];
  /** 生成引用快照(连入节点摘要),供溯源与一键同款 */
  inputs?: GenerationInputRef[];
  /** 模板参数(契约参数模块:resolution/aspectRatio/size/watermark 等,原样透传后端适配器;存在时优先于 size/quality/count) */
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ImageEditRequest extends ImageGenerationRequest {
  /** 参考图(dataUrl 或 url 列表) */
  referenceImages: string[];
}

export interface GeneratedImage {
  dataUrl: string;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
  /** 后端生成记录 id(成功后回写节点,供溯源/一键同款) */
  generationId?: string;
}

// ===== 文本生成 =====

export interface TextGenerationRequest {
  prompt: string;
  model: string;
  /** 参考图(多模态问答) */
  referenceImages?: string[];
  /** 模型额外参数 */
  params?: Record<string, unknown>;
  /** 指定渠道 ID(后端代理模式下,用于选择用户配置的渠道) */
  providerId?: string;
  signal?: AbortSignal;
}

// ===== 视频生成 =====

/** Seedance 参考视频 */
export interface ReferenceVideo {
  url?: string;
  dataUrl?: string;
  storageKey?: string;
  durationMs?: number;
}

/** Seedance 参考音频 */
export interface ReferenceAudio {
  url?: string;
  dataUrl?: string;
  storageKey?: string;
  durationMs?: number;
}

export interface VideoGenerationRequest {
  prompt: string;
  model: string;
  size: string;
  seconds: number;
  vquality: string;
  generateAudio: boolean;
  watermark: boolean;
  signal?: AbortSignal;
  /** 生成引用快照(连入节点摘要),供溯源与一键同款 */
  inputs?: GenerationInputRef[];
  /** 模板参数(契约参数模块:mode/resolution/ratio/duration 等,原样透传后端适配器;存在时优先于 size/seconds/vquality) */
  params?: Record<string, unknown>;
  /** Seedance 参考图(dataUrl 或公网 URL) */
  referenceImages?: string[];
  /** Seedance 参考视频 */
  referenceVideos?: ReferenceVideo[];
  /** Seedance 参考音频 */
  referenceAudios?: ReferenceAudio[];
}

export interface GeneratedVideo {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
  mimeType: string;
  bytes: number;
  /** 后端生成记录 id(成功后回写节点,供溯源/一键同款) */
  generationId?: string;
}

// ===== 音频生成 =====

export interface AudioGenerationRequest {
  prompt: string;
  model: string;
  voice: string;
  format: string;
  speed: number;
  instructions?: string;
  signal?: AbortSignal;
  /** 生成引用快照(连入节点摘要),供溯源与一键同款 */
  inputs?: GenerationInputRef[];
  /** 模板参数(契约参数模块:voice/audioFormat/audioSpeed/audioInstructions 等,原样透传后端适配器) */
  params?: Record<string, unknown>;
}

export interface GeneratedAudio {
  blob: Blob;
  durationMs: number;
  mimeType: string;
  bytes: number;
  /** 后端生成记录 id(成功后回写节点,供溯源/一键同款) */
  generationId?: string;
}

// ===== 生成状态 =====

export type GenerationStatus = 'idle' | 'loading' | 'success' | 'error';

// ===== 节点元数据(业务节点通用) =====

/** 图片节点数据 */
export interface ImageNodeData {
  /** BUG4: 节点显示名称(自增编号如"图片1",创建时设置) */
  title?: string;
  prompt: string;
  content: string;
  status: GenerationStatus;
  errorDetails?: string;
  /** P3.5: 错误分类(供前端展示错误图标) */
  errorType?: import('./ai-error.js').AiErrorType;
  /** 生成中任务信息(渠道 · 模型),由 editor-page 生成时写入,供节点内展示 */
  taskLabel?: string;
  model?: string;
  size?: string;
  quality?: string;
  count?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
  freeResize?: boolean;
  generationType?: 'generation' | 'edit';
  references?: string[];
  /** 后端生成记录 id(生成成功后回写,供溯源/一键同款) */
  generationId?: string;
}

/** 文本节点数据 */
export interface TextNodeData {
  /** BUG4: 节点显示名称(自增编号如"文本1",创建时设置) */
  title?: string;
  content: string;
  prompt: string;
  status: GenerationStatus;
  errorDetails?: string;
  /** P3.5: 错误分类 */
  errorType?: import('./ai-error.js').AiErrorType;
  /** 节点透明度(0.1~1.0),默认 1.0 */
  opacity?: number;
}

/** 视频节点数据 */
export interface VideoNodeData {
  /** BUG4: 节点显示名称(自增编号如"视频1",创建时设置) */
  title?: string;
  prompt: string;
  content: string;
  status: GenerationStatus;
  errorDetails?: string;
  /** P3.5: 错误分类 */
  errorType?: import('./ai-error.js').AiErrorType;
  /** 生成中任务信息(渠道 · 模型),由 editor-page 生成时写入,供节点内展示 */
  taskLabel?: string;
  model?: string;
  size?: string;
  seconds?: number;
  vquality?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
  durationMs?: number;
  references?: string[];
  /** BUG8.5: 视频生成模式(Seedance 专用,影响参考素材连接引导)
   *  - text-to-video: 文生视频(无参考)
   *  - image-to-video: 图生视频(1 张参考图作首帧)
   *  - first-last-frame: 首尾帧(2 张参考图:首帧+尾帧)
   *  - all-reference: 全能参考(多图/多视频/多音频)
   *  - image-reference: 图片参考(多张参考图) */
  videoMode?: VideoGenerationMode;
  /** 渐进式缩略图(首帧 base64 dataUrl),非播放状态时使用轻量 <img> 替代 <video> */
  thumbnailUrl?: string;
  /** 截帧捕获的图片(base64 dataUrl),由截帧工具写入 */
  capturedFrame?: string;
  /** 后端生成记录 id(生成成功后回写,供溯源/一键同款) */
  generationId?: string;
}

/** BUG8.5: Seedance 视频生成模式 */
export type VideoGenerationMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'first-last-frame'
  | 'all-reference'
  | 'image-reference';

/** 音频节点数据 */
export interface AudioNodeData {
  /** BUG4: 节点显示名称(自增编号如"音频1",创建时设置) */
  title?: string;
  prompt: string;
  content: string;
  status: GenerationStatus;
  errorDetails?: string;
  /** P3.5: 错误分类 */
  errorType?: import('./ai-error.js').AiErrorType;
  /** 生成中任务信息(渠道 · 模型),由 editor-page 生成时写入,供节点内展示 */
  taskLabel?: string;
  model?: string;
  voice?: string;
  audioFormat?: string;
  audioSpeed?: number;
  audioInstructions?: string;
  storageKey?: string;
  mimeType?: string;
  bytes?: number;
  durationMs?: number;
  /** 预计算波形数据(60 柱振幅值),避免每次挂载重复 fetch+decode */
  waveformData?: number[];
  /** 后端生成记录 id(生成成功后回写,供溯源/一键同款) */
  generationId?: string;
}

// ===== DirectProvider 配置(Phase VI.5-VI.8) =====

/** 解析后的请求配置(已从渠道编码解码为真实值) */
export interface ResolvedConfig {
  baseUrl: string;
  apiKey: string;
  apiFormat: 'openai' | 'gemini';
  /** 解码后的模型名(不含 channelId:: 前缀) */
  model: string;
  /** 可选系统提示词(全局) */
  systemPrompt?: string;
}

/**
 * DirectProvider 的配置提供者
 *
 * 由 app 层注入,将 `"channelId::model"` 编码值解析为真实请求配置。
 * DirectProvider 不直接依赖 app 层的 AiConfig store,通过此接口解耦。
 */
export interface ConfigProvider {
  /** 解析编码模型值 → 真实请求配置 */
  resolveConfig(modelValue: string): ResolvedConfig;
  /** 检查 Provider 是否已配置(至少一个渠道有 API Key) */
  isReady(): boolean;
}
