/**
 * agent-chat/types.ts — 通用 Agent 聊天框架类型定义
 *
 * 设计目标（MVVM / MVC + 数据驱动）：
 * - Model：由各业务模块提供数据（messages、steps、API 适配器）
 * - View：AgentChatShell 等通用 UI 组件（Header / 消息列表 / 输入框 / 步骤侧栏）
 * - ViewModel：createAgentChatStore(config) 生成的 zustand store（状态机）
 *
 * 消息渲染采用「注册表 + contentType 数据驱动」：
 * 每条消息携带 contentType，渲染器按类型从注册表取出（renderer-registry.ts），
 * 业务模块可注册自己的渲染器，实现"按需配置展示数据和规则"。
 */

import type { ComponentType, ReactNode } from 'react';

// ===== 渲染形式（contentType） =====

/**
 * AI 智能体的回复形式（内置），后续可通过 registerRenderer 注册更多：
 * - text        纯文本 / Markdown
 * - options     选项卡（思考后给出可选项卡片）
 * - article-list 文章条目（可点击条目垂直排版）
 * - thinking    深度思考（标题 + 正文 + 折叠）
 * - banner      确认/状态横幅
 *
 * 数据驱动规则：消息携带 contentType，AgentChatShell 按类型从注册表取渲染器。
 * 业务模块可注册【自定义类型】（如 'setup-options'）实现专属排版，
 * 也可覆盖内置类型，实现"不同地方按需配置展示数据与规则"。
 */
export type AgentContentType =
  | 'text'
  | 'options'
  | 'article-list'
  | 'thinking'
  | 'banner'
  | (string & {});

// ===== 消息负载 =====

/** 选项项 */
export interface AgentOptionItem {
  value: string;
  label: string;
  icon?: string;
  desc?: string;
  /** 是否 AI 生成（显示角标） */
  ai?: boolean;
  /** 是否已确认（只读标记） */
  checked?: boolean;
}

/** 选项组（选项卡形式的数据驱动负载） */
export interface AgentOptionGroup {
  title?: string;
  multi?: boolean;
  items: AgentOptionItem[];
}

/** 文章条目（可点击条目垂直排版的单条数据） */
export interface AgentArticleItem {
  id: string;
  title: string;
  desc?: string;
  icon?: string;
  badges?: string[];
  /** 点击触发的动作标识（由业务模块解释） */
  action?: string;
  meta?: Record<string, unknown>;
}

/** 泛型消息（View 层只按 contentType 分发渲染，不感知业务字段） */
export interface AgentChatMessage {
  /** 可选稳定 ID（无则由 index 兜底） */
  id?: string;
  role: 'agent' | 'user';
  contentType: AgentContentType;
  /** Markdown 正文（text / thinking 正文） */
  text?: string;
  /** 引导语（options 上方的介绍气泡） */
  guideText?: string;
  options?: AgentOptionGroup;
  articles?: AgentArticleItem[];
  /** 关联步骤 key（用于步骤条高亮 / 点击跳转） */
  stepKey?: string;
  timestamp: number;
  /** 业务扩展字段 */
  meta?: Record<string, unknown>;
}

// ===== 步骤条数据 =====

export interface AgentStep {
  key: string;
  label: string;
  desc?: string;
  icon?: string;
}

export interface AgentStepGroup {
  key: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
  steps: AgentStep[];
}

// ===== 主题 tokens（由调用方从自己的主题系统注入，框架不依赖具体主题） =====

export interface AgentThemeTokens {
  accent: string;
  isDark: boolean;
  labelColor: string;
  mutedColor: string;
  cardBg: string;
  cardBorder: string;
}

// ===== 回调（View → ViewModel / 业务层） =====

export interface AgentChatCallbacks {
  /** 选择选项（单选确认 / 多选确认） */
  onSelectOption?: (stepKey: string | undefined, value: string, label: string) => void;
  onMultiConfirmOption?: (stepKey: string | undefined, values: string[], labels: string[]) => void;
  /** 点击文章条目 */
  onArticleClick?: (article: AgentArticleItem) => void;
  /** 追问 — 针对当前步骤向 AI 提问（由业务层解释） */
  onFollowUp?: (stepKey: string | undefined) => void;
  /** 让 AI 生成更多选项 */
  onAskAI?: (stepKey: string | undefined) => void;
  /** 修改已确认步骤 */
  onModifyStep?: (stepKey: string | undefined) => void;
  /** 删除消息 */
  onDeleteMessage?: (message: AgentChatMessage) => void;
  /** 重试 — 重新发送当前 AI 消息的请求 */
  onRetry?: (message: AgentChatMessage) => void;
}

// ===== 渲染器 =====

export interface MessageRendererProps {
  message: AgentChatMessage;
  theme: AgentThemeTokens;
  callbacks: AgentChatCallbacks;
  /** 是否正在流式输出（渲染器可显示打字指示器） */
  loading?: boolean;
  /** 面板中 AI 的显示名（如 "立项向导"），内置渲染器使用 */
  agentLabel?: string;
  /** 面板中用户的显示名（如 "你"） */
  userLabel?: string;
}

export type AgentMessageRenderer = ComponentType<MessageRendererProps>;

// ===== 模块配置（业务模块按需配置，声明式接入） =====

export interface AgentChatConfig {
  /** 模块唯一标识（用于存储命名空间 / 日志） */
  moduleId: string;
  /** 面板标题（Header 左侧） */
  title: string;
  /** Header Tag 文案（如 "Agent"） */
  tag?: string;
  /** Header 图标 */
  icon?: ReactNode;
  /** AI 显示名（如 "立项向导"，内置渲染器使用，默认 "AI 助手"） */
  agentLabel?: string;
  /** 用户显示名（默认 "你"） */
  userLabel?: string;
  /** 右侧步骤条数据（不传则不显示） */
  steps?: AgentStepGroup[];
  /** 输入框占位符 */
  inputPlaceholder?: string;
  /** 行为规则（不同模块可配置不同规则） */
  rules?: {
    /** 确认选项后是否自动推进到下一步（默认 true） */
    autoAdvance?: boolean;
    /** 是否允许修改已确认步骤（默认 true） */
    allowModify?: boolean;
    /** 是否允许截断下游步骤（默认 true） */
    allowTruncate?: boolean;
  };
}

// ===== 共享 UI 工具样式（渲染器复用） =====

/** 消息行容器（注册表渲染器之间的排版一致性） */
export const agentRowGap = 10;
