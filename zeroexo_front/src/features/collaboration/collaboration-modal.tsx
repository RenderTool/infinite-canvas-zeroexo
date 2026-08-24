/**
 * CollaborationModal - 协作管理弹窗（统一组件）
 *
 * 画布内 Nav「协作」入口与主页「发起协作 / 协作详情」入口共用。
 * 按「协作状态 × 角色」分派视图：
 *   - idle（未开启）：房主看到"开启协作"按钮 + 加入协作 Tab
 *   - active（协作中，房主）：发起协作 Tab（邀请码/权限/成员/关闭）+ 加入协作 Tab
 *   - active（协作中，参与者）：加入更多协作 Tab + 退出本次协作 Tab
 *   - expired（已失效，参与者）：失效视图（提示 + 从列表移除）
 *   - expired（已失效，房主）：视同 idle，可重新开启
 *
 * 状态单一事实源：useCollaborationStore 的 room/status；本地 state 仅保留
 * 表单输入（邀请码/权限/成员列表镜像）。
 */

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { App, Modal, Button, Select, Checkbox, Tabs, Input, Switch } from 'antd';
import { Copy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CollaborationMember } from './collaboration-types';
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
  removeSelfFromRoom,
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
  const [members, setMembers] = useState<CollaborationMember[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<number>(0);
  const [allowChat, setAllowChat] = useState(true);
  const [allowAgentChat, setAllowAgentChat] = useState(true);
  const [allowEdit, setAllowEdit] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('manage');

  // 单一事实源：store 中的房间信息与协作状态
  const storeRoom = useCollaborationStore((s) => s.room);
  const status = useCollaborationStore((s) => s.status);

  // 角色判定：房间存在时按 ownerId 判断；
  // 房间不存在(未开启)时能打开协作弹窗者必为画布所有者（非所有者需通过邀请码进入，此时房间必然存在）
  const isOwner = storeRoom ? storeRoom.ownerId === String(user?.id) : true;

  // 初始化 tab: 房主默认"发起协作"(含未开启面板)，参与者默认"加入协作"
  useEffect(() => {
    if (open) {
      setActiveTab(isOwner ? 'manage' : 'join');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 重置本地表单状态（弹窗关闭后重新打开时触发）
  const resetState = useCallback(() => {
    setInviteCode('');
    setMembers([]);
    setJoinCode('');
    setExpiresInHours(0);
    setAllowChat(true);
    setAllowAgentChat(true);
    setAllowEdit(true);
    setAllowDownload(false);
  }, []);

  // 加载房间信息（不自动创建；房间不存在 → 显示"未开启"状态）
  const loadRoom = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRoomByCanvas(canvasId);
      useCollaborationStore.getState().setRoom(data); // null → status idle
      if (!data) {
        setInviteCode('');
        setMembers([]);
        useCollaborationStore.getState().setMembers([]);
        return;
      }
      setInviteCode(data.inviteCode);
      setAllowChat(data.allowChat);
      setAllowAgentChat(data.allowAgentChat);
      setAllowEdit(data.allowEdit);
      setAllowDownload(data.allowDownload);
      setExpiresInHours(data.expiresAt ? 24 : 0);
      if (data.status === 'active') {
        try {
          const memberList = await listMembers(canvasId);
          setMembers(memberList);
          useCollaborationStore.getState().setMembers(memberList);
        } catch {
          setMembers([]);
        }
      } else {
        setMembers([]);
      }
    } catch (err) {
      console.error('[CollaborationModal] load room failed:', err);
      message.error(t('collab.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [canvasId, message, t]);

  useEffect(() => {
    if (open) {
      // 先重置本地表单，再加载新鲜数据（避免旧状态残留）
      resetState();
      void loadRoom();
    }
  }, [open, resetState, loadRoom]);

  // 开启协作（仅画布所有者）
  const handleStartCollaboration = async () => {
    setLoading(true);
    try {
      const data = await createRoom({ canvasId, mode: 'invite-only' });
      useCollaborationStore.getState().setRoom(data);
      setInviteCode(data.inviteCode);
      setAllowChat(data.allowChat);
      setAllowAgentChat(data.allowAgentChat);
      setAllowEdit(data.allowEdit);
      setAllowDownload(data.allowDownload);
      setExpiresInHours(data.expiresAt ? 24 : 0);
      const memberList = await listMembers(canvasId);
      setMembers(memberList);
      useCollaborationStore.getState().setMembers(memberList);
      message.success(t('collab.collabStarted'));
    } catch (err) {
      console.error('[CollaborationModal] start collaboration failed:', err);
      message.error(t('collab.startFailed'));
    } finally {
      setLoading(false);
    }
  };

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
      useCollaborationStore.getState().setRoom(roomData);
      setInviteCode(roomData.inviteCode);
      const memberList = await listMembers(targetCanvasId);
      setMembers(memberList);
      useCollaborationStore.getState().setMembers(memberList);
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

  // 通过邀请链接(/c/<code>)进入时:预填邀请码、切到"加入协作"Tab 并自动申请
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
      cancelText: t('common.cancel'),
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

  // 关闭协作（房主；关闭后回到"未开启"状态）
  const handleCloseRoom = async () => {
    if (!isOwner) return;
    modal.confirm({
      title: t('collab.closeRoomConfirmTitle'),
      content: t('collab.closeRoomConfirmContent'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        try {
          await closeRoom(canvasId);
          useCollaborationStore.getState().setRoom(null);
          message.success(t('collab.roomClosed'));
        } catch (err) {
          console.error('[CollaborationModal] close room failed:', err);
          message.error(t('collab.closeFailed'));
        }
      },
    });
  };

  // 参与者退出本次协作
  const handleExitCollaboration = () => {
    modal.confirm({
      title: t('collab.exitConfirmTitle'),
      content: t('collab.exitConfirmContent'),
      okText: t('collab.exitCollaboration'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        try {
          await removeSelfFromRoom(canvasId);
          useCollaborationStore.getState().setRoom(null);
          message.success(t('collab.exitSuccess'));
          onClose();
        } catch (err) {
          console.error('[CollaborationModal] exit collaboration failed:', err);
          message.error(t('collab.operationFailed'));
        }
      },
    });
  };

  // 失效协作：从列表移除
  const handleRemoveFromList = async () => {
    setLoading(true);
    try {
      await removeSelfFromRoom(canvasId);
      useCollaborationStore.getState().setRoom(null);
      message.success(t('collab.removedSuccess'));
      onClose();
    } catch (err) {
      console.error('[CollaborationModal] remove from list failed:', err);
      message.error(t('collab.operationFailed'));
    } finally {
      setLoading(false);
    }
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

  // ==================== 视图片段 ====================

  /** 未开启 / 已失效(房主视角) → 开启面板 */
  const renderStartPanel = () => (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ ...cardTitleStyle, marginBottom: 0 }}>{t('collab.inviteSection')}</div>
        <Switch
          checked={false}
          loading={loading}
          onChange={(checked) => {
            if (checked) void handleStartCollaboration();
          }}
        />
      </div>
      <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
        <div style={{ color: theme.toolbar.text, fontSize: 14, marginBottom: 4 }}>
          {t('collab.notStarted')}
        </div>
        <div style={{ color: theme.toolbar.textMuted, fontSize: 13 }}>
          {t('collab.notStartedHint')}
        </div>
      </div>
    </div>
  );

  /** 房主发起协作面板（active） */
  const renderManagePanel = () => (
    <>
      {/* 邀请卡片 */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ ...cardTitleStyle, marginBottom: 0 }}>{t('collab.inviteSection')}</div>
          <Switch
            checked
            loading={loading}
            onChange={(checked) => {
              if (!checked) void handleCloseRoom();
            }}
          />
        </div>

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
      </div>

      {/* 权限设置卡片 */}
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
    </>
  );

  /** 加入协作卡片（房主/参与者共用） */
  const renderJoinCard = (label: string) => (
    <div style={cardStyle}>
      <div style={cardTitleStyle}>{label}</div>
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
  );

  /** 参与者退出本次协作卡片 */
  const renderExitCard = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <div style={{ color: theme.toolbar.textMuted, fontSize: 13 }}>
          {t('collab.exitHint')}
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <Button danger loading={loading} onClick={handleExitCollaboration}>
          {t('collab.exitCollaboration')}
        </Button>
      </div>
    </div>
  );

  /** 参与者失效视图 */
  const renderExpiredView = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: theme.toolbar.text, marginBottom: 8 }}>
          {t('collab.roomExpired')}
        </div>
        <div style={{ color: theme.toolbar.textMuted, fontSize: 13 }}>
          {t('collab.roomExpiredHint')}
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <Button danger size="small" loading={loading} onClick={() => void handleRemoveFromList()}>
          {t('collab.removeFromList')}
        </Button>
      </div>
    </div>
  );

  // 参与者视角（房间存在且非房主）：失效 → 失效视图；协作中 → 加入更多/退出 双 Tab
  const isGuestExpired = status === 'expired' && !isOwner;

  const tabs = isOwner
    ? [
        {
          key: 'manage',
          label: t('collab.createRoom'),
          children: status === 'active' ? renderManagePanel() : renderStartPanel(),
        },
        {
          key: 'join',
          label: t('collab.joinRoom'),
          children: renderJoinCard(t('collab.applyJoinSection')),
        },
      ]
    : [
        {
          key: 'join',
          label: t('collab.joinMoreCollaboration'),
          children: renderJoinCard(t('collab.joinMoreCollaboration')),
        },
        {
          key: 'exit',
          label: t('collab.exitCollaboration'),
          children: renderExitCard(),
        },
      ];

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
      {isGuestExpired ? (
        renderExpiredView()
      ) : (
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          style={{ marginBottom: 0 }}
          items={tabs}
        />
      )}
    </Modal>
  );
}
