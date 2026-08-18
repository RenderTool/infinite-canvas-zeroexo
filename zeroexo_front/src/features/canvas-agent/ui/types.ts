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
  | 'agent:done';

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
  | 'done';

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
};

// ===== 消息块类型（5 种原生） =====

export type CanvasAgentMessageType =
  | 'text'
  | 'question'
  | 'clarify'
  | 'plan'
  | 'progress';

/** 消息角色 */
export type MessageRole = 'agent' | 'user';

/** 泛型消息 */
export interface CanvasAgentMessage {
  id: string;
  role: MessageRole;
  type: CanvasAgentMessageType;
  text?: string;
  /** 问题/选项数据 */
  question?: QuestionData;
  /** 澄清项列表 */
  clarifyItems?: ClarifyItem[];
  /** 执行计划 */
  plan?: PlanData;
  /** 进度数据 */
  progress?: ProgressData;
  /** 关联步骤 */
  stepKey?: string;
  timestamp: number;
  /** 业务扩展字段 */
  meta?: Record<string, unknown>;
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
  steps: ThinkingStep[];
  tools: ToolCall[];
}

export interface ThinkingStep {
  icon: 'think' | 'tool' | 'search' | 'file' | 'check' | 'spin';
  name: string;
  tool?: string;
  dur?: number; // ms
  input?: string;
  result?: string;
  status: 'running' | 'done' | 'idle';
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
}

// ===== 策略 =====

export type AgentStrategy = 'confirm_each' | 'auto_low_risk' | 'plan_only';

// ===== 扩展 SSE 回调 =====

export interface CanvasAgentCallbacks {
  onThinking?: (message: string) => void;
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