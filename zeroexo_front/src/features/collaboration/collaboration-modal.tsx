/**
 * CollaborationModal - 协作管理弹窗
 *
 * 功能:
 * - 邀请卡片: 显示邀请码和邀请链接 + 复制按钮
 * - 权限设置: allowChat/allowAgentChat/allowEdit/allowDownload 复选框
 * - 邀请码过期选择 + 重新生成按钮
 * - 申请加入卡片: 输入邀请码加入
 * - 当前成员列表卡片: 显示每个成员 + 踢人按钮(仅房主)
 * - 关闭协作房间按钮
 */

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { App, Modal, Button, Select, Checkbox, Tabs, Input } from 'antd';
import { Copy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CollaborationRoom, CollaborationMember } from './collaboration-types';
import {
  getRoomByCanvas,
  updateRoom,
  regenerateInvite,
  closeRoom,
  listMembers,
  kickMember,
  joinRoom,
} from './collaboration-api';
import { useCollaborationStore } from './use-collaboration-store';
import { useAuth } from '@/features/auth/auth-store';

export interface CollaborationModalProps {
  open: boolean;
  canvasId: string;
  /** 待处理邀请码(来自 /c/<code> 邀请链接,打开后自动申请加入) */
  pendingInviteCode?: string;
  onClose: () => void;
  theme: ThemeConfig;
}

const EXPIRY_OPTIONS = [
  { label: '永不过期', value: 0 },
  { label: '1小时', value: 1 },
  { label: '1天', value: 24 },
  { label: '7天', value: 168 },
  { label: '30天', value: 720 },
];

export function CollaborationModal({
  open,
  canvasId,
  pendingInviteCode,
  onClose,
  theme,
}: CollaborationModalProps): React.ReactElement {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message } = App.useApp();
  const store = useCollaborationStore();
  const [loading, setLoading] = useState(false);
  const [room, setRoom] = useState<CollaborationRoom | null>(null);
  const [members, setMembers] = useState<CollaborationMember[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<number>(0);
  const [allowChat, setAllowChat] = useState(true);
  const [allowAgentChat, setAllowAgentChat] = useState(true);
  const [allowEdit, setAllowEdit] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');

  const isOwner = room?.ownerId === String(user?.id);
  // 当前用户是否已是房间成员(用于决定是否显示"申请加入"卡片)
  const amMember = members.some((m) => m.isSelf);

  // 初始化 tab: 如果没有房间，默认"创建"；如果已有房间但自己不是成员，默认"加入"
  useEffect(() => {
    if (open) {
      if (!room) {
        setActiveTab('create');
      } else if (!isOwner && !amMember) {
        setActiveTab('join');
      } else {
        setActiveTab('create');
      }
    }
  }, [open, room, isOwner, amMember]);

  // 加载房间信息
  const loadRoom = async () => {
    setLoading(true);
    try {
      const data = await getRoomByCanvas(canvasId);
      setRoom(data);
      setInviteCode(data.inviteCode);
      setInviteLink(data.inviteLink);
      setAllowChat(data.allowChat);
      setAllowAgentChat(data.allowAgentChat);
      setAllowEdit(data.allowEdit);
      setAllowDownload(data.allowDownload);
      setExpiresInHours(data.expiresAt ? 24 : 0);
      // 加载成员列表
      const memberList = await listMembers(canvasId);
      setMembers(memberList);
      store.setMembers(memberList);
    } catch (err) {
      console.error('[CollaborationModal] load room failed:', err);
      message.error(t('collab.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadRoom();
    }
  }, [open, canvasId]);

  // 复制文本到剪贴板
  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('common.copySuccess'));
    } catch (err) {
      console.error('[CollaborationModal] copy failed:', err);
      message.error(t('common.copyFailed'));
    }
  };

  // 重新生成邀请码
  const handleRegenerateInvite = async () => {
    try {
      const data = await regenerateInvite(canvasId, expiresInHours > 0 ? expiresInHours : undefined);
      setInviteCode(data.inviteCode);
      setInviteLink(data.inviteLink);
      message.success(t('collab.inviteRegenerated'));
    } catch (err) {
      console.error('[CollaborationModal] regenerate invite failed:', err);
      message.error(t('collab.regenerateFailed'));
    }
  };

  // 通过邀请码加入协作(核心逻辑,供手动申请与邀请链接自动申请共用)
  const doJoin = async (code: string) => {
    if (!code) return;
    setJoinLoading(true);
    try {
      await joinRoom(canvasId, code);
      // 加入成功后重新加载房间与成员
      const roomData = await getRoomByCanvas(canvasId);
      setRoom(roomData);
      setInviteCode(roomData.inviteCode);
      setInviteLink(roomData.inviteLink);
      const memberList = await listMembers(canvasId);
      setMembers(memberList);
      store.setRoom(roomData);
      store.setMembers(memberList);
      store.setActive(true);
      message.success(t('collab.applyJoinSuccess'));
    } catch (err) {
      console.error('[CollaborationModal] apply join failed:', err);
      message.error(t('collab.inviteCodeInvalid'));
    } finally {
      setJoinLoading(false);
    }
  };

  // 通过邀请码加入协作(手动输入)
  const handleApplyJoin = async () => {
    const code = joinCode.trim();
    if (!code) {
      message.warning(t('collab.applyJoinCodeRequired'));
      return;
    }
    await doJoin(code);
  };

  // 通过邀请链接(/c/<code>)进入时:预填邀请码、切到"申请加入"Tab 并自动申请
  useEffect(() => {
    if (open && pendingInviteCode) {
      setJoinCode(pendingInviteCode);
      setActiveTab('join');
      void doJoin(pendingInviteCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingInviteCode]);

  // 更新房间设置
  const handleUpdateSettings = async () => {
    if (!isOwner) return;
    try {
      await updateRoom(canvasId, {
        allowChat,
        allowAgentChat,
        allowEdit,
        allowDownload,
      });
      message.success(t('collab.settingsUpdated'));
    } catch (err) {
      console.error('[CollaborationModal] update settings failed:', err);
      message.error(t('collab.updateFailed'));
    }
  };

  // 踢除成员
  const handleKickMember = async (userId: string) => {
    if (!isOwner) return;
    try {
      await kickMember(canvasId, userId);
      const updated = await listMembers(canvasId);
      setMembers(updated);
      store.setMembers(updated);
      message.success(t('collab.memberKicked'));
    } catch (err) {
      console.error('[CollaborationModal] kick member failed:', err);
      message.error(t('collab.kickFailed'));
    }
  };

  // 关闭协作房间
  const handleCloseRoom = async () => {
    if (!isOwner) return;
    Modal.confirm({
      title: t('collab.closeRoomConfirmTitle'),
      content: t('collab.closeRoomConfirmContent'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        try {
          await closeRoom(canvasId);
          store.setRoom(null);
          message.success(t('collab.roomClosed'));
          onClose();
        } catch (err) {
          console.error('[CollaborationModal] close room failed:', err);
          message.error(t('collab.closeFailed'));
        }
      },
    });
  };

  const cardStyle: CSSProperties = {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    border: `1px solid ${theme.toolbar.border}`,
  };

  const cardTitleStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
    color: theme.toolbar.text,
  };

  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  };

  const labelStyle: CSSProperties = {
    color: theme.toolbar.text,
    fontSize: 13,
    flexShrink: 0,
  };

  const valueContainerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  };

  const codeTextStyle: CSSProperties = {
    padding: '4px 8px',
    borderRadius: 4,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    fontFamily: 'monospace',
    fontSize: 13,
    color: theme.toolbar.text,
    userSelect: 'all',
    minWidth: 120,
    textAlign: 'right',
  };

  const memberItemStyle: (isSelf: boolean) => CSSProperties = (isSelf) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: isSelf ? 'none' : `1px solid ${theme.toolbar.border}`,
    opacity: isSelf ? 1 : 0.9,
  });

  const memberInfoStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  };

  const memberNameStyle: CSSProperties = {
    fontSize: 13,
    color: theme.toolbar.text,
    fontWeight: 500,
  };

  const memberRoleStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
  };

  return (
    <Modal
      open={open}
      title={t('collab.title')}
      centered
      onCancel={onClose}
      width={680}
      destroyOnHidden
      footer={null}
      styles={{
        mask: { background: 'transparent' },
        body: {
          padding: 20,
          background: theme.toolbar.panel,
          color: theme.toolbar.text,
        },
        header: {
          background: theme.toolbar.panel,
          color: theme.toolbar.text,
        },
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'create' | 'join')}
        style={{ marginBottom: 0 }}
        items={[
          {
            key: 'create',
            label: t('collab.createRoom'),
            children: (
              <>
                {/* 邀请卡片 */}
                {isOwner && (
                <div style={cardStyle}>
                  <div style={cardTitleStyle}>{t('collab.inviteSection')}</div>

                  <div style={rowStyle}>
                    <span style={labelStyle}>{t('collab.inviteCode')}</span>
                    <div style={valueContainerStyle}>
                      <span style={codeTextStyle}>{inviteCode || '-'}</span>
                      <Button
                        size="small"
                        icon={<Copy size={14} />}
                        onClick={() => inviteCode && handleCopy(inviteCode)}
                        disabled={!inviteCode}
                      >
                        {t('common.copy')}
                      </Button>
                    </div>
                  </div>

                  <div style={rowStyle}>
                    <span style={labelStyle}>{t('collab.inviteLink')}</span>
                    <div style={valueContainerStyle}>
                      <span style={{ ...codeTextStyle, textAlign: 'left', flex: 1 }}>
                        {inviteLink || '-'}
                      </span>
                      <Button
                        size="small"
                        icon={<Copy size={14} />}
                        onClick={() => inviteLink && handleCopy(inviteLink)}
                        disabled={!inviteLink}
                      >
                        {t('common.copy')}
                      </Button>
                    </div>
                  </div>

                  {isOwner && (
                    <>
                      <div style={rowStyle}>
                        <span style={labelStyle}>{t('collab.expiresIn')}</span>
                        <div style={valueContainerStyle}>
                          <Select
                            size="small"
                            style={{ width: 140 }}
                            value={expiresInHours}
                            onChange={setExpiresInHours}
                            options={EXPIRY_OPTIONS}
                          />
                        </div>
                      </div>

                      <div style={{ ...rowStyle, justifyContent: 'flex-end', marginTop: 4 }}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<RefreshCw size={14} />}
                          onClick={handleRegenerateInvite}
                          loading={loading}
                        >
                          {t('collab.regenerateInvite')}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                )}

                {/* 权限设置卡片 */}
                {isOwner && (
                  <div style={cardStyle}>
                    <div style={cardTitleStyle}>{t('collab.permissions')}</div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <Checkbox checked={allowChat} onChange={(e) => setAllowChat(e.target.checked)}>
                        <span style={{ color: theme.toolbar.text, fontSize: 13 }}>
                          {t('collab.allowChat')}
                        </span>
                      </Checkbox>
                      <Checkbox checked={allowAgentChat} onChange={(e) => setAllowAgentChat(e.target.checked)}>
                        <span style={{ color: theme.toolbar.text, fontSize: 13 }}>
                          {t('collab.allowAgentChat')}
                        </span>
                      </Checkbox>
                      <Checkbox checked={allowEdit} onChange={(e) => setAllowEdit(e.target.checked)}>
                        <span style={{ color: theme.toolbar.text, fontSize: 13 }}>
                          {t('collab.allowEdit')}
                        </span>
                      </Checkbox>
                      <Checkbox checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)}>
                        <span style={{ color: theme.toolbar.text, fontSize: 13 }}>
                          {t('collab.allowDownload')}
                        </span>
                      </Checkbox>
                    </div>

                    <div style={{ textAlign: 'right', marginTop: 12 }}>
                      <Button
                        type="primary"
                        size="small"
                        onClick={handleUpdateSettings}
                        loading={loading}
                      >
                        {t('common.save')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* 当前成员列表 */}
                <div style={cardStyle}>
                  <div style={cardTitleStyle}>
                    {t('collab.currentMembers')} ({members.length})
                  </div>
                  <div>
                    {members.length === 0 ? (
                      <div style={{ color: theme.toolbar.textMuted, fontSize: 13, padding: '8px 0' }}>
                        {t('collab.noMembers')}
                      </div>
                    ) : (
                      members.map((member) => {
                        const isSelf = member.isSelf;
                        const isOnline = member.sessions.some((s) => s.status === 'online');
                        return (
                          <div key={member.userId} style={memberItemStyle(isSelf)}>
                            <div style={memberInfoStyle}>
                              <span style={memberNameStyle}>
                                {member.nickname || t('collab.unnamed')}
                                {isSelf && ` (${t('collab.self')})`}
                              </span>
                              <span style={memberRoleStyle}>
                                {t(`collab.role.${member.role}`)} · {t(`collab.status.${isOnline ? 'online' : 'offline'}`)}
                              </span>
                            </div>
                            {isOwner && !isSelf && (
                              <Button
                                size="small"
                                danger
                                onClick={() => handleKickMember(member.userId)}
                              >
                                {t('collab.kick')}
                              </Button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 关闭房间按钮 */}
                {isOwner && (
                  <div style={{ textAlign: 'right' }}>
                    <Button danger onClick={handleCloseRoom} loading={loading}>
                      {t('collab.closeRoom')}
                    </Button>
                  </div>
                )}
              </>
            ),
          },
          {
            key: 'join',
            label: t('collab.joinRoom'),
            children: (
              <div style={cardStyle}>
                <div style={cardTitleStyle}>{t('collab.applyJoinSection')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    size="small"
                    placeholder={t('collab.applyJoinPlaceholder')}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    onPressEnter={() => void handleApplyJoin()}
                    style={{ flex: 1 }}
                  />
                  <Button
                    type="primary"
                    size="small"
                    loading={joinLoading}
                    onClick={() => void handleApplyJoin()}
                  >
                    {t('collab.applyJoin')}
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}
