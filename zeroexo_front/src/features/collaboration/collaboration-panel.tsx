/**
 * CollaborationPanel - 协作面板(Dock)
 *
 * 悬浮在画布右侧的协作面板,含两个 Tab:
 * - 聊天: 实时协作聊天(CollaborationChat)
 * - 成员: 在线成员列表 + 房主可禁言/移出
 *
 * 通过 TopBar 的协作聊天按钮开关。
 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, message } from 'antd';
import { X, Shield, VolumeX, Volume2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CollaborationMember } from './collaboration-types.js';
import { listMembers, kickMember, muteMember, unmuteMember } from './collaboration-api.js';
import { useCollaborationStore } from './use-collaboration-store.js';
import { CollaborationChat } from './collaboration-chat.js';

export interface CollaborationPanelProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
}

export function CollaborationPanel({ open, onClose, theme }: CollaborationPanelProps): React.ReactElement | null {
  const { t } = useTranslation();
  const store = useCollaborationStore();
  const room = store.room;
  const members = store.members;

  const [activeTab, setActiveTab] = useState<'chat' | 'members'>('chat');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  if (!open) return null;

  // 当前用户是否房主(房主才可管理成员);由后端返回的 isOwner 标记判断
  const isRoomOwner = room?.isOwner ?? false;

  const refreshMembers = async () => {
    if (!room) return;
    try {
      const list = await listMembers(room.canvasId);
      store.setMembers(list);
    } catch { /* ignore */ }
  };

  const handleToggleMute = async (member: CollaborationMember) => {
    if (!room) return;
    setBusyUserId(member.userId);
    try {
      const muted = member.sessions.some((s) => s.status === 'muted');
      if (muted) {
        await unmuteMember(room.canvasId, member.userId);
        message.success(t('collab.memberUnmutedSuccess'));
      } else {
        await muteMember(room.canvasId, member.userId);
        message.success(t('collab.memberMutedSuccess'));
      }
      await refreshMembers();
    } catch (err) {
      console.error('[CollaborationPanel] toggle mute failed:', err);
    } finally {
      setBusyUserId(null);
    }
  };

  const handleKick = async (member: CollaborationMember) => {
    if (!room) return;
    setBusyUserId(member.userId);
    try {
      await kickMember(room.canvasId, member.userId);
      await refreshMembers();
      message.success(t('collab.memberKicked'));
    } catch (err) {
      console.error('[CollaborationPanel] kick failed:', err);
      message.error(t('collab.kickFailed'));
    } finally {
      setBusyUserId(null);
    }
  };

  const onlineCount = members.filter((m) => m.sessions.some((s) => s.status === 'online')).length;

  const panelStyle: CSSProperties = {
    position: 'absolute',
    top: 56,
    right: 12,
    bottom: 12,
    width: 320,
    zIndex: 40,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 10,
    overflow: 'hidden',
    background: theme.toolbar.panel,
    border: `1px solid ${theme.toolbar.border}`,
    boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: `1px solid ${theme.toolbar.border}`,
  };

  const titleStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: theme.toolbar.text,
  };

  const badgeStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    borderRadius: 10,
    padding: '1px 8px',
  };

  const memberRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 4px',
  };

  const avatarStyle: (online: boolean) => CSSProperties = (online) => ({
    width: 28,
    height: 28,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 600,
    color: theme.toolbar.text,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
    border: `2px solid ${online ? '#52c41a' : theme.toolbar.border}`,
  });

  const nameStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: theme.toolbar.text,
    lineHeight: 1.2,
  };

  const metaStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    lineHeight: 1.4,
  };

  return (
    <div style={panelStyle}>
      {/* 面板头部 */}
      <div style={headerStyle}>
        <div style={titleStyle}>
          <Users size={15} />
          <span>{t('collab.title')}</span>
          <span style={badgeStyle}>
            {onlineCount}/{members.length} {t('collab.membersOnline')}
          </span>
        </div>
        <Button
          size="small"
          type="text"
          icon={<X size={15} />}
          onClick={onClose}
          title={t('common.close')}
          style={{ color: theme.toolbar.textMuted }}
        />
      </div>

      {/* Tab 切换 */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: `1px solid ${theme.toolbar.border}`,
        }}
      >
        {(['chat', 'members'] as const).map((key) => (
          <Button
            key={key}
            size="small"
            type={activeTab === key ? 'primary' : 'text'}
            onClick={() => setActiveTab(key)}
            style={{ flex: 1 }}
          >
            {key === 'chat' ? t('collab.chatTab') : t('collab.memberTab')}
          </Button>
        ))}
      </div>

      {/* 聊天 Tab */}
      {activeTab === 'chat' && (
        <div style={{ flex: 1, minHeight: 0, padding: '0 12px 12px' }}>
          <CollaborationChat theme={theme} height="100%" />
        </div>
      )}

      {/* 成员 Tab */}
      {activeTab === 'members' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px' }}>
          {members.length === 0 ? (
            <div style={{ textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 12, padding: '24px 0' }}>
              {t('collab.noMembers')}
            </div>
          ) : (
            members.map((member) => {
              const online = member.sessions.some((s) => s.status === 'online');
              const muted = member.sessions.some((s) => s.status === 'muted');
              const banned = member.sessions.some((s) => s.status === 'banned');
              return (
                <div key={member.userId} style={memberRowStyle}>
                  <span style={avatarStyle(online)}>
                    {member.isSelf ? (member.nickname || '我').charAt(0) : (member.nickname || '?').charAt(0)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...nameStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {member.nickname || t('collab.unnamed')}
                      </span>
                      {member.isSelf && (
                        <span style={{ fontSize: 10, color: theme.toolbar.textMuted }}>({t('collab.self')})</span>
                      )}
                    </div>
                    <div style={metaStyle}>
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
                        style={{ color: theme.toolbar.textMuted }}
                      />
                      <Button
                        size="small"
                        type="text"
                        icon={<Shield size={13} />}
                        onClick={() => void handleKick(member)}
                        loading={busyUserId === member.userId}
                        title={t('collab.kick')}
                        style={{ color: theme.toolbar.textMuted }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
