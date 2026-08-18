/**
 * 语言对话 Tab 专属常量与工具函数
 *
 * 包含缓存 key 生成、localStorage 读写、token 估算、日期格式化等。
 * 类型 Message / CacheData 来自 ./chat-types。
 */
import type { Message, CacheData } from './chat-types';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** 全局缓存 key（记录上次会话，用于恢复 provider+model） */
export const STORAGE_KEY = 'ai-test-conversation';
/** 每模型独立缓存前缀 */
export const CHAT_CACHE_PREFIX = 'ai-test-chat';

/** 清理所有聊天相关的旧缓存（强制清理历史记录和错误缓存） */
export function clearAllChatCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        if (
          key === STORAGE_KEY ||
          key.startsWith(CHAT_CACHE_PREFIX) ||
          key.startsWith('ai-chat-last-provider') ||
          key.startsWith('ai-chat-last-model') ||
          key.startsWith('ai-test-chat:')
        ) {
          keysToRemove.push(key);
        }
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
/** 默认上下文 token 上限 */
export const DEFAULT_CONTEXT_LIMIT = 128_000;
/** 上下文使用率告警阈值（百分比小数） */
export const WARN_THRESHOLD = 0.70;
/** 自动截断阈值（百分比小数） */
export const AUTO_TRUNCATE_THRESHOLD = 0.85;
/** 自动 / 手动截断后保留的最近消息条数 */
export const KEEP_RECENT = 10;

/* ------------------------------------------------------------------ */
/*  Cache helpers                                                     */
/* ------------------------------------------------------------------ */

/** 生成按(渠道,模型)隔离的缓存 key */
export const chatCacheKey = (pid: string | null, model: string | null) =>
  pid ? `${CHAT_CACHE_PREFIX}:${pid}:${model || '__default__'}` : null;

/** 从指定 key 读取缓存的对话 */
export const loadChatCache = (key: string | null): Message[] | null => {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data: CacheData = JSON.parse(raw);
    return Array.isArray(data.messages) ? data.messages : null;
  } catch { return null; }
};

/** 保存对话到指定 key */
export const saveChatCache = (key: string | null, msgs: Message[], pid: string | null, model: string | null) => {
  if (!key) return;
  if (msgs.length === 0) { localStorage.removeItem(key); return; }
  try {
    localStorage.setItem(key, JSON.stringify({
      messages: msgs, providerId: pid || '', model: model || '', timestamp: Date.now(),
    } satisfies CacheData));
  } catch { /* quota */ }
};

/* ------------------------------------------------------------------ */
/*  Token estimation                                                  */
/* ------------------------------------------------------------------ */

/** 估算文本 token 数（基于 cl100k_base 编码经验系数） */
export function estimateTokens(text: string): number {
  let cn = 0;
  let en = 0;
  let num = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      cn++;
    } else if (/[a-zA-Z]/.test(ch)) {
      en++;
    } else if (/[0-9]/.test(ch)) {
      num++;
    } else if (ch !== ' ') {
      other++;
    }
  }
  // cl100k_base 编码经验系数: 中文 ~1.8, 英文 ~0.3, 数字 ~0.2, 其他 ~0.5
  return Math.round(cn * 1.8 + en * 0.3 + num * 0.2 + other * 0.5);
}

/** 估算消息列表的总 token 数（每条消息额外 +4 开销） */
export function estimateMessagesTokens(msgs: Message[]): number {
  return msgs.reduce((s, m) => s + estimateTokens(m.content) + 4, 0);
}

/* ------------------------------------------------------------------ */
/*  Date formatting                                                   */
/* ------------------------------------------------------------------ */

/** 格式化日期为 zh-CN 本地字符串（月/日 时:分:秒） */
export function formatDate(d: Date): string {
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

import { apiGet, apiPost, apiDelete } from '@/services/api-client';

/* ------------------------------------------------------------------ */
/*  Server sync (跨设备聊天记录持久化)                                  */
/* ------------------------------------------------------------------ */

export interface ServerSession {
  id: string;
  userId: string;
  providerId: string;
  model: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  thinkingContent?: string;
  createdAt: string;
}

/** 从后端加载用户的所有会话列表 */
export async function loadSessionsFromServer(): Promise<ServerSession[]> {
  try {
    const res = await apiGet<{ sessions: ServerSession[] }>('/admin/ai/chat/sessions');
    return res?.sessions ?? [];
  } catch { return []; }
}

/** 从后端加载指定会话的消息 */
export async function loadMessagesFromServer(sessionId: string): Promise<{
  session: ServerSession;
  messages: ServerMessage[];
} | null> {
  try {
    return await apiGet(`/admin/ai/chat/sessions/${sessionId}/messages`);
  } catch { return null; }
}

/** 将消息同步到后端 */
export async function syncMessagesToServer(
  providerId: string,
  model: string,
  messages: Array<{ role: string; content: string; thinkingContent?: string }>,
): Promise<string | null> {
  try {
    const res = await apiPost<{ sessionId: string }>('/admin/ai/chat/sync', {
      providerId,
      model,
      messages,
    });
    return res?.sessionId ?? null;
  } catch (err) {
    console.warn('[聊天同步] 同步消息到服务端失败:', err);
    return null;
  }
}

/** 删除服务端会话 */
export async function deleteSessionFromServer(sessionId: string): Promise<boolean> {
  try {
    await apiDelete(`/admin/ai/chat/sessions/${sessionId}`);
    return true;
  } catch { return false; }
}
