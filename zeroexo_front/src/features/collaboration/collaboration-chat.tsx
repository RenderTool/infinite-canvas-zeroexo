/**
 * CollaborationChat + MentionInput - 协作聊天组件
 *
 * MentionInput:
 * - 自动增高文本域,输入 @ 时弹出成员/AI 提及建议
 * - Enter 发送, Shift+Enter 换行
 *
 * CollaborationChat:
 * - 实时消息列表(由 SSE 事件驱动更新)
 * - 消息气泡: 发送者昵称 + 角色标签 + 时间 + 提及高亮
 * - 支持删除自己的消息
 * - 底部输入区 + 发送按钮
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { Button, Input, message, Spin } from 'antd';
import { Send, X, Bot, CornerUpLeft, Reply } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { useAuth } from '@/features/auth/auth-store.js';
import type { CollaborationMember, CollaborationMessage } from './collaboration-types.js';
import {
  listMessages,
  sendMessage,
  deleteMessage,
  executeAgent,
} from './collaboration-api.js';
import { useCollaborationStore } from './use-collaboration-store.js';

/** 提及 AI 时使用的固定标签(与内容匹配一致) */
const AGENT_MENTION = 'AI';

/** 提取内容中的提及(成员昵称 + AI) */
function extractMentions(content: string, members: CollaborationMember[]): {
  mentions: string[];
  agentMentioned: boolean;
} {
  const mentions: string[] = [];
  for (const m of members) {
    if (m.nickname && content.includes(`@${m.nickname}`)) {
      mentions.push(m.nickname);
    }
  }
  const agentMentioned = new RegExp(`@${AGENT_MENTION}`, 'i').test(content);
  return { mentions, agentMentioned };
}

/** 渲染带提及高亮的消息内容 */
function renderMentionText(content: string, accent: string): React.ReactNode[] {
  const parts = content.split(/(@[\w\u4e00-\u9fa5-]+)/g);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} style={{ color: accent, fontWeight: 500 }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// ==================== MentionInput ====================

export interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  members: CollaborationMember[];
  allowAgent: boolean;
  placeholder?: string;
  disabled?: boolean;
  theme: ThemeConfig;
}

export function MentionInput({
  value,
  onChange,
  onSend,
  members,
  allowAgent,
  placeholder,
  disabled,
  theme,
}: MentionInputProps): React.ReactElement {
  const { t } = useTranslation();
  const textareaRef = useRef<TextAreaRef>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);

  // 获取 TextArea 内部的原生 textarea 元素(用于读取/设置光标位置)
  const getTextarea = (): HTMLTextAreaElement | null =>
    textareaRef.current?.resizableTextArea?.textArea ?? null;

  // 根据光标位置检测是否处于 "@ 提及" 输入中
  useEffect(() => {
    const el = getTextarea();
    if (!el) {
      setMention(null);
      return;
    }
    const caret = el.selectionStart;
    const text = value;
    if (caret <= 0) {
      setMention(null);
      return;
    }
    let at = caret - 1;
    while (at >= 0) {
      const ch = text.charAt(at);
      if (ch === '@') break;
      if (/\s/.test(ch)) {
        at = -1;
        break;
      }
      at--;
    }
    if (at < 0 || (at > 0 && !/\s/.test(text.charAt(at - 1)))) {
      setMention(null);
      return;
    }
    const query = text.slice(at + 1, caret);
    if (query.length > 30) {
      setMention(null);
      return;
    }
    setMention({ start: at, query });
  }, [value]);

  // 提及建议列表: 成员(模糊匹配昵称) + AI 助手
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const list: { key: string; label: string; type: 'member' | 'agent' }[] = [];

    if (allowAgent && 'ai'.startsWith(q)) {
      list.push({ key: '__agent__', label: AGENT_MENTION, type: 'agent' });
    }

    for (const m of members) {
      if (!m.nickname) continue;
      if (!q || m.nickname.toLowerCase().includes(q)) {
        list.push({ key: m.userId, label: m.nickname, type: 'member' });
      }
    }
    return list.slice(0, 8);
  }, [mention, members, allowAgent]);

  // 选择提及建议,替换 "@查询词" 为 "@昵称 "
  const selectSuggestion = (label: string) => {
    if (!mention) return;
    const prefix = value.slice(0, mention.start);
    const suffix = value.slice(mention.start + 1 + mention.query.length);
    const next = `${prefix}@${label} ${suffix}`;
    onChange(next);
    setMention(null);
    const caret = prefix.length + label.length + 2;
    requestAnimationFrame(() => {
      const el = getTextarea();
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = caret;
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const first = suggestions[0];
      if (mention && first) {
        selectSuggestion(first.label);
      } else {
        onSend();
      }
    } else if (e.key === 'Escape') {
      setMention(null);
    }
  };

  const popupStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    bottom: '100%',
    marginBottom: 4,
    width: '100%',
    maxHeight: 180,
    overflow: 'auto',
    zIndex: 10,
    borderRadius: 8,
    padding: 4,
    background: theme.toolbar.panel,
    border: `1px solid ${theme.toolbar.border}`,
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
  };

  const suggestionStyle: (active: boolean) => CSSProperties = (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    color: theme.toolbar.text,
    background: active ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent',
  });

  return (
    <div style={{ position: 'relative' }}>
      {mention && suggestions.length > 0 && (
        <div style={popupStyle}>
          {suggestions.map((s, idx) => (
            <div
              key={s.key}
              style={suggestionStyle(idx === 0)}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(s.label);
              }}
            >
              {s.type === 'agent' ? (
                <Bot size={13} style={{ color: theme.toolbar.accent, flexShrink: 0 }} />
              ) : (
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    flexShrink: 0,
                    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                  }}
                >
                  {s.label.charAt(0)}
                </span>
              )}
              <span>{s.type === 'agent' ? t('collab.chatAgent') : s.label}</span>
            </div>
          ))}
        </div>
      )}
      <Input.TextArea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoSize={{ minRows: 1, maxRows: 5 }}
        style={{
          fontSize: 13,
          color: theme.toolbar.text,
          background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
          borderColor: theme.toolbar.border,
          resize: 'none',
        }}
      />
    </div>
  );
}

// ==================== CollaborationChat ====================

export interface CollaborationChatProps {
  theme: ThemeConfig;
  height?: number | string;
}

export function CollaborationChat({ theme, height }: CollaborationChatProps): React.ReactElement {
  const { t } = useTranslation();
  const store = useCollaborationStore();
  const messages = store.messages;
  const room = store.room;
  const members = store.members;
  const { user } = useAuth();
  const currentUserId = String(user?.id ?? '');

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [replyingTo, setReplyingTo] = useState<CollaborationMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const canChat = room?.allowChat ?? true;

  // 挂载时加载历史消息
  useEffect(() => {
    const loadHistory = async () => {
      if (!room) return;
      setLoadingHistory(true);
      try {
        const history = await listMessages(room.canvasId, 50);
        store.setMessages(history);
      } catch (err) {
        console.error('[CollaborationChat] load history failed:', err);
      } finally {
        setLoadingHistory(false);
      }
    };
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.canvasId]);

  // 新消息自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !room || sending) return;
    if (!canChat) {
      message.warning(t('collab.chatNotAllowed'));
      return;
    }
    setSending(true);
    try {
      const { mentions, agentMentioned } = extractMentions(content, members);
      const replyToId = replyingTo?.id;
      // 1. 先发送用户消息（普通文本，所有成员可见）
      const msg = await sendMessage(room.canvasId, { content, mentions, agentMentioned, replyToId });
      store.addMessage(msg);
      setText('');
      setReplyingTo(null);
      // 2. 若 @AI 触发 → 执行协作 Agent（思考态由 SSE 事件驱动，结果经 agent_result/message 广播）
      if (agentMentioned && room.allowAgentChat) {
        try {
          await executeAgent(room.canvasId, { content, mentions, replyToId });
        } catch (agentErr) {
          console.error('[CollaborationChat] execute agent failed:', agentErr);
          message.error(t('collab.agentExecuteFailed'));
        }
      }
    } catch (err) {
      console.error('[CollaborationChat] send failed:', err);
      message.error(t('collab.chatFailed'));
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (msg: CollaborationMessage) => {
    if (!room) return;
    try {
      await deleteMessage(room.canvasId, msg.id);
      store.removeMessage(msg.id);
      message.success(t('collab.chatDeleted'));
    } catch (err) {
      console.error('[CollaborationChat] delete failed:', err);
      message.error(t('collab.chatDeleteFailed'));
    }
  };

  const containerStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: height ?? '100%',
    minHeight: 0,
  };

  const listStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '4px 2px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  const inputAreaStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 10,
    borderTop: `1px solid ${theme.toolbar.border}`,
  };

  return (
    <div style={containerStyle}>
      <div style={listStyle}>
        {loadingHistory ? null : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 12, padding: '24px 0' }}>
            {t('collab.chatEmpty')}
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.type === 'system') {
              return (
                <div
                  key={msg.id}
                  style={{ textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 11 }}
                >
                  {msg.content}
                </div>
              );
            }
            const isAgent = msg.type === 'agent' || msg.type === 'agent_action';
            const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            // 被引用的原消息（replyToId）
            const quoted = msg.replyToId ? messages.find((m) => m.id === msg.replyToId) : undefined;
            return (
              <div key={msg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    color: theme.toolbar.text,
                    background: isAgent
                      ? (theme.mode === 'dark' ? 'rgba(64,128,255,0.25)' : 'rgba(64,128,255,0.15)')
                      : (theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
                  }}
                >
                  {isAgent ? <Bot size={14} /> : (msg.senderName || '?').charAt(0)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: theme.toolbar.text }}>
                      {isAgent ? t('collab.chatAgent') : msg.senderName}
                    </span>
                    {!isAgent && (
                      <span style={{ fontSize: 10, color: theme.toolbar.textMuted }}>
                        {t(`collab.role.${msg.senderRole}`)}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: theme.toolbar.textMuted }}>{time}</span>
                    {msg.senderId === store.room?.ownerId && !isAgent && (
                      <span style={{ fontSize: 10, color: theme.toolbar.accent }}>{t('collab.role.owner')}</span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: theme.toolbar.text,
                      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                      borderRadius: 8,
                      padding: '6px 10px',
                      wordBreak: 'break-word',
                    }}
                  >
                    {/* 被引用的原消息预览 */}
                    {quoted && (
                      <div
                        style={{
                          marginBottom: 6,
                          padding: '4px 8px',
                          borderLeft: `2px solid ${theme.toolbar.accent}`,
                          borderRadius: 4,
                          background: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                          fontSize: 12,
                          color: theme.toolbar.textMuted,
                          cursor: 'pointer',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        onClick={() => {
                          bottomRef.current?.scrollIntoView({ block: 'nearest' });
                        }}
                        title={quoted.content}
                      >
                        <CornerUpLeft size={11} style={{ marginRight: 6, verticalAlign: -2 }} />
                        <span style={{ fontWeight: 500, color: theme.toolbar.text }}>
                          {quoted.senderId === 'agent' ? t('collab.chatAgent') : quoted.senderName}
                        </span>
                        : {quoted.content}
                      </div>
                    )}
                    {renderMentionText(msg.content, theme.toolbar.accent)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                  <Button
                    size="small"
                    type="text"
                    icon={<Reply size={13} />}
                    onClick={() => setReplyingTo(msg)}
                    style={{ color: theme.toolbar.textMuted }}
                    title={t('collab.reply')}
                  />
                  {room && (msg.senderId === currentUserId || room.ownerId === currentUserId) && (
                    <Button
                      size="small"
                      type="text"
                      icon={<X size={13} />}
                      onClick={() => void handleDelete(msg)}
                      style={{ color: theme.toolbar.textMuted }}
                      title={t('collab.chatDelete')}
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
        {/* Agent 思考中指示器（SSE agent_thinking / agent_tool_call 驱动） */}
        {store.agentStatus?.thinking && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: theme.mode === 'dark' ? 'rgba(64,128,255,0.25)' : 'rgba(64,128,255,0.15)',
              }}
            >
              <Bot size={14} style={{ color: theme.toolbar.accent }} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: theme.toolbar.text }}>
                  {t('collab.chatAgent')}
                </span>
                <span style={{ fontSize: 10, color: theme.toolbar.textMuted }}>
                  {store.agentStatus.toolName
                    ? t('collab.agentToolCall', { tool: store.agentStatus.toolName })
                    : t('collab.agentThinking')}
                </span>
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: theme.toolbar.textMuted,
                  background: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  borderRadius: 8,
                  padding: '6px 10px',
                }}
              >
                <Spin size="small" />
                {store.agentStatus.toolName ? t('collab.agentToolWorking') : t('collab.agentWorking')}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 回复引用条：正在回复某条消息 */}
      {replyingTo && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            marginTop: 10,
            borderRadius: 8,
            background: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${theme.toolbar.border}`,
            fontSize: 12,
            color: theme.toolbar.textMuted,
          }}
        >
          <CornerUpLeft size={13} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t('collab.replyingTo')}{' '}
            <span style={{ fontWeight: 500, color: theme.toolbar.text }}>
              {replyingTo.senderId === 'agent' ? t('collab.chatAgent') : replyingTo.senderName}
            </span>
            : {replyingTo.content}
          </span>
          <Button
            size="small"
            type="text"
            icon={<X size={13} />}
            onClick={() => setReplyingTo(null)}
            style={{ color: theme.toolbar.textMuted, flexShrink: 0 }}
            title={t('collab.cancelReply')}
          />
        </div>
      )}

      <div style={inputAreaStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MentionInput
            value={text}
            onChange={setText}
            onSend={() => void handleSend()}
            members={members}
            allowAgent={room?.allowAgentChat ?? true}
            placeholder={t('collab.chatPlaceholder')}
            disabled={!canChat || sending}
            theme={theme}
          />
        </div>
        <Button
          type="primary"
          size="small"
          icon={<Send size={13} />}
          onClick={() => void handleSend()}
          loading={sending}
          disabled={!canChat}
        >
          {t('collab.chatSend')}
        </Button>
      </div>
    </div>
  );
}
