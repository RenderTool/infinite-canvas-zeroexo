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

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { App, Modal, Button, Select, Checkbox, Tabs, Input } from 'antd';
import { Copy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CollaborationRoom, CollaborationMember } from './collaboration-types';
import {
  createRoom,
  getRoomByCanvas,
  updateRoom,
  regenerateInvite,
  closeRoom,
  listMembers,
  kickMember,
  banMember,
  muteMember,
  unmuteMember,
  joinRoom,
  verifyInvite,
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
  /** 加入非同画布房间时，跳转到目标画布编辑器 */
  onNavigateToCanvas?: (canvasId: string, inviteCode?: string) => void;
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
  onNavigateToCanvas,
}: CollaborationModalProps): React.ReactElement {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [room, setRoom] = useState<CollaborationRoom | null>(null);
  const [members, setMembers] = useState<CollaborationMember[]>([]);
  const [inviteCode, setInviteCode] = useState('');
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

  // 重置所有本地状态（弹窗关闭后重新打开时触发）
  const resetState = useCallback(() => {
    setRoom(null);
    setInviteCode('');
    setMembers([]);
    setJoinCode('');
    setActiveTab('create');
    setExpiresInHours(0);
    setAllowChat(true);
    setAllowAgentChat(true);
    setAllowEdit(true);
    setAllowDownload(false);
  }, []);

  // 加载房间信息
  const loadRoom = useCallback(async () => {
    setLoading(true);
    try {
      let data = await getRoomByCanvas(canvasId);
      if (!data) {
        // 房间不存在（已关闭或从未创建）→ 自动创建新房间
        try {
          data = await createRoom({ canvasId, mode: 'invite-only' });
        } catch (createErr) {
          console.error('[CollaborationModal] auto-create room failed:', createErr);
          setRoom(null);
          setInviteCode('');
          setMembers([]);
          useCollaborationStore.getState().setMembers([]);
          return;
        }
      }
      setRoom(data);
      setInviteCode(data.inviteCode);
      setAllowChat(data.allowChat);
      setAllowAgentChat(data.allowAgentChat);
      setAllowEdit(data.allowEdit);
      setAllowDownload(data.allowDownload);
      setExpiresInHours(data.expiresAt ? 24 : 0);
      // 同步到全局 store，确保 collaborationActive 为 true，光标广播等协作功能正常
      useCollaborationStore.getState().setRoom(data);
      useCollaborationStore.getState().setActive(true);
      // 加载成员列表
      const memberList = await listMembers(canvasId);
      setMembers(memberList);
      useCollaborationStore.getState().setMembers(memberList);
    } catch (err) {
      console.error('[CollaborationModal] load room failed:', err);
      message.error(t('collab.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [canvasId, message, t]);

  useEffect(() => {
    if (open) {
      // 先重置状态，再加载新鲜数据（避免旧状态残留）
      resetState();
      void loadRoom();
    }
  }, [open, resetState, loadRoom]);

  // 动态构造邀请链接，不依赖后端存储的静态域名
  const dynamicInviteLink = inviteCode ? `${window.location.origin}/c/${inviteCode}` : '';

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
      message.success(t('collab.inviteRegenerated'));
    } catch (err) {
      console.error('[CollaborationModal] regenerate invite failed:', err);
      message.error(t('collab.regenerateFailed'));
    }
  };

  /** 从完整邀请链接中提取 6 位邀请码 */
  const extractInviteCode = (raw: string): string => {
    const match = raw.match(/\/c\/([A-Za-z0-9]{6})$/);
    return match ? match[1]! : raw.trim();
  };

  // 通过邀请码加入协作(核心逻辑,供手动申请与邀请链接自动申请共用)
  const doJoin = async (raw: string) => {
    const code = extractInviteCode(raw);
    if (!code) return;
    setJoinLoading(true);
    try {
      // 先验证邀请码，获取正确的 canvasId（避免手动输入时 canvasId 不匹配）
      const roomInfo = await verifyInvite(code);
      if (!roomInfo) {
        message.error(t('collab.inviteCodeInvalid'));
        return;
      }
      const targetCanvasId = roomInfo.canvasId;
      await joinRoom(targetCanvasId, code);
      // 加入成功后重新加载房间与成员
      const roomData = await getRoomByCanvas(targetCanvasId);
      setRoom(roomData);
      setInviteCode(roomData.inviteCode);
      const memberList = await listMembers(targetCanvasId);
      setMembers(memberList);
      useCollaborationStore.getState().setRoom(roomData);
      useCollaborationStore.getState().setMembers(memberList);
      useCollaborationStore.getState().setActive(true);
      message.success(t('collab.applyJoinSuccess'));
      // 如果加入的是非同画布房间，跳转到目标画布编辑器
      if (targetCanvasId !== canvasId) {
        onClose();
        onNavigateToCanvas?.(targetCanvasId, code);
      }
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

  // 踢除成员（可选封禁）
  const handleKickMember = (userId: string) => {
    if (!isOwner) return;
    modal.confirm({
      title: t('collab.kickConfirmTitle'),
      content: (
        <div>
          <p style={{ marginBottom: 8, color: theme.toolbar.text }}>
            {t('collab.kickConfirmContent')}
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: theme.toolbar.text }}>
            <input type="checkbox" id="kick-ban-check" />
            <span style={{ fontSize: 13 }}>{t('collab.kickAndBan')}</span>
          </label>
        </div>
      ),
      okText: t('collab.kick'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        const banChecked = (document.getElementById('kick-ban-check') as HTMLInputElement)?.checked;
        try {
          if (banChecked) {
            await banMember(canvasId, userId);
          }
          await kickMember(canvasId, userId);
          const updated = await listMembers(canvasId);
          setMembers(updated);
          useCollaborationStore.getState().setMembers(updated);
          message.success(t('collab.memberKicked'));
        } catch (err) {
          console.error('[CollaborationModal] kick member failed:', err);
          message.error(t('collab.kickFailed'));
        }
      },
    });
  };

  // 禁言/解禁成员
  const handleMuteMember = async (userId: string, currentlyMuted: boolean) => {
    if (!isOwner) return;
    try {
      if (currentlyMuted) {
        await unmuteMember(canvasId, userId);
      } else {
        await muteMember(canvasId, userId);
      }
      const updated = await listMembers(canvasId);
      setMembers(updated);
      useCollaborationStore.getState().setMembers(updated);
      message.success(currentlyMuted ? t('collab.memberUnmuted') : t('collab.memberMuted'));
    } catch (err) {
      console.error('[CollaborationModal] mute/unmute member failed:', err);
      message.error(t('collab.operationFailed'));
    }
  };

  // 关闭协作房间
  const handleCloseRoom = async () => {
    if (!isOwner) return;
    modal.confirm({
      title: t('collab.closeRoomConfirmTitle'),
      content: t('collab.closeRoomConfirmContent'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        try {
          await closeRoom(canvasId);
          useCollaborationStore.getState().setRoom(null);
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
                        {dynamicInviteLink || '-'}
                      </span>
                      <Button
                        size="small"
                        icon={<Copy size={14} />}
                        onClick={() => dynamicInviteLink && handleCopy(dynamicInviteLink)}
                        disabled={!dynamicInviteLink}
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
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                <Button
                                  size="small"
                                  onClick={() => handleMuteMember(member.userId, member.sessions.some((s) => s.status === 'muted'))}
                                >
                                  {member.sessions.some((s) => s.status === 'muted') ? t('collab.unmute') : t('collab.mute')}
                                </Button>
                                <Button
                                  size="small"
                                  danger
                                  onClick={() => handleKickMember(member.userId)}
                                >
                                  {t('collab.kick')}
                                </Button>
                              </div>
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
