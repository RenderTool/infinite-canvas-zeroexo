/**
 * 模型模板类型定义
 *
 * 模板结构：
 *   元信息（id/name/protocol/endpoint）
 *     → parameters[]（纯参数声明）
 *     → channelConstraints（渠道约束：数值边界 + 名/值映射）
 */

/** 模型类型 */
export type ModelType = 'llm' | 'image' | 'video' | 'audio';

/** 协议格式 */
export type ApiProtocol = 'openai' | 'anthropic' | 'gemini' | 'custom';

/** 参数类型 */
export type ParamType =
  | 'enum'      // 下拉框 / 单选按钮组（见 display 字段）
  | 'number'    // 数字输入框
  | 'boolean'   // 开关
  | 'size'      // 宽×高双输入框
  | 'string'    // 文本输入（兜底）
  | 'images';   // 图片上传（参考图）

/** 枚举参数的展示形式 */
export type ParamDisplay = 'radio' | 'select';

/** 单个参数定义 */
export interface ParameterDef {
  name: string;
  type: ParamType;
  label: string;
  default: any;

  // type=enum 时
  values?: string[];
  labels?: Record<string, string>;  // 覆盖默认的自动派生 label
  display?: ParamDisplay;           // 显式指定 radio/select
                                    // 未指定时启发式：≤5 项用 radio，>5 项用 select

  // type=number 时
  min?: number;
  max?: number;
  step?: number;

  // type=images 时
  maxCount?: number;

  tooltip?: string;
  placeholder?: string;
  required?: boolean;
}

/** 渠道约束：数值边界 */
export interface ConstraintsBounds {
  minTotalPixels?: number;
  maxTotalPixels?: number;
  minAspectRatio?: number;
  maxAspectRatio?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  maxEdgeLength?: number;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  minDuration?: number;
  maxDuration?: number;
  supportsImageToImage?: boolean;
}

/** 渠道约束 */
export interface ChannelConstraints {
  /** 数值边界 */
  bounds?: ConstraintsBounds;

  /** 参数名映射：前端参数名 → API 字段名 */
  paramMapping?: Record<string, string>;

  /** 参数值映射：前端值 → API 值 */
  valueMapping?: Record<string, Record<string, any>>;
}

/** 模型模板 */
export interface ModelTemplate {
  id: string;
  name: string;
  protocol: ApiProtocol;
  modelType: ModelType;
  endpoint: string;

  /** 参数声明 */
  parameters: ParameterDef[];
  /** 提示词最大字符数（0 或未定义表示不限制） */
  maxPromptLength?: number;
  /** 渠道约束 */
  channelConstraints?: ChannelConstraints;

  /** 是否作为兜底模板（协议级模板） */
  fallback?: boolean;

  /** 定价（可选） */
  pricing?: {
    input?: number;
    output?: number;
    perImage?: number;
    perSecond?: number;
  };

  /** 匹配关键词（用于自动推荐模板） */
  matchKeywords?: string[];
}

/** 持久化的参数配置（存在 DB provider.config.modelSchemas 中） */
export interface PersistedParamConfig {
  /** 来源模板 ID */
  templateId: string;
  /** 参数定义快照 */
  parameters: ParameterDef[];
  /** 渠道约束快照 */
  channelConstraints?: ChannelConstraints;
  /** 用户勾选了哪些参数 */
  enabledParams: string[];
  /** 用户改过的默认值 */
  paramOverrides?: Record<string, any>;
  /** 版本号 */
  version: number;
  /** 上一次应用模板的时间戳 */
  lastAppliedTemplateId: string;
  lastAppliedAt: string;
}

/** 品牌配置包（Brand Preset Pack） */
export interface BrandPresetPack {
  id: string;
  provider: string;
  name: string;
  version: string;
  official: boolean;
  label: string;
  color: string;
  description: string;
  updatedAt: string;
  baseConfig: {
    apiFormat: ApiProtocol;
    defaultBaseUrl: string;
    capabilities: ModelType[];
  };
}
