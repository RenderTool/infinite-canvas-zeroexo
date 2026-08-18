/**
 * ModelConfig 类型定义
 *
 * 从 zeroexo_front/src/features/ai-config/utils/model-utils.ts 提取
 * 包含 ModelConfig、ModelCapability 等与后端 provider-presets.ts 对齐的类型
 */

// ===== 类型 =====

/**
 * 模型能力/模式/规格元数据(与后端 provider-presets.ts 的 ModelConfig 一致)
 * - capabilities: 能力类型 'image' | 'video' | 'audio' | 'text' | 'llm'
 * - supportedModes: 视频模型支持的生成模式
 * - inputTypes: 模型支持的输入类型（如 'text' | 'image' 等）
 * - specs: 规格配置(分辨率/比例/时长/音色等,结构因模型而异)
 */
export interface ModelConfig {
  name: string;
  capabilities: string[];
  supportedModes?: string[];
  inputTypes?: string[];
  specs?: Record<string, unknown>;
}

export type ModelCapability = 'image' | 'video' | 'text' | 'audio';

export type ApiCallFormat = 'openai' | 'gemini';

export interface ModelChannel {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiFormat: ApiCallFormat;
  /** 品牌标识（如 "openai"、"deepseek"、"volcengine"），用于查找默认品牌图标 */
  provider: string;
  /** 模型名列表(从 modelConfigs 提取或独立声明) */
  models: string[];
  /** 模型能力/模式/规格元数据(来自后端 config.models,可选) */
  modelConfigs?: ModelConfig[];
  /** 模型图标映射（modelId → provider key），由 admin 配置，与 BRAND_ICONS 配合使用 */
  modelIcons?: Record<string, string>;
}

export interface AiConfig {
  channels: ModelChannel[];
  /** 默认模型(编码后的 "channelId::model" 格式) */
  imageModel: string;
  videoModel: string;
  textModel: string;
  audioModel: string;
}