/**
 * DockContent - Agent Dock 内容区（T5：对话 + 任务 + 多会话）
 *
 * 布局：
 * - 头部：会话切换（下拉列表 + 新建）+ Tab（对话/任务）
 * - 对话 Tab：ThinkStream（思考态）+ 消息列表（MessageRenderer）+ ComposerInput
 * - 任务 Tab：最近任务列表（GET /api/agents/tasks，含状态/进度/摘要）
 *
 * 挂载时自动恢复最近会话历史（刷新后历史恢复）。
 */

import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, MessageSquare, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useCanvasAgentStore } from './store.js';
import { useAgentTheme } from './context/theme-context.js';
import { ThinkStream } from './think-stream/ThinkStream.js';
import { MessageRenderer } from './message-blocks/MessageRenderer.js';
import { ComposerInput } from './composer/ComposerInput.js';
import {
  loadConversations,
  loadConversationMessages,
  createConversation,
  deleteConversation,
  loadTasks,
  type ConversationSummary,
  type ConversationMessageDto,
  type AgentTaskDto,
} from './session/agent-session.js';
import type { CanvasAgentMessage } from './types.js';

/** 后端消息 → store 消息（跳过记忆压缩摘要等 system 消息） */
function dtoToStoreMessage(dto: ConversationMessageDto): CanvasAgentMessage | null {
  const ts = Date.parse(dto.createdAt) || Date.now();
  if (dto.role === 'user') {
    return {
      id: dto.id,
      role: 'user' as const,
      type: 'text' as const,
      text: dto.content,
      timestamp: ts,
    };
  }
  if (dto.role === 'system') {
    // 记忆压缩摘要等系统消息不渲染为普通消息
    return null;
  }
  return {
    id: dto.id,
    role: 'agent' as const,
    type: 'text' as const,
    text: dto.content,
    timestamp: ts,
  };
}

/** 任务输入摘要 */
function taskInputText(input: unknown): string {
  if (typeof input === 'string') return input.slice(0, 60);
  try {
    const s = JSON.stringify(input ?? {});
    return s.slice(0, 60);
  } catch {
    return '';
  }
}

/** 任务状态徽标色 */
function taskStatusColor(status: AgentTaskDto['status']): string {
  switch (status) {
    case 'running': return '#6366f1';
    case 'completed': return '#10b981';
    case 'failed': return '#ef4444';
    default: return '#64748b';
  }
}

export interface DockContentProps {
  projectId?: string;
}

type DockTab = 'chat' | 'tasks';

export function DockContent({ projectId }: DockContentProps): React.ReactElement {
  const t = useAgentTheme();
  const messages = useCanvasAgentStore((s) => s.messages);
  const isGenerating = useCanvasAgentStore((s) => s.isGenerating);
  const activeConversationId = useCanvasAgentStore((s) => s.activeConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<DockTab>('chat');
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [convOpen, setConvOpen] = useState(false);
  const [tasks, setTasks] = useState<AgentTaskDto[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  // 挂载：恢复最近会话历史 + 加载会话列表
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await loadConversations();
        if (cancelled) return;
        setConvs(list);
        const store = useCanvasAgentStore.getState();
        if (store.activeConversationId || store.messages.length > 0) return;
        if (list.length === 0) return;
        const target = projectId
          ? list.find((c) => c.projectId === projectId) ?? list[0]
          : list[0];
        if (!target) return;
        store.setActiveConversationId(target.id);
        const msgs = await loadConversationMessages(target.id);
        if (cancelled) return;
        store.clearMessages();
        for (const dto of msgs) {
          const m = dtoToStoreMessage(dto);
          if (m) store.addMessage(m);
        }
      } catch {
        // 未登录/无会话时静默，保持空态欢迎页
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 任务列表：Tab 激活时加载
  useEffect(() => {
    if (tab !== 'tasks') return;
    let cancelled = false;
    setTasksLoading(true);
    loadTasks({ projectId })
      .then((items) => {
        if (!cancelled) setTasks(items);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setTasksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, projectId]);

  // 自动滚动到底部（仅对话 Tab）
  useEffect(() => {
    if (tab !== 'chat') return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isGenerating, tab]);

  /** 切换会话 */
  const handleSwitchConversation = async (id: string): Promise<void> => {
    const store = useCanvasAgentStore.getState();
    if (store.isGenerating) return;
    setConvOpen(false);
    store.setActiveConversationId(id);
    store.clearMessages();
    try {
      const msgs = await loadConversationMessages(id);
      for (const dto of msgs) {
        const m = dtoToStoreMessage(dto);
        if (m) store.addMessage(m);
      }
    } catch {
      // 历史加载失败时保持空会话
    }
  };

  /** 新建会话 */
  const handleNewConversation = async (): Promise<void> => {
    const store = useCanvasAgentStore.getState();
    if (store.isGenerating) return;
    try {
      const conv = await createConversation(projectId);
      store.setActiveConversationId(conv.id);
      store.clearMessages();
      setConvs((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      setConvOpen(false);
      setTab('chat');
    } catch {
      // 创建失败静默
    }
  };

  /** 删除会话 */
  const handleDeleteConversation = async (id: string): Promise<void> => {
    const store = useCanvasAgentStore.getState();
    try {
      await deleteConversation(id);
    } catch {
      return;
    }
    setConvs((prev) => prev.filter((c) => c.id !== id));
    if (store.activeConversationId === id) {
      store.setActiveConversationId(null);
      store.clearMessages();
    }
  };

  const currentTitle = convs.find((c) => c.id === activeConversationId)?.title
    ?? (messages.length > 0 ? '画布 Agent 对话' : '新对话');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: '#0a0c14',
      }}
    >
      {/* ===== 头部：会话 + Tab ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderBottom: '1px solid #111a2e',
          background: 'rgba(10,12,20,0.9)',
          position: 'relative',
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        {/* 会话切换 */}
        <button
          type="button"
          onClick={() => setConvOpen((v) => !v)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 10px',
            borderRadius: 8,
            border: `1.5px solid ${t.border}`,
            background: '#0d1220',
            color: '#e2e8f0',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            maxWidth: 170,
          }}
          title="切换会话"
        >
          <MessageSquare size={12} style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentTitle}
          </span>
          <ChevronDown
            size={11}
            style={{
              flexShrink: 0,
              transform: convOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          />
        </button>

        {/* 新建会话 */}
        <button
          type="button"
          onClick={() => void handleNewConversation()}
          title="新建会话"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 7,
            border: `1.5px solid ${t.border}`,
            background: '#0d1220',
            color: '#94a3b8',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Plus size={13} />
        </button>

        {/* Tab 切换 */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            marginLeft: 'auto',
            padding: 2,
            borderRadius: 8,
            background: '#0d1220',
            border: `1px solid ${t.border}`,
          }}
        >
          {(['chat', 'tasks'] as DockTab[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                border: 'none',
                background: tab === k ? 'linear-gradient(135deg,#6366f1,#a855f7)' : 'transparent',
                color: tab === k ? '#fff' : '#94a3b8',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {k === 'chat' ? '对话' : '任务'}
            </button>
          ))}
        </div>

        {/* 会话下拉列表 */}
        {convOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 14,
              right: 14,
              zIndex: 40,
              background: '#0d1220',
              border: `1px solid #1e293b`,
              borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              maxHeight: 280,
              overflowY: 'auto',
              padding: 6,
              marginTop: 4,
            }}
          >
            {convs.length === 0 && (
              <div style={{ padding: '10px 8px', fontSize: 12, color: '#64748b' }}>
                暂无历史会话，点击 + 新建
              </div>
            )}
            {convs.map((c) => (
              <div
                key={c.id}
                onClick={() => void handleSwitchConversation(c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: c.id === activeConversationId ? 'rgba(99,102,241,0.08)' : 'transparent',
                  border: c.id === activeConversationId ? '1px solid rgba(99,102,241,0.35)' : '1px solid transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: '#e2e8f0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.title ?? '画布 Agent 对话'}
                  </div>
                  {c.messages?.[0] && (
                    <div
                      style={{
                        fontSize: 11,
                        color: '#64748b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 2,
                      }}
                    >
                      {c.messages[0].content.slice(0, 60)}
                    </div>
                  )}
                </div>
                {c._count?.messages != null && (
                  <span style={{ fontSize: 10.5, color: '#64748b', flexShrink: 0 }}>
                    {c._count.messages} 条
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteConversation(c.id);
                  }}
                  title="删除会话"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    color: '#64748b',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 思考态（仅对话 Tab） ===== */}
      {tab === 'chat' && <ThinkStream />}

      {/* ===== 内容区 ===== */}
      {tab === 'chat' ? (
        <div className="conversation" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="welcome-wrap">
              <div className="welcome-icon">
                <Sparkles size={24} color="#fff" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
                VideoForge Agent
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 16 }}>
                描述你的需求，Agent 会调用工具在画布上执行任务。
                <br />
                例如：「生成一段 15 秒的 TVC 广告」
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`msg-row ${m.role === 'user' ? 'user-row' : 'ai-row'}`}>
                {m.role === 'agent' && (
                  <div
                    className="avatar ai-avatar"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Bot size={16} color="#fff" />
                  </div>
                )}
                {m.role === 'user' ? (
                  <div className="user-bubble">{m.text}</div>
                ) : (
                  <div className="ai-body" style={{ color: t.isDark ? '#cbd5e1' : '#334155' }}>
                    <MessageRenderer message={m} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        /* ===== 任务 Tab ===== */
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
          {tasksLoading && tasks.length === 0 ? (
            <div className="note">任务加载中…</div>
          ) : tasks.length === 0 ? (
            <div className="note" style={{ textAlign: 'center', paddingTop: 32 }}>
              暂无任务，在对话中发送需求后自动生成
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                style={{
                  padding: '10px 12px',
                  marginBottom: 8,
                  borderRadius: 10,
                  border: '1px solid #1e293b',
                  background: 'rgba(15,20,35,0.6)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: taskStatusColor(task.status),
                      flexShrink: 0,
                      ...(task.status === 'running'
                        ? { animation: 'pulse-dot 1.2s ease-in-out infinite' }
                        : {}),
                    }}
                  />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0' }}>
                    {task.taskType}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: '#64748b',
                      marginLeft: 'auto',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {new Date(task.createdAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: '#94a3b8',
                    marginTop: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {taskInputText(task.input)}
                </div>
                {task.status === 'running' && (
                  <div className="progress-track" style={{ marginTop: 8 }}>
                    <div className="progress-fill" style={{ width: `${Math.max(task.progress, 4)}%` }} />
                  </div>
                )}
                {task.status === 'failed' && (
                  <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{task.error}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ===== 输入区（仅对话 Tab） ===== */}
      {tab === 'chat' && <ComposerInput />}
    </div>
  );
}
