/** SSE Agent 事件负载 */
export interface AgentEvent {
  type:
    | 'agent:step'
    | 'agent:tool_call'
    | 'agent:tool_result'
    | 'agent:progress'
    | 'agent:complete'
    | 'agent:error'
    // 契约交互事件（Plan#33 D1: step/question/md 三大契约 UI）
    | 'agent:step_request'
    | 'agent:question_request'
    // 节点参数契约表单（R3 F1）
    | 'agent:params_request'
    | 'agent:md'
    // 增量渲染事件（Plan#36 P0-1: 流式对话）
    | 'agent:message_delta'
    | 'agent:thinking_delta'
    // 执行流程引擎事件（Plan#36 R2-5: Codex 式 phase）
    | 'agent:phase'
    | 'agent:plan'
    | 'agent:upload_request'
    | 'agent:brief';
  data: unknown;
  timestamp: number;
}

/** 执行阶段（Plan#36 R2-5）：前端按 phase 渲染对应面板 */
export type AgentPhase = 'thinking' | 'clarify' | 'planning' | 'executing' | 'reporting';

/** 执行计划数据（plan_present 协议工具 → PlanBlock） */
export interface PlanData {
  goal: string;
  steps: Array<{
    id: string;
    label: string;
    /** 预期产物 */
    deliverable?: string;
    /** 风险标注 */
    risk?: string;
  }>;
  /** 全局风险提示 */
  risks?: string[];
}

/** 上传请求数据（request_upload 协议工具 → UploadBlock） */
export interface UploadRequestData {
  guideText?: string;
  /** 接受的文件类型（如 .txt,.md,.docx） */
  accept?: string;
  multiple?: boolean;
}

/** 任务简报数据（emit_brief 协议工具 → BriefBlock） */
export interface BriefData {
  /** 成果摘要 */
  summary: string;
  /** 产出节点引用（点击聚焦画布节点） */
  nodeRefs?: Array<{ nodeId: string; label: string }>;
  /** 待审核声明/后续引导 */
  note?: string;
}

/** step 接口数据（StepBlock 契约 UI） */
export interface StepRequestData {
  key: string;
  title: string;
  description?: string;
  /** 是否必选（false = 资料足够可跳过） */
  required?: boolean;
  /** 引导提示：资料不足时引导上传/引用画布节点收敛目标 */
  prompts?: string[];
  /** 快捷选项（如"直接生成 N 集"） */
  suggestions?: Array<{ value: string; label: string }>;
  /** 是否附用户备注输入框（Plan#36 R2-5） */
  noteEnabled?: boolean;
}

/** 提问接口数据（QuestionBlock 契约 UI，与前端 QuestionData 对齐） */
export interface QuestionRequestData {
  guideText?: string;
  /** 是否多选 */
  multi?: boolean;
  items: Array<{
    value: string;
    label: string;
    desc?: string;
    ai?: boolean;
    checked?: boolean;
  }>;
}

/** 参数表单字段（R3 F1 节点参数契约 → ParamsBlock；类型体系对齐 admin ParameterDef，2026-08-23 修订） */
export interface ParamFieldData {
  /** 字段键（对齐生成参数：quality/size/count/vquality/seconds/voice/format…；兼容旧协议 key） */
  name: string;
  label: string;
  /** 字段类型：enum=枚举（≤5 项 radio 胶囊 / >5 项下拉）/ number / boolean / size=宽高联动 / string=多行文本 / images=参考图（兼容旧协议 select→enum、text→string） */
  type: 'enum' | 'number' | 'boolean' | 'size' | 'string' | 'images' | 'select' | 'text';
  /** 默认值 */
  default?: any;
  /** type=enum：可选项（缺省时前端兜底） */
  values?: string[];
  /** type=enum：选项显示名映射（如 auto → AUTO） */
  labels?: Record<string, string>;
  /** type=enum：展示形式（缺省 ≤5 项 radio、>5 项 select） */
  display?: 'radio' | 'select';
  /** type=enum：选项 tooltip（如 AUTO 按钮说明） */
  valueTooltips?: Record<string, string>;
  /** type=number：数值边界 */
  min?: number;
  max?: number;
  step?: number;
  /** type=images：参考图最大数量 */
  maxCount?: number;
  /** 字段 tooltip（label 旁说明） */
  tooltip?: string;
  placeholder?: string;
  required?: boolean;
  /** 兼容旧协议：options（select 类型） */
  options?: Array<{ label: string; value: string }>;
  /** 兼容旧协议：字段说明 */
  desc?: string;
}

/** 参数表单自动方案（点击一键填入 fields） */
export interface ParamPresetData {
  name: string;
  desc?: string;
  values: Record<string, string | number | boolean>;
}

/** 节点参数契约表单数据（request_params 协议 → ParamsBlock） */
export interface ParamsRequestData {
  /** 目标节点类型（image/video/audio/text/script/storyboard…） */
  nodeType: string;
  /** 表单标题（引导文案） */
  title?: string;
  /** 标准参数选项表单字段 */
  fields?: ParamFieldData[];
  /** 「自动」方案（点击填入 fields，可多套） */
  presets?: ParamPresetData[];
  /** 备注输入框标签 */
  noteLabel?: string;
}
