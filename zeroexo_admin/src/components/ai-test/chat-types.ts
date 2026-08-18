/**
 * 语言对话 Tab 专属类型定义
 *
 * 仅包含语言对话（chat）场景使用的类型。
 * ProviderItem / ModelOption 等多 Tab 共享类型定义在 ./types 中，不在此重复。
 */

/** 对话消息（用户或 AI） */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** 深度思考过程内容（仅 assistant 且开启 thinkingMode 时存在） */
  thinkingContent?: string;
}

/** 对话缓存结构（按渠道+模型隔离持久化） */
export interface CacheData {
  messages: Message[];
  providerId: string;
  model: string;
  timestamp: number;
}
