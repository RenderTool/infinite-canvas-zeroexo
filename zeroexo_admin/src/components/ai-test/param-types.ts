/**
 * AI 图像参数系统 — 前端新类型定义
 *
 * 与后端 model-templates.types.ts 对齐，用于装配模式渲染器。
 */

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
  labels?: Record<string, string>;
  display?: ParamDisplay;
  /** 每个枚举值对应的 tooltip（如 AUTO 按钮说明） */
  valueTooltips?: Record<string, string>;

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
  supportsImageToImage?: boolean;
}

/** 渠道约束 */
export interface ChannelConstraints {
  bounds?: ConstraintsBounds;
  paramMapping?: Record<string, string>;
  valueMapping?: Record<string, Record<string, any>>;
}

/** 持久化的参数配置（存在 DB provider.config.modelSchemas 中） */
export interface PersistedParamConfig {
  templateId: string;
  parameters: ParameterDef[];
  channelConstraints?: ChannelConstraints;
  enabledParams: string[];
  paramOverrides?: Record<string, any>;
  version: number;
  lastAppliedTemplateId: string;
  lastAppliedAt: string;
}

/** 渲染器 Props */
export interface ParamRendererProps {
  param: ParameterDef;
  value: any;
  onChange: (name: string, value: any) => void;
  constraints?: ChannelConstraints;
  /** 所有参数的当前值，用于交叉引用（如 size 联动） */
  allValues?: Record<string, any>;
  /** 宽高比可选值列表，供 SizeRenderer 联动使用 */
  aspectOptions?: string[];
}

/** 渲染器组件类型 */
export type ParamRenderer = React.FC<ParamRendererProps>;
