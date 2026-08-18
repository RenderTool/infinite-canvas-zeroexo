/**
 * AgentConversation / AgentMessage 类型定义
 *
 * 与后端 Prisma 模型对齐，供 Agent 和 Generator 双端使用
 */

/** Agent 对话消息 */
export interface AgentMessage {
  /** 可选稳定 ID */
  id?: string;
  role: 'agent' | 'user';
  /** Markdown 正文 */
  text?: string;
  /** 消息时间戳 */
  timestamp: number;
  /** 关联步骤 key */
  stepKey?: string;
  /** 业务扩展字段 */
  meta?: Record<string, unknown>;
}

/** Agent 对话 */
export interface AgentConversation {
  id: string;
  /** 关联项目 ID */
  projectId?: string;
  /** 对话标题 */
  title?: string;
  /** 消息列表 */
  messages: AgentMessage[];
  createdAt: string;
  updatedAt: string;
}