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
import { App, Modal, Button, Select, Switch, Radio } from 'antd';
import { Copy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CollaborationMember, CollaborationStatus, RoomResponse } from './collaboration-types';
import {
  createRoom,
  getRoomByCanvas,
  updateRoom,
  regenerateInvite,
  closeRoom,
  listMembers,
  kickMember,
  muteMember,
  unmuteMember,
  removeSelfFromRoom,
  listApplications,
  approveApplication,
  rejectApplication,
} from './collaboration-api';
import type { JoinApplication } from './collaboration-types';
import { isPendingJoinResult } from './collaboration-types';
import { useCollaborationStore } from './use-collaboration-store';
import { useAuth } from '@/features/auth/auth-store';
import { ApiError } from '@/services/api-client';

export interface CollaborationPanelProps {
  canvasId: string;
  onClose: () => void;
  theme: ThemeConfig;
  /** 面板是否激活(打开)；false 时挂起数据加载与 SSE 监听，默认 true */
  active?: boolean;
}

export interface CollaborationModalProps {
  open: boolean;
  canvasId: string;
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

export function CollaborationPanel({
  active = true,
  canvasId,
  onClose,
  theme,
}: CollaborationPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  // 弹窗视角的房间状态（本地 state，与全局协作 store 隔离）：
  // 全局 store 是跨画布单例且由 editor 的 use-collaboration init 写入，若 loadRoom 失败
  // （如 403）会残留其他画布的房间 → isOwner 误判 false → 发起者被误显示“协作已失效”。
  const [roomState, setRoomState] = useState<RoomResponse | null>(null);
  const [members, setMembers] = useState<CollaborationMember[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<number>(0);
  const [allowChat, setAllowChat] = useState(true);
  const [allowEdit, setAllowEdit] = useState(true);
  // Phase 8：加入方式（无需审核/需要审核）+ 待审申请列表（房主侧）
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [applications, setApplications] = useState<JoinApplication[]>([]);
  // 批准/拒绝处理中的用户 ID（防连点：并发批准会让 approve 多次成功 → 重复广播 + 重复 toast，2026-08-25）
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);

  // 本地派生状态：发起者视角 expired 视同 idle（可重新开启协作），参与者才标记 expired
  // （与 use-collaboration init 的派生逻辑对齐；全局 store 的 setRoom 对发起者无此特判）
  const status: CollaborationStatus = roomState
    ? roomState.status === 'active'
      ? 'active'
      : roomState.ownerId === String(user?.id)
        ? 'idle'
        : 'expired'
    : 'idle';

  // 角色判定：房间存在时按 ownerId 判断；
  // 房间不存在(未开启)时能打开协作弹窗者必为画布所有者（非所有者需通过邀请码进入，此时房间必然存在）
  const isOwner = roomState ? roomState.ownerId === String(user?.id) : true;

  // SSE member_joined/member_left 实时刷新的是全局 store,弹窗本地 state 需跟随,
  // 否则他人加入/离开时成员列表不更新,必须重开弹窗才刷新;
  // canvasId 守卫:全局 store 跨画布单例,避免残留其他画布的成员数据闪入
  const globalMembers = useCollaborationStore((s) => s.members);
  const globalCanvasId = useCollaborationStore((s) => s.canvasId);
  useEffect(() => {
    if (active && globalCanvasId === canvasId) {
      setMembers(globalMembers);
    }
  }, [globalMembers, globalCanvasId, active, canvasId]);

  // 重置本地表单状态（弹窗关闭后重新打开时触发）
  const resetState = useCallback(() => {
    setInviteCode('');
    setMembers([]);
    setExpiresInHours(0);
    setAllowChat(true);
    setAllowEdit(true);
    setRequiresApproval(false);
    setApplications([]);
  }, []);

  // 拉取待审申请列表（仅房主可见；非房主调用会被后端 403 拦截，静默处理）
  const loadApplications = useCallback(async () => {
    try {
      const list = await listApplications(canvasId);
      setApplications(list);
      // 同步全局待审红点（TopBar 协作按钮）：弹窗打开/SSE 到达/批准/拒绝后都覆盖真实数量，
      // 申请处理完（批准或拒绝）后列表为空 → 红点自动移除
      useCollaborationStore.getState().setPendingApprovals(list.length);
    } catch {
      // 非房主或房间不存在：静默（待审区仅房主可见）
    }
  }, [canvasId]);

  // 加载房间信息（不自动创建；房间不存在 → 显示"未开启"状态）
  const loadRoom = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRoomByCanvas(canvasId);
      // 审核制（2026-08-25）：自己是待审申请者（画布页内被 SSE 转 pending）→ 弹窗无房间信息，按"未开启"处理
      const roomData = data && isPendingJoinResult(data) ? null : data;
      // 弹窗视角本地状态：任何结果（含 null）都立即刷新，避免残留上一画布的房间
      setRoomState(roomData);
      useCollaborationStore.getState().setRoom(roomData); // null → status idle
      if (!roomData) {
        setInviteCode('');
        setMembers([]);
        useCollaborationStore.getState().setMembers([]);
        return;
      }
      setInviteCode(roomData.inviteCode);
      setAllowChat(roomData.allowChat);
      setAllowEdit(roomData.allowEdit);
      setRequiresApproval(roomData.requiresApproval ?? false);
      // 精确档位不可从绝对时间戳反推，仅区分「永不过期/有过期」作展示近似（后端有效期已修通）
      setExpiresInHours(roomData.expiresAt ? 24 : 0);
      if (roomData.status === 'active') {
        try {
          const memberList = await listMembers(canvasId);
          setMembers(memberList);
          useCollaborationStore.getState().setMembers(memberList);
        } catch {
          setMembers([]);
        }
        // 房主侧同步拉取待审申请（非房主静默失败）
        if (roomData.ownerId === String(user?.id)) void loadApplications();
      } else {
        setMembers([]);
      }
    } catch (err) {
      // 本地同样清空：失败（含 403）时按"未开启"展示，不残留任何旧房间状态
      setRoomState(null);
      // Plan#38 Phase 6.4：受邀者尚未入房时后端返回 403，属正常态，静默处理不弹错误；
      // 其余异常才提示（加入流程由 doJoin 独立完成，不受此处影响）
      if (!(err instanceof ApiError && err.status === 403)) {
        console.error('[CollaborationModal] load room failed:', err);
        message.error(t('collab.loadFailed'));
      }
    } finally {
      setLoading(false);
    }
  }, [canvasId, message, t, loadApplications, user?.id]);

  useEffect(() => {
    if (active) {
      // 先重置本地表单，再加载新鲜数据（避免旧状态残留）
      resetState();
      void loadRoom();
    }
  }, [active, resetState, loadRoom]);

  // 开启协作（仅画布所有者）
  const handleStartCollaboration = async () => {
    setLoading(true);
    try {
      const data = await createRoom({ canvasId, mode: 'invite-only' });
      setRoomState(data);
      useCollaborationStore.getState().setRoom(data);
      setInviteCode(data.inviteCode);
      setAllowChat(data.allowChat);
      setAllowEdit(data.allowEdit);
      setExpiresInHours(data.expiresAt ? 24 : 0);
      const memberList = await listMembers(canvasId);
      setMembers(memberList);
      useCollaborationStore.getState().setMembers(memberList);
      // 新房间必然无待审申请：清空残留列表 + 红点归零
      // （关闭协作前的申请已随旧房间作废，不清理则残留假申请，点通过必 404——2026-08-25 审核制漏洞修复）
      setApplications([]);
      useCollaborationStore.getState().setPendingApprovals(0);
      message.success(t('collab.collabStarted'));
    } catch (err) {
      console.error('[CollaborationModal] start collaboration failed:', err);
      message.error(t('collab.startFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 动态构造邀请链接，不依赖后端存储的静态域名；
  // 前端为 hash 路由，链接必须带 #/ 前缀，否则打开后 hash 为空回落主页（验收热修）
  const dynamicInviteLink = inviteCode ? `${window.location.origin}/#/c/${inviteCode}` : '';

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

  // 更新房间设置（两档权限模型：download 随 edit 捆绑、agentChat 随 chat 联动）
  const handleUpdateSettings = async () => {
    if (!isOwner) return;
    try {
      // 两档权限模型（更新时 download 随 edit 捆绑）+ 加入方式（审核制）
      await updateRoom(canvasId, {
        allowChat,
        allowAgentChat: allowChat,
        allowEdit,
        allowDownload: allowEdit,
        requiresApproval,
      });
      message.success(t('collab.settingsUpdated'));
    } catch (err) {
      console.error('[CollaborationModal] update settings failed:', err);
      message.error(t('collab.updateFailed'));
    }
  };

  // 移出成员（移出=移出：默认不封禁；被移出者重进须重新申请(审核制)或走邀请(非审核制)）
  const handleKickMember = (userId: string) => {
    if (!isOwner) return;
    modal.confirm({
      title: t('collab.kickConfirmTitle'),
      content: (
        <div>
          <p style={{ marginBottom: 8, color: theme.toolbar.text }}>
            {t('collab.kickConfirmContent')}
          </p>
        </div>
      ),
      okText: t('collab.kick'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      centered: true,
      onOk: async () => {
        try {
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
          setRoomState(null);
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
          setRoomState(null);
          useCollaborationStore.getState().setRoom(null);
          message.success(t('collab.exitSuccess'));
          onClose();
          // 退出协作后返回主页:EditorPage 卸载 → useCanvasSync releaseDoc 断开 Yjs WS + SSE,
          // 发起端不再看到本端光标/操作;若不跳转,退出者仍留在画布持续同步
          window.location.hash = '#/';
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
      setRoomState(null);
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

  // 批准待审申请（房主）：批准后同步刷新成员列表
  const handleApproveApplication = async (applicantUserId: string) => {
    if (processingUserId) return; // 防连点
    setProcessingUserId(applicantUserId);
    try {
      await approveApplication(canvasId, applicantUserId);
      await loadApplications();
      const updated = await listMembers(canvasId);
      setMembers(updated);
      useCollaborationStore.getState().setMembers(updated);
      message.success(t('collab.approveSuccess'));
    } catch (err) {
      console.error('[CollaborationModal] approve application failed:', err);
      // 失败多为申请已失效(房间重开/已处理)：刷新列表清掉残留的假申请（2026-08-25 审核制漏洞修复）
      void loadApplications();
      message.error(t('collab.operationFailed'));
    } finally {
      setProcessingUserId(null);
    }
  };

  // 拒绝待审申请（房主）
  const handleRejectApplication = async (applicantUserId: string) => {
    if (processingUserId) return; // 防连点
    setProcessingUserId(applicantUserId);
    try {
      await rejectApplication(canvasId, applicantUserId);
      await loadApplications();
      message.success(t('collab.rejectSuccess'));
    } catch (err) {
      console.error('[CollaborationModal] reject application failed:', err);
      // 同批准：申请已失效则刷新列表自愈
      void loadApplications();
      message.error(t('collab.operationFailed'));
    } finally {
      setProcessingUserId(null);
    }
  };

  // SSE 新申请到达（房主端）：刷新待审列表 + 轻提示（仅弹窗打开时）
  useEffect(() => {
    if (!active || !isOwner) return;
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ canvasId?: string } | undefined>).detail;
      if (!detail || detail.canvasId !== canvasId) return;
      void loadApplications();
      message.info(t('collab.joinApplicationReceived'));
    };
    window.addEventListener('zeroexo:collab-join-application', handler);
    return () => window.removeEventListener('zeroexo:collab-join-application', handler);
  }, [active, isOwner, canvasId, loadApplications, message, t]);

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

        {/* Phase 9：邀请码降级为链接内部标识，UI 仅展示邀请链接 */}
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

      {/* 权限设置卡片（Plan#38 Phase 7.3：收敛为「只读/允许编辑」两档 + 聊天开关；
          允许编辑 = 编辑 + 下载捆绑（用户拍板），下载不再独立设置） */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>{t('collab.permissions')}</div>

        <div style={rowStyle}>
          <span style={labelStyle}>{t('collab.participantPermission')}</span>
          <Select
            size="small"
            style={{ width: 160 }}
            value={allowEdit ? 'edit' : 'view'}
            onChange={(v) => {
              // 两档权限：允许编辑时后端同步授予 download（编辑捆绑下载）
              setAllowEdit(v === 'edit');
            }}
            options={[
              { label: t('collab.permissionReadOnly'), value: 'view' },
              { label: t('collab.permissionEditable'), value: 'edit' },
            ]}
          />
        </div>
        <div style={{ color: theme.toolbar.textMuted, fontSize: 12, marginBottom: 12 }}>
          {allowEdit ? t('collab.permissionEditableHint') : t('collab.permissionReadOnlyHint')}
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>{t('collab.allowChat')}</span>
          <Switch
            size="small"
            checked={allowChat}
            onChange={(checked) => setAllowChat(checked)}
          />
        </div>

        {/* Phase 8：加入方式（需要审核/无需审核，用户拍板） */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>{t('collab.joinMethod')}</div>
          <Radio.Group
            value={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.value as boolean)}
          >
            <Radio value={false}>
              <span style={{ color: theme.toolbar.text, fontSize: 13 }}>{t('collab.joinMethodDirect')}</span>
            </Radio>
            <Radio value>
              <span style={{ color: theme.toolbar.text, fontSize: 13 }}>{t('collab.joinMethodReview')}</span>
            </Radio>
          </Radio.Group>
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

      {/* 待审加入申请（房主侧，Phase 8；仅有申请时显示） */}
      {applications.length > 0 && (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>
            {t('collab.pendingApplications')}{' '}
            {/* 红色数量：与 TopBar 红点呼应，一眼看到待处理数 */}
            <span style={{ color: '#f5222d' }}>({applications.length})</span>
          </div>
          {applications.map((app) => (
            <div key={app.userId} style={memberItemStyle(false)}>
              <div style={memberInfoStyle}>
                <span style={memberNameStyle}>{app.nickname || t('collab.unnamed')}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  size="small"
                  type="primary"
                  loading={processingUserId === app.userId}
                  disabled={!!processingUserId}
                  onClick={() => void handleApproveApplication(app.userId)}
                >
                  {t('collab.approveJoin')}
                </Button>
                <Button
                  size="small"
                  danger
                  loading={processingUserId === app.userId}
                  disabled={!!processingUserId}
                  onClick={() => void handleRejectApplication(app.userId)}
                >
                  {t('collab.rejectJoin')}
                </Button>
              </div>
            </div>
          ))}
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
              // 状态标签优先级: 禁言 > 在线/离线(被封禁成员已被列表过滤,移出就是移出)
              const muted = member.sessions.some((s) => s.status === 'muted');
              const isOnline = member.sessions.some((s) => s.status === 'online');
              return (
                <div key={member.userId} style={memberItemStyle(isSelf)}>
                  <div style={memberInfoStyle}>
                    <span style={memberNameStyle}>
                      {member.nickname || t('collab.unnamed')}
                      {isSelf && ` (${t('collab.self')})`}
                    </span>
                    <span style={memberRoleStyle}>
                      {t(`collab.role.${member.role}`)}
                      {muted
                        ? ` · ${t('collab.memberMuted')}`
                        : ` · ${t(`collab.status.${isOnline ? 'online' : 'offline'}`)}`}
                    </span>
                  </div>
                  {isOwner && !isSelf && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        onClick={() => handleMuteMember(member.userId, muted)}
                      >
                        {muted ? t('collab.unmute') : t('collab.mute')}
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

  // 参与者视角（房间存在且非房主）：失效 → 失效视图；协作中 → 仅退出入口
  // （Phase 9：加入入口全部收敛到邀请落地页，面板不再提供输码加入）
  // 2026-08-29：移除面板内部 Tabs——原「发起协作/加入协作」双 Tab 收敛后仅剩单标签，
  // 且画布内本面板已嵌入版本历史抽屉的「协作」Tab，再包一层 Tabs 会形成两层 Tab 条
  const isGuestExpired = status === 'expired' && !isOwner;

  return (
    <>
      {isGuestExpired
        ? renderExpiredView()
        : isOwner
          ? status === 'active'
            ? renderManagePanel()
            : renderStartPanel()
          : renderExitCard()}
    </>
  );
}

/**
 * CollaborationModal - 协作管理弹窗（统一组件，Modal 外壳）
 *
 * 画布外（主页「发起协作 / 协作详情」）使用；画布内已并入版本历史抽屉的
 * 「协作」Tab（CollaborationPanel），不再单独弹出 Modal。
 */
export function CollaborationModal({
  open,
  canvasId,
  onClose,
  theme,
}: CollaborationModalProps): React.ReactElement {
  const { t } = useTranslation();
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
      <CollaborationPanel canvasId={canvasId} onClose={onClose} theme={theme} />
    </Modal>
  );
}
