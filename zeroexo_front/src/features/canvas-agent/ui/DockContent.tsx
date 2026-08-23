/**
 * DockContent - Agent Dock 内容区（T5：对话 + 协作聊天 + 成员 三页签）
 *
 * 布局：
 * - 头部：会话切换（下拉列表 + 新建）+ 页签（对话/聊天/成员）
 * - 对话页签：ThinkStream（思考态）+ 消息列表（MessageRenderer）+ ComposerInput
 * - 聊天页签：协作实时聊天（CollaborationChat，复用协作面板组件）
 * - 成员页签：在线成员列表 + 房主可禁言/移出（由 CollaborationPanel 迁移）
 *
 * 挂载时自动恢复最近会话历史（刷新后历史恢复）。
 * 页签状态提升到 canvas-agent store（dockTab），TopBar 协作聊天按钮可直接切到聊天页签。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MessageSquare, Plus, Shield, Sparkles, Trash2, Users, Volume2, VolumeX, Bot, X, Search } from 'lucide-react';
import { Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useCanvasAgentStore } from './store.js';
import { ThinkStream } from './think-stream/ThinkStream.js';
import { MessageRenderer } from './message-blocks/MessageRenderer.js';
import { ComposerInput } from './composer/ComposerInput.js';
import { PinnedTodoSlot } from './PinnedTodoSlot.js';
import { CopyButton } from './message-blocks/CopyButton.js';
import {
  loadConversations,
  loadConversationMessages,
  deleteConversation,
  type ConversationSummary,
  type ConversationMessageDto,
} from './session/agent-session.js';
import type { AttachmentCard, CanvasAgentMessage } from './types.js';
import { CollaborationChat } from '@/features/collaboration/collaboration-chat.js';
import { useCollaborationStore } from '@/features/collaboration/use-collaboration-store.js';
import {
  listMembers,
  kickMember,
  muteMember,
  unmuteMember,
} from '@/features/collaboration/collaboration-api.js';
import type { CollaborationMember } from '@/features/collaboration/collaboration-types.js';

/**
 * 后端消息 → store 消息（跳过记忆压缩摘要等 system 消息）
 * R3 FIX-2：解析 [附件清单:JSON] 标记还原附件卡；同时剥离清单标记与附件预览正文段，
 * 禁止历史加载把附件展开成纯文本。
 */
function dtoToStoreMessage(dto: ConversationMessageDto): CanvasAgentMessage | null {
  const ts = Date.parse(dto.createdAt) || Date.now();
  if (dto.role === 'user') {
    // R2 返工：后端落库的用户消息是 { prompt } 结构序列化，恢复时提取原文，不再显示裸 JSON
    let text = dto.content;
    try {
      const parsed = JSON.parse(dto.content) as { prompt?: unknown };
      if (parsed && typeof parsed.prompt === 'string') text = parsed.prompt;
    } catch {
      /* 非 JSON 保持原文 */
    }
    // R3 FIX-2：还原附件卡（清单标记在 prompt 最前，JSON 以 }] 结尾）
    let attachments: AttachmentCard[] | undefined;
    const manifestMatch = text.match(/^\[附件清单:(\{[\s\S]*?\})\](?:\n|$)/);
    if (manifestMatch) {
      try {
        const manifest = JSON.parse(manifestMatch[1]!) as { files?: AttachmentCard[] };
        if (Array.isArray(manifest.files) && manifest.files.length > 0) {
          attachments = manifest.files;
        }
      } catch {
        /* 清单损坏则忽略，保留原文 */
      }
      if (attachments) {
        // 剥离标记行
        text = text.slice(manifestMatch[0].length);
        // 剥离附件预览正文段（文本："[附件 x（size）内容预览]\n预览...（原文共 N 字…）"；非文本："[附件 x（size，非文本文件，按需处理）]"）
        text = text
          .replace(/\n\[附件 [^\]]+（[^\]]+，非文本文件，按需处理）\]/g, '')
          .replace(/\n\[附件 [^\]]+（[^\]]+）内容预览\][\s\S]*?（原文共 [^\n]+）\n?/g, '')
          .trim();
      }
    }
    return {
      id: dto.id,
      role: 'user' as const,
      type: 'text' as const,
      text,
      attachments,
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

/** 消息时间戳 → HH:MM */
function formatMsgTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface DockContentProps {
  projectId?: string;
}

type DockTab = 'chat' | 'collab' | 'members';

export function DockContent({ projectId }: DockContentProps): React.ReactElement {
  const messages = useCanvasAgentStore((s) => s.messages);
  const isGenerating = useCanvasAgentStore((s) => s.isGenerating);
  // 思考流文本:思考块随流增长时保持滚动到底部
  const thinkingText = useCanvasAgentStore((s) => s.thinking.text);
  const activeConversationId = useCanvasAgentStore((s) => s.activeConversationId);
  // 页签状态提升到 store:TopBar 协作聊天按钮可直接切到 collab
  const tab = useCanvasAgentStore((s) => s.dockTab);
  const setTab = useCanvasAgentStore((s) => s.setDockTab);
  const collabStore = useCollaborationStore();
  const { t } = useTranslation();
  const themeCfg = useTheme();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [convOpen, setConvOpen] = useState(false);
  /** 历史会话搜索关键词（标题/最后消息预览模糊匹配） */
  const [convQuery, setConvQuery] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

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

  // ===== 成员管理(房主权限,由协作面板迁移) =====
  const collabRoom = collabStore.room;
  const collabMembers = collabStore.members;
  const isRoomOwner = collabRoom?.isOwner ?? false;

  const refreshMembers = async () => {
    if (!collabRoom) return;
    try {
      const list = await listMembers(collabRoom.canvasId);
      collabStore.setMembers(list);
    } catch { /* 静默 */ }
  };

  const handleToggleMute = async (member: CollaborationMember) => {
    if (!collabRoom) return;
    setBusyUserId(member.userId);
    try {
      const muted = member.sessions.some((s) => s.status === 'muted');
      if (muted) {
        await unmuteMember(collabRoom.canvasId, member.userId);
        message.success(t('collab.memberUnmutedSuccess'));
      } else {
        await muteMember(collabRoom.canvasId, member.userId);
        message.success(t('collab.memberMutedSuccess'));
      }
      await refreshMembers();
    } catch {
      // 操作失败保持列表现状
    } finally {
      setBusyUserId(null);
    }
  };

  const handleKick = async (member: CollaborationMember) => {
    if (!collabRoom) return;
    setBusyUserId(member.userId);
    try {
      await kickMember(collabRoom.canvasId, member.userId);
      await refreshMembers();
      message.success(t('collab.memberKicked'));
    } catch {
      message.error(t('collab.kickFailed'));
    } finally {
      setBusyUserId(null);
    }
  };

  // 自动滚动到底部（仅对话 Tab）
  useEffect(() => {
    if (tab !== 'chat') return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isGenerating, thinkingText, tab]);

  /** 切换会话 */
  const handleSwitchConversation = async (id: string): Promise<void> => {
    const store = useCanvasAgentStore.getState();
    if (store.isGenerating) return;
    setConvOpen(false);
    setConvQuery('');
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

  /** 新建会话（懒创建：不立即落库，首条消息发送时由 ensureConversation 创建，
   * 避免每点一次新建就堆积一条空会话） */
  const handleNewConversation = (): void => {
    const store = useCanvasAgentStore.getState();
    if (store.isGenerating) return;
    setConvOpen(false);
    setTab('chat');
    // 当前已是空会话（未落库且无消息）→ 无需重复新建
    if (!store.activeConversationId && store.messages.length === 0) return;
    store.setActiveConversationId(null);
    store.clearMessages();
  };

  // 懒创建会话落库后刷新列表：首条消息发送后后端才创建会话，
  // activeConversationId 不在列表中时静默重拉，保证下拉列表与会话标题同步
  useEffect(() => {
    if (!activeConversationId) return;
    if (convs.some((c) => c.id === activeConversationId)) return;
    let cancelled = false;
    void loadConversations()
      .then((list) => {
        if (!cancelled) setConvs(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, convs]);

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

  // 历史会话搜索：标题 + 最后消息预览模糊匹配（不区分大小写）
  const filteredConvs = (() => {
    const q = convQuery.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter((c) => {
      const title = (c.title ?? '').toLowerCase();
      const preview = (c.messages?.[0]?.content ?? '').toLowerCase();
      return title.includes(q) || preview.includes(q);
    });
  })();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--agent-bg)',
      }}
    >
      {/* ===== 头部：会话 + Tab ===== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderBottom: '1px solid var(--agent-border)',
          background: 'var(--agent-panel)',
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
            border: '1.5px solid var(--agent-border)',
            background: 'var(--agent-surface-2)',
            color: 'var(--agent-text)',
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

        {/* 新建会话（懒创建：首条消息发送时才落库） */}
        <button
          type="button"
          onClick={handleNewConversation}
          title="新建会话"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 7,
            border: '1.5px solid var(--agent-border)',
            background: 'var(--agent-surface-2)',
            color: 'var(--agent-muted)',
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
            background: 'var(--agent-surface-2)',
            border: '1px solid var(--agent-border)',
          }}
        >
          {(['chat', 'collab', 'members'] as DockTab[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                padding: '3px 10px',
                borderRadius: 6,
                border: 'none',
                background: tab === k ? 'var(--agent-accent)' : 'transparent',
                color: tab === k ? '#fff' : 'var(--agent-muted)',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {k === 'chat' ? '对话' : k === 'collab' ? '聊天' : '成员'}
            </button>
          ))}
        </div>

        {/* 关闭面板(符合用户习惯;重新打开走顶部 Agent 按钮) */}
        <button
          type="button"
          onClick={() => useCanvasAgentStore.getState().setDockOpen(false)}
          title="关闭面板"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 7,
            border: 'none',
            background: 'transparent',
            color: 'var(--agent-muted)',
            cursor: 'pointer',
            flexShrink: 0,
            marginLeft: 2,
          }}
        >
          <X size={14} />
        </button>

        {/* 会话下拉列表 */}
        {convOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 14,
              right: 14,
              zIndex: 40,
              background: 'var(--agent-bg)',
              border: '1px solid var(--agent-border)',
              borderRadius: 10,
              boxShadow: 'var(--agent-shadow)',
              maxHeight: 320,
              overflowY: 'auto',
              padding: 6,
              marginTop: 4,
            }}
          >
            {/* 搜索框：历史会话按标题/预览过滤 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                marginBottom: 4,
                borderRadius: 7,
                background: 'var(--agent-surface-2)',
              }}
            >
              <Search size={12} style={{ color: 'var(--agent-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={convQuery}
                onChange={(e) => setConvQuery(e.target.value)}
                placeholder="搜索历史会话…"
                autoFocus
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: 12,
                  color: 'var(--agent-text)',
                  fontFamily: 'inherit',
                }}
              />
              {convQuery && (
                <button
                  type="button"
                  onClick={() => setConvQuery('')}
                  title="清空搜索"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--agent-muted)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'inline-flex',
                    flexShrink: 0,
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {filteredConvs.length === 0 && (
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--agent-muted)' }}>
                {convs.length === 0 ? '暂无历史会话，点击 + 新建' : '未找到匹配的会话'}
              </div>
            )}
            {filteredConvs.map((c) => (
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
                  background: c.id === activeConversationId ? 'var(--agent-accent-soft)' : 'transparent',
                  border: c.id === activeConversationId ? '1px solid var(--agent-accent)' : '1px solid transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: 'var(--agent-text)',
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
                        color: 'var(--agent-muted)',
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
                  <span style={{ fontSize: 10.5, color: 'var(--agent-muted)', flexShrink: 0 }}>
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
                    color: 'var(--agent-muted)',
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

      {/* ===== 内容区 ===== */}
      {tab === 'chat' ? (
        <div className="conversation" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="welcome-wrap">
              <div className="welcome-icon">
                <Sparkles size={24} color="#fff" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--agent-text)', marginBottom: 4 }}>
                VideoForge Agent
              </div>
              <div style={{ fontSize: 12, color: 'var(--agent-muted)', lineHeight: 1.6, marginBottom: 16 }}>
                描述你的需求，Agent 会调用工具在画布上执行任务。
                <br />
                例如：「生成一段 15 秒的 TVC 广告」
              </div>
            </div>
          ) : (
            // R2 返工：按回合归组渲染——一组一个角色头，回合结束后整块复制（不是每小块一个复制钮）
            (() => {
              const groups: CanvasAgentMessage[][] = [];
              for (const m of messages) {
                const last = groups[groups.length - 1];
                if (last && last[0]!.role === m.role) last.push(m);
                else groups.push([m]);
              }
              return groups.map((group) => {
                const isAgent = group[0]!.role === 'agent';
                // 整块复制内容：回合内全部文本/MD 消息拼接
                const turnText = group
                  .filter((m) => m.type === 'text' || m.type === 'md')
                  .map((m) => m.text ?? '')
                  .filter(Boolean)
                  .join('\n\n');
                return (
                  <div key={group[0]!.id}>
                    {group.map((m) => (
                      <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
                        {m === group[0] && (
                          <div className="role">
                            {isAgent && (
                              <span className="agent-avatar">
                                <Bot size={16} />
                              </span>
                            )}
                            <span>{m.role === 'user' ? '你' : 'Agent'}</span>
                            <span className="msg-time">{formatMsgTime(m.timestamp)}</span>
                          </div>
                        )}
                        {m.role === 'user' ? (
                          <div className="user-text">{m.text}</div>
                        ) : (
                          <div className="ai-body">
                            <MessageRenderer message={m} />
                          </div>
                        )}
                      </div>
                    ))}
                    {/* R2：回合结束后整块复制（GPT 式，一组只有一个复制钮） */}
                    {isAgent && turnText && (
                      <div className="msg-actions">
                        <CopyButton getText={() => turnText} />
                      </div>
                    )}
                  </div>
                );
              });
            })()
          )}
          {/* 思考态融入消息流:作为最后一条消息之后的内容,随滚动呈现(非顶部固定) */}
          <ThinkStream />
        </div>
      ) : tab === 'collab' ? (
        /* ===== 协作聊天 Tab ===== */
        <div style={{ flex: 1, minHeight: 0, padding: '8px 12px 12px', display: 'flex', flexDirection: 'column' }}>
          {!collabRoom ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: 'var(--agent-muted)',
                fontSize: 12,
                textAlign: 'center',
                padding: '24px 12px',
                lineHeight: 1.7,
              }}
            >
              <Users size={18} style={{ opacity: 0.6 }} />
              <span>未加入协作房间，点击顶部「协作」按钮创建或加入后，即可与协作者实时聊天。</span>
            </div>
          ) : (
            <CollaborationChat theme={themeCfg.theme} height="100%" />
          )}
        </div>
      ) : (
        /* ===== 成员 Tab ===== */
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 12px' }}>
          {!collabRoom ? (
            <div style={{ textAlign: 'center', color: 'var(--agent-muted)', fontSize: 12, padding: '24px 12px', lineHeight: 1.7 }}>
              未加入协作房间，暂无成员信息。
            </div>
          ) : collabMembers.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--agent-muted)', fontSize: 12, padding: '24px 12px' }}>
              {t('collab.noMembers')}
            </div>
          ) : (
            collabMembers.map((member) => {
              const online = member.sessions.some((s) => s.status === 'online');
              const muted = member.sessions.some((s) => s.status === 'muted');
              const banned = member.sessions.some((s) => s.status === 'banned');
              return (
                <div
                  key={member.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 4px',
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--agent-text)',
                      background: 'var(--agent-surface-2)',
                      border: `2px solid ${online ? '#52c41a' : 'var(--agent-border)'}`,
                    }}
                  >
                    {member.isSelf ? (member.nickname || '我').charAt(0) : (member.nickname || '?').charAt(0)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--agent-text)',
                          lineHeight: 1.2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {member.nickname || t('collab.unnamed')}
                      </span>
                      {member.isSelf && (
                        <span style={{ fontSize: 10, color: 'var(--agent-muted)' }}>({t('collab.self')})</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--agent-muted)', lineHeight: 1.4 }}>
                      {t(`collab.role.${member.role}`)}
                      {banned ? ` · ${t('collab.memberBanned')}` : muted ? ` · ${t('collab.memberMuted')}` : online ? ` · ${t('collab.status.online')}` : ''}
                    </div>
                  </div>
                  {isRoomOwner && !member.isSelf && (
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <Button
                        size="small"
                        type="text"
                        icon={muted ? <Volume2 size={13} /> : <VolumeX size={13} />}
                        onClick={() => void handleToggleMute(member)}
                        loading={busyUserId === member.userId}
                        title={muted ? t('collab.unmute') : t('collab.mute')}
                        style={{ color: 'var(--agent-muted)' }}
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<Shield size={13} />}
                        onClick={() => void handleKick(member)}
                        loading={busyUserId === member.userId}
                        title={t('collab.kick')}
                        style={{ color: 'var(--agent-muted)' }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ===== 输入区（仅对话 Tab） ===== */}
      {tab === 'chat' && <PinnedTodoSlot />}
      {tab === 'chat' && <ComposerInput />}
    </div>
  );
}
