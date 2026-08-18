/**
 * useChatSession - 聊天会话管理 Hook
 *
 * 封装会话身份管理、缓存加载/保存、服务端同步逻辑。
 * 使用 `providerId::model` 联合 key 作为会话身份标识，确保跨渠道同名模型正确隔离。
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { Message } from './chat-types';
import {
  chatCacheKey,
  saveChatCache,
  loadSessionsFromServer,
  loadMessagesFromServer,
  syncMessagesToServer,
  deleteSessionFromServer,
} from './chat-utils';

export interface UseChatSessionReturn {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  syncedSessionId: string | null;
  loadSession: (providerId: string, model: string) => Promise<void>;
  refreshSession: (providerId: string, model: string) => Promise<void>;
  saveCurrentSession: (providerId: string, model: string) => void;
  clearSession: (providerId: string, model: string) => Promise<void>;
  clearMessages: () => void;
  prepareSwitch: (newProviderId: string, newModel: string) => void;
}

export function useChatSession(): UseChatSessionReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [syncedSessionId, setSyncedSessionId] = useState<string | null>(null);

  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  const syncedRef = useRef(false);
  const prevConvRef = useRef<{ pid: string; model: string } | null>(null);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const transitioningRef = useRef(false);

  const convKey = (pid: string, model: string) => `${pid}::${model}`;

  const prepareSwitch = useCallback((newProviderId: string, newModel: string) => {
    const prev = prevConvRef.current;
    const newKey = convKey(newProviderId, newModel);

    if (prev) {
      const prevKey = convKey(prev.pid, prev.model);
      if (prevKey !== newKey && messagesRef.current.length > 0) {
        saveChatCache(chatCacheKey(prev.pid, prev.model), messagesRef.current, prev.pid, prev.model);
      }
    }

    prevConvRef.current = { pid: newProviderId, model: newModel };
    transitioningRef.current = true;
    setTimeout(() => { transitioningRef.current = false; }, 100);
  }, []);

  const loadSession = useCallback(async (providerId: string, model: string) => {
    const newKey = convKey(providerId, model);
    const prev = prevConvRef.current;

    if (prev && convKey(prev.pid, prev.model) === newKey) {
      return;
    }

    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;

    let cancelled = false;
    controller.signal.addEventListener('abort', () => { cancelled = true; });

    try {
      const sessions = await loadSessionsFromServer();
      if (cancelled) return;

      const target = sessions.find(
        (s) => s.providerId === providerId && s.model === model,
      );

      if (target) {
        const data = await loadMessagesFromServer(target.id);
        if (!cancelled && data) {
          setMessages(data.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            thinkingContent: m.thinkingContent,
          })));
          setSyncedSessionId(target.id);
          syncedRef.current = true;
          prevConvRef.current = { pid: providerId, model };
          return;
        }
      }
    } catch { /* ignore */ }

    if (cancelled) return;

    setMessages([]);
    setSyncedSessionId(null);
    syncedRef.current = false;
    prevConvRef.current = { pid: providerId, model };
  }, []);

  const refreshSession = useCallback(async (providerId: string, model: string) => {
    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;

    let cancelled = false;
    controller.signal.addEventListener('abort', () => { cancelled = true; });

    try {
      const sessions = await loadSessionsFromServer();
      if (cancelled) return;

      const target = sessions.find(
        (s) => s.providerId === providerId && s.model === model,
      );

      if (target) {
        const data = await loadMessagesFromServer(target.id);
        if (!cancelled && data) {
          setMessages(data.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            thinkingContent: m.thinkingContent,
          })));
          setSyncedSessionId(target.id);
          syncedRef.current = true;
          prevConvRef.current = { pid: providerId, model };
          return;
        }
      }
    } catch { /* ignore */ }

    if (cancelled) return;
    setMessages([]);
    setSyncedSessionId(null);
    syncedRef.current = false;
  }, []);

  const saveCurrentSession = useCallback((providerId: string, model: string) => {
    const key = chatCacheKey(providerId, model);
    if (key) {
      saveChatCache(key, messagesRef.current, providerId, model);
    }
  }, []);

  const clearSession = useCallback(async (providerId: string, model: string) => {
    setMessages([]);
    setSyncedSessionId(null);
    syncedRef.current = false;

    const key = chatCacheKey(providerId, model);
    if (key) {
      localStorage.removeItem(key);
    }

    try {
      const sessions = await loadSessionsFromServer();
      const matched = sessions.filter(
        (s) => s.providerId === providerId && s.model === model,
      );
      for (const s of matched) {
        try { await deleteSessionFromServer(s.id); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    prevConvRef.current = { pid: providerId, model };
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setSyncedSessionId(null);
    syncedRef.current = false;
  }, []);

  useEffect(() => {
    const prev = prevConvRef.current;
    if (!prev) return;
    if (transitioningRef.current) return;

    saveChatCache(chatCacheKey(prev.pid, prev.model), messages, prev.pid, prev.model);

    if (messages.length > 0) {
      const timer = setTimeout(() => {
        syncMessagesToServer(prev.pid, prev.model, messages.map((m) => ({
          role: m.role,
          content: m.content,
          thinkingContent: m.thinkingContent,
        }))).then((sessionId) => {
          if (sessionId && !syncedRef.current) {
            setSyncedSessionId(sessionId);
            syncedRef.current = true;
          }
        }).catch(() => { /* ignore */ });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [messages]);

  return {
    messages,
    setMessages,
    syncedSessionId,
    loadSession,
    refreshSession,
    saveCurrentSession,
    clearSession,
    clearMessages,
    prepareSwitch,
  };
}
