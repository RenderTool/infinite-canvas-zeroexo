/**
 * canvas-agent/ui/types.ts — 新 Agent UI 类型定义
 *
 * 与画布_Agent_升级方案_0110f363.md 第十五节对齐。
 * CanvasPatch 的 ops 复用 @zeroexo/shared 的 CanvasOp 类型。
 */

import type { CanvasOp } from '@zeroexo/shared';

// ===== SSE 事件（后端 agent-sse.service.ts 使用 agent:xxx 前缀） =====

/** 后端 SSE 事件类型（带 agent: 前缀） */
export type BackendSSEEventType =
  | 'agent:thinking'
  | 'agent:tool_call'
  | 'agent:clarify_request'
  | 'agent:canvas_request'
  | 'agent:plan'
  | 'agent:confirm_request'
  | 'agent:canvas_patch'
  | 'agent:gen_progress'
  | 'agent:result'
  | 'agent:error'
  | 'agent:done'
  | 'agent:message_delta'
  | 'agent:thinking_delta';

/** 方案定稿的 SSE 事件名（无前缀，AgentClient 内部做映射） */
export type CanvasAgentEventType =
  | 'thinking'
  | 'tool_call'
  | 'clarify_request'
  | 'canvas_request'
  | 'plan'
  | 'confirm_request'
  | 'canvas_patch'
  | 'gen_progress'
  | 'result'
  | 'error'
  | 'done'
  | 'message_delta'
  | 'thinking_delta';

/** 后端到方案的映射表 */
export const BACKEND_TO_CANVAS_EVENT: Record<BackendSSEEventType, CanvasAgentEventType> = {
  'agent:thinking': 'thinking',
  'agent:tool_call': 'tool_call',
  'agent:clarify_request': 'clarify_request',
  'agent:canvas_request': 'canvas_request',
  'agent:plan': 'plan',
  'agent:confirm_request': 'confirm_request',
  'agent:canvas_patch': 'canvas_patch',
  'agent:gen_progress': 'gen_progress',
  'agent:result': 'result',
  'agent:error': 'error',
  'agent:done': 'done',
  'agent:message_delta': 'message_delta',
  'agent:thinking_delta': 'thinking_delta',
};

// ===== 消息块类型（5 种原生 + step/md 契约块） =====

export type CanvasAgentMessageType =
  | 'text'
  | 'question'
  | 'clarify'
  | 'plan'
  | 'progress'
  | 'step'
  | 'md'
  | 'timeline'
  // Plan#36 R2-5: 执行流程引擎新消息块
  | 'upload'
  | 'brief'
  // R3-D3: 删除调皮回应（气泡内嵌选项，非弹窗）
  | 'reminder'
  // R3-F1: 节点参数契约表单（request_params → ParamsBlock）
  | 'params';

/** 消息角色 */
export type MessageRole = 'agent' | 'user';

/** 附件卡片（R3 FIX-1/2：气泡忠实还原，禁止展开成纯文本） */
export interface AttachmentCard {
  name: string;
  size: number;
  isText: boolean;
  /** 是否截断（仅存预览） */
  truncated?: boolean;
  /** 原文总字数（truncated 时有效） */
  totalChars?: number;
  /** 资产库 assetId（A1 落库后填充，可点击跳转） */
  assetId?: string;
  /** 内联预览片段（≤500 字，卡片展开用） */
  preview?: string;
}

/** R3-D3：被删除的 Agent 节点快照（补回来时重建用） */
export interface DeletedNodeSnapshot {
  nodeId: string;
  type: string;
  title?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  data: Record<string, unknown>;
}

/** R3-D3：删除调皮回应数据（reminder 消息） */
export interface ReminderData {
  /** 被删的 Agent 节点数（批量只问一次） */
  deletedCount: number;
  /** 节点快照（供「补回来」重建） */
  snapshots: DeletedNodeSnapshot[];
}

// ===== R3-F1 节点参数契约（request_params → ParamsBlock） =====

/** 参数表单字段（类型体系对齐 admin ParameterDef，2026-08-23 修订；兼容旧协议 select/text 与 key/options/desc） */
export interface ParamFieldData {
  /** 字段键（对齐生成参数：quality/size/count/vquality/seconds/voice/format…；兼容旧协议 key） */
  name: string;
  label: string;
  /** enum=枚举（≤5 项 radio 胶囊 / >5 项下拉）/ number / boolean / size=宽高联动 / string=多行文本 / images=参考图 */
  type: 'enum' | 'number' | 'boolean' | 'size' | 'string' | 'images' | 'select' | 'text';
  default?: any;
  /** type=enum：可选项值列表 */
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
  /** 兼容旧协议：options（select 类型）与 desc */
  options?: Array<{ label: string; value: string }>;
  desc?: string;
}

/** 参数表单「自动」方案（点击一键填入 fields） */
export interface ParamPresetData {
  name: string;
  desc?: string;
  values: Record<string, string | number | boolean>;
}

/** 节点参数契约表单数据 */
export interface ParamsRequestData {
  /** 目标节点类型 */
  nodeType: string;
  /** 表单标题（引导文案） */
  title?: string;
  /** 标准参数选项表单字段 */
  fields?: ParamFieldData[];
  /** 「自动」方案（可多套） */
  presets?: ParamPresetData[];
  /** 备注输入框标签 */
  noteLabel?: string;
}

/** 泛型消息 */
export interface CanvasAgentMessage {
  id: string;
  role: MessageRole;
  type: CanvasAgentMessageType;
  text?: string;
  /** R3：用户消息携带的附件卡片（落库为 [附件清单:JSON] 标记，加载时还原） */
  attachments?: AttachmentCard[];
  /** R3-D3：删除调皮回应数据（reminder 类型消息） */
  reminder?: ReminderData;
  /** R3-D3：气泡选项已回应（回应后渲染结果态，不再重复询问） */
  reminderAnswered?: 'restored' | 'refused';
  /** R3-F1：节点参数契约表单数据（params 类型消息） */
  params?: ParamsRequestData;
  /** R3-F1：参数表单已提交（提交后渲染结果态） */
  paramsAnswered?: boolean;
  /** 问题/选项数据 */
  question?: QuestionData;
  /** 澄清项列表 */
  clarifyItems?: ClarifyItem[];
  /** 执行计划 */
  plan?: PlanData;
  /** 进度数据 */
  progress?: ProgressData;
  /** step 接口数据 */
  step?: StepData;
  /** 执行时间线（P0-4 工具调用时间线） */
  timeline?: TimelineData;
  /** 执行计划卡（R2-5 plan_present） */
  planCard?: AgentPlanData;
  /** 对话内上传卡（R2-5 request_upload） */
  upload?: UploadCardData;
  /** 任务简报卡（R2-5 emit_brief） */
  brief?: BriefCardData;
  /** 关联步骤 */
  stepKey?: string;
  timestamp: number;
  /** 业务扩展字段 */
  meta?: Record<string, unknown>;
  /** 交互消息是否已被用户回答（历史还原时检测） */
  answered?: boolean;
  /** 历史还原：从后续用户消息中解析出的答案原文 */
  restoredAnswer?: string;
}

// ===== step 接口（StepBlock 契约 UI, Plan#33 D1/D2） =====

export interface StepData {
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

// ===== 执行阶段（Plan#36 R2-5，Codex 式 phase） =====

export type AgentPhase = 'thinking' | 'clarify' | 'planning' | 'executing' | 'reporting';

/** 执行计划卡数据（plan_present 协议 → PlanBlock，与后端 PlanData 对齐） */
export interface AgentPlanData {
  goal: string;
  steps: Array<{ id: string; label: string; deliverable?: string; risk?: string }>;
  risks?: string[];
  /** 确认状态（前端本地，回执后锁定） */
  status?: 'pending' | 'confirmed' | 'modified';
}

/** 对话内上传卡数据（request_upload 协议 → UploadBlock） */
export interface UploadCardData {
  guideText?: string;
  accept?: string;
  multiple?: boolean;
  /** 上传状态（前端本地） */
  status?: 'pending' | 'uploading' | 'done';
  fileName?: string;
  fileSize?: number;
}

/** 任务简报卡数据（emit_brief 协议 → BriefBlock） */
export interface BriefCardData {
  summary: string;
  nodeRefs?: Array<{ nodeId: string; label: string }>;
  note?: string;
}

// ===== 问题/选项 =====

export interface QuestionData {
  guideText?: string;
  multi?: boolean;
  items: QuestionOption[];
}

export interface QuestionOption {
  value: string;
  label: string;
  desc?: string;
  ai?: boolean;
  checked?: boolean;
}

// ===== 澄清项 =====

export interface ClarifyAnswer {
  itemId: string;
  value: string | string[];
}

export interface ClarifyItem {
  itemId: string;
  question: string;
  kind: 'single' | 'multi' | 'text';
  required: boolean;
  options?: { value: string; label: string; desc?: string }[];
  allowCustom?: boolean;
  aiHint?: string;
}

// ===== 执行计划 =====

export interface PlanData {
  steps: PlanStep[];
  totalCost: number;
  riskLevel: 'low' | 'medium' | 'high';
  /** 付费/覆盖/删除等高风险操作 */
  hasHighRiskOps?: boolean;
}

export interface PlanStep {
  skillName: string;
  label: string;
  affectedNodes: string[];
  estimatedCost: number;
  riskLevel: 'low' | 'medium' | 'high';
}

// ===== 执行时间线（P0-4 工具调用时间线） =====

export interface TimelineStep {
  id: string;
  name: string;
  kind: 'tool' | 'canvas';
  status: 'running' | 'done' | 'failed';
  /** 步骤详情（R2：展开可见读取清单/失败原因） */
  input?: string;
  result?: string;
}

export interface TimelineData {
  steps: TimelineStep[];
}

// ===== 任务清单（P0-3 todo_write 快照，PinnedTodoSlot 消费） =====

export interface TodoItem {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
}

export interface TodoSnapshot {
  title?: string;
  items: TodoItem[];
}

// ===== 进度 =====

export interface ProgressData {
  steps: ProgressStep[];
  totalProgress: number; // 0-100
  totalCost: number;
  currentStep: string | null;
}

export interface ProgressStep {
  key: string;
  label: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: number; // 0-100
  cost?: number;
  duration?: number; // ms
}

// ===== 画布操作 =====

/** CanvasPatch: 复用 @zeroexo/shared 的 CanvasOp 类型 */
export interface CanvasPatch {
  opGroupId: string;
  ops: CanvasOp[];
}

// ===== 思考态 =====

export interface ThinkingState {
  active: boolean;
  text: string;
  /** 任务开始时间戳（R2 返工：trace 计时以此为基准，不再用组件挂载时刻） */
  startedAt?: number;
  steps: ThinkingStep[];
  tools: ToolCall[];
}

export interface ThinkingStep {
  icon: 'think' | 'tool' | 'search' | 'file' | 'check' | 'spin';
  name: string;
  tool?: string;
  dur?: number; // ms
  /** 开始时间戳（R2-5：完成时计算耗时） */
  startedAt?: number;
  input?: string;
  result?: string;
  status: 'running' | 'done' | 'idle' | 'failed';
}

export interface ToolCall {
  toolName: string;
  args: unknown;
  result?: unknown;
}

// ===== 引用 =====

export interface Reference {
  nodeId: string;
  assetId?: string;
  kind: 'image' | 'video' | 'audio' | 'text';
  label: string;
  role?: 'reference_image' | 'first_frame' | 'style' | 'text_context' | 'audio_ref';
  /** 媒体节点缩略图 URL（异步解析后回填，徽标展示用） */
  thumb?: string;
}

// ===== 策略 =====

export type AgentStrategy = 'confirm_each' | 'auto_low_risk' | 'plan_only';

// ===== 扩展 SSE 回调 =====

export interface CanvasAgentCallbacks {
  onThinking?: (message: string) => void;
  onMessageDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onClarifyRequest?: (items: ClarifyItem[]) => void;
  onCanvasRequest?: () => void;
  onPlan?: (plan: PlanData) => void;
  onConfirmRequest?: (plan: PlanData) => void;
  onCanvasPatch?: (patch: CanvasPatch) => void;
  onGenProgress?: (progress: number, message?: string) => void;
  onResult?: (result: unknown) => void;
  onError?: (error: string) => void;
  onDone?: (output: unknown) => void;
  onClose?: () => void;
}