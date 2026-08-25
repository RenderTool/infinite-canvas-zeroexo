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

// ===== DSL v2：视频生成协议描述（可选，缺省时适配器按默认行为执行） =====

/** 请求体组装风格 */
export type BodyStyle = 'flat' | 'content';

/** 参考素材传参格式 */
export type ReferenceFormat = 'url' | 'base64';

/**
 * 请求体结构描述（DSL v2）
 * - flat:    现有 paramMapping 平铺模式（默认，无需配置）
 * - content: Seedance 风格 content:[{type, text/image_url/..., role}] 数组
 */
export interface RequestSchema {
  /** 请求体组装风格，缺省 flat */
  bodyStyle?: BodyStyle;
  /** content 风格下各素材类型的 role 名 */
  contentRoles?: {
    /** 参考图 role（首尾帧模式的尾帧） */
    image?: string;
    /** 首帧 role（首尾帧模式第一张图） */
    firstFrame?: string;
    /** 尾帧 role（首尾帧模式第二张图起） */
    lastFrame?: string;
    /** 参考视频 role */
    video?: string;
    /** 参考音频 role */
    audio?: string;
    /** 哪些前端 mode 值使用首尾帧 role 分配（其余 mode 的图用 image role），缺省 ["image-to-video-first-last-frame"] */
    firstLastModes?: string[];
  };
  /** 参考素材传参格式：url 直传（默认）或 base64 内嵌 */
  referenceFormat?: ReferenceFormat;
}

/** 同步响应解析协议（DSL v2） */
export interface SyncProtocol {
  /** 结果提取路径，如 "data[0].url" / "data[0].b64_json" */
  resultPath: string;
  /** 结果字段名（与 resultPath 二选一，取到后写入 GenerateResult） */
  field?: string;
}

/** 异步任务协议（DSL v2）：提交 → 轮询 → 提取结果 */
export interface TaskProtocol {
  /** 提交响应中任务 ID 的提取路径，如 "id" */
  submitIdPath: string;
  /** 轮询 URL 模板（相对 baseUrl），{id} 会被替换为任务 ID，如 "/v1/videos/{id}" */
  pollUrlTemplate: string;
  /** 轮询响应中的状态字段路径，如 "status" */
  statusPath: string;
  /** 成功状态值列表 */
  successValues: string[];
  /** 失败状态值列表 */
  failureValues: string[];
  /** 成功响应中结果提取路径，如 "data[0].url" */
  resultPath: string;
  /** 轮询间隔（ms），缺省 5000 */
  pollIntervalMs?: number;
  /** 最长轮询时间（ms），缺省 600000 */
  maxPollMs?: number;
}

/** 认证方式（DSL v2），缺省 Bearer apiKey */
export type AuthType = 'bearer' | 'header' | 'kling-hmac';

/** HMAC 签名器配置（auth.type=kling-hmac 时生效） */
export interface SignerConfig {
  /** 签名结果放入的请求头名，如 "Authorization" */
  headerName: string;
  /** 签名值格式模板，占位符 {ak}/{sk}/{timestamp}，如 "{ak}.{timestamp}.{signature}" */
  format: string;
  /** 签名算法，目前仅支持 hmac-sha256 */
  alg: 'hmac-sha256';
}

export interface AuthConfig {
  /** 认证类型 */
  type: AuthType;
  /** auth.type=header 时的 API Key 请求头名（缺省 X-Api-Key） */
  apiKeyHeader?: string;
  /** auth.type=header 时是否同时把 API Key 作为 Bearer 发送（中转常见） */
  alsoBearer?: boolean;
  /** auth.type=kling-hmac 时的签名器配置 */
  signer?: SignerConfig;
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

  // ===== DSL v2（视频生成协议，可选） =====
  /** 请求体结构描述 */
  request?: RequestSchema;
  /** 同步响应解析协议（无 task 时生效） */
  sync?: SyncProtocol;
  /** 异步任务协议（提交→轮询→提取） */
  task?: TaskProtocol;
  /** 认证方式（缺省 Bearer apiKey） */
  auth?: AuthConfig;

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
