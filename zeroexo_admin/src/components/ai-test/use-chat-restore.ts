/**
 * useChatRestore - 聊天会话初始恢复 Hook
 *
 * 封装页面加载时的会话恢复逻辑：
 * 1. 服务端优先加载最近会话（按时间排序）
 * 2. 失败清屏，不使用 localStorage 兜底
 */
import { useEffect, useRef } from 'react';
import {
  loadSessionsFromServer,
  loadMessagesFromServer,
} from './chat-utils';

interface UseChatRestoreProps {
  activeTab: string;
  onRestore: (providerId: string, model: string, messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    thinkingContent?: string;
  }>) => void;
}

export function useChatRestore({ activeTab, onRestore }: UseChatRestoreProps) {
  const cacheRestored = useRef(false);

  useEffect(() => {
    if (cacheRestored.current) return;
    if (activeTab !== 'text') return;
    cacheRestored.current = true;

    const restoreFromServer = async () => {
      try {
        const sessions = await loadSessionsFromServer();
        if (sessions.length === 0) return;

        const sorted = [...sessions].sort((a, b) => {
          const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return bTime - aTime;
        });

        const latest = sorted[0];
        const data = await loadMessagesFromServer(latest.id);
        if (data && data.messages.length > 0) {
          onRestore(latest.providerId, latest.model, data.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            thinkingContent: m.thinkingContent,
          })));
        }
      } catch { /* ignore */ }
    };

    restoreFromServer();
  }, [activeTab, onRestore]);
}
