/**
 * InvitePage - 协作邀请落地页（Plan#38 Phase 9，征集 #59）
 *
 * 设计目标（对齐腾讯云文档 / WPS 的邀请体验）：
 * - 一条链接 /c/<code> 即完成邀请，废除手动输入邀请码的显式加入入口；
 * - 未登录也可浏览本页（点击加入 → 跳登录/注册 → 回流自动加入）；
 * - 房间被发起者关闭 / 过期 → 显示「链接已失效」页 + 返回主页；
 * - 审核制房间 → 加入后页内展示「已提交申请，等待发起者审核」态。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { App, Button } from 'antd';
import { Link2Off, Loader2, RefreshCw, Users, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { verifyInvite, joinRoom, getRoomByCanvas } from './collaboration-api';
import { ApiError } from '@/services/api-client';
import { isPendingJoinResult } from './collaboration-types';

type VerifyInfo = Awaited<ReturnType<typeof verifyInvite>>;

export interface InvitePageProps {
  /** 链接中的邀请码（链接内部标识，不在 UI 展示） */
  inviteCode: string;
  /** 登录/注册回流后自动触发加入 */
  autoJoin: boolean;
  isAuthenticated: boolean;
  /** 加入成功 → 进入画布编辑器 */
  onJoined: (canvasId: string) => void;
  onGoHome: () => void;
  /** 未登录点击加入 → 跳登录页（由 App 暂存邀请码，登录成功后回流自动加入） */
  onGoLogin: () => void;
}

export function InvitePage({
  inviteCode,
  autoJoin,
  isAuthenticated,
  onJoined,
  onGoHome,
  onGoLogin,
}: InvitePageProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message } = App.useApp();

  const [info, setInfo] = useState<VerifyInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [joining, setJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingApplied, setPendingApplied] = useState(false);
  // 加入失败原因（页内持久展示，不能只靠一闪而过的 toast——用户需要知道下一步怎么办）
  const [joinFailedReason, setJoinFailedReason] = useState('');
  const [avatarBroken, setAvatarBroken] = useState(false);
  // 防止 autoJoin effect 与手动点击重复加入
  const joinedRef = useRef(false);

  // 验证邀请链接（公开端点，未登录可访问）
  useEffect(() => {
    let cancelled = false;
    setInvalid(false);
    setInfo(null);
    void verifyInvite(inviteCode)
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  const doJoin = useCallback(async () => {
    if (!info || joinedRef.current) return;
    if (!isAuthenticated) {
      onGoLogin();
      return;
    }
    setJoining(true);
    try {
      const result = await joinRoom(info.canvasId, inviteCode);
      // 审核制房间：不进入画布，页内展示等待审核态
      // （不置 joinedRef——待审态轮询依赖它探测批准；若提前置 true 轮询永不启动，2026-08-25 修复）
      if (isPendingJoinResult(result)) {
        setPendingApplied(true);
        return;
      }
      joinedRef.current = true;
      onJoined(info.canvasId);
    } catch (err) {
      console.error('[InvitePage] join failed:', err);
      // 按错误码区分原因：被封禁/房间已满要有明确提示，不能一律"邀请码无效"误导用户
      let reason = t('collab.inviteCodeInvalid');
      if (err instanceof ApiError && err.code === 'COLLAB_MEMBER_BANNED') {
        reason = t('collab.joinBanned');
      } else if (err instanceof ApiError && err.code === 'COLLAB_ROOM_FULL') {
        reason = t('collab.joinRoomFull');
      }
      setJoinFailedReason(reason);
      message.error(reason);
    } finally {
      setJoining(false);
    }
  }, [info, inviteCode, isAuthenticated, message, onGoLogin, onJoined, t]);

  // 待审态自动检测（2026-08-25 体验闭环）：房主批准后自动进入画布，无需手动点刷新
  // 用 getRoomByCanvas 而非 joinRoom 探测：被拒绝时记录已删，joinRoom 会重建新申请造成"拒后自动重申"；
  // getRoomByCanvas 返回 403 则停止轮询（手动刷新可看到明确原因）
  useEffect(() => {
    if (!pendingApplied || !info || joinedRef.current) return;
    let failCount = 0;
    const timer = window.setInterval(async () => {
      try {
        const room = await getRoomByCanvas(info.canvasId);
        if (!room || isPendingJoinResult(room)) return; // 仍待审，继续等
        joinedRef.current = true;
        window.clearInterval(timer);
        onJoined(info.canvasId);
      } catch {
        failCount += 1;
        // 连续失败（被拒绝/房间关闭/链接失效）→ 停止轮询，交还手动刷新展示原因
        if (failCount >= 3) window.clearInterval(timer);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pendingApplied, info, onJoined]);

  // 待审页刷新检查：发起者审核通过后点左上角刷新——已批准则直接入画布；仍待审则提示
  const handleRefresh = useCallback(async () => {
    if (!info || refreshing) return;
    setRefreshing(true);
    try {
      const result = await joinRoom(info.canvasId, inviteCode);
      if (isPendingJoinResult(result)) {
        message.info(t('collab.invite.stillPending'));
        return;
      }
      joinedRef.current = true;
      onJoined(info.canvasId);
    } catch (err) {
      console.error('[InvitePage] refresh join failed:', err);
      let reason = t('collab.inviteCodeInvalid');
      if (err instanceof ApiError && err.code === 'COLLAB_MEMBER_BANNED') {
        reason = t('collab.joinBanned');
      } else if (err instanceof ApiError && err.code === 'COLLAB_ROOM_FULL') {
        reason = t('collab.joinRoomFull');
      }
      setJoinFailedReason(reason);
      message.error(reason);
    } finally {
      setRefreshing(false);
    }
  }, [info, inviteCode, onJoined, message, t, refreshing]);

  // 登录/注册回流后自动加入
  useEffect(() => {
    if (autoJoin && info && isAuthenticated) void doJoin();
  }, [autoJoin, info, isAuthenticated, doJoin]);

  const pageStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: theme.canvas.background,
    padding: 24,
  };

  const cardStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    maxWidth: 380,
    padding: '40px 32px',
    borderRadius: 16,
    background: theme.toolbar.panel,
    border: `1px solid ${theme.toolbar.border}`,
    boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    textAlign: 'center',
  };

  // 加载中
  if (!info && !invalid) {
    return (
      <div style={pageStyle}>
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: theme.toolbar.textMuted }} />
      </div>
    );
  }

  // 链接已失效（发起者关闭 / 过期 / 不存在）
  if (invalid || !info) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          }}>
            <Link2Off size={28} style={{ color: theme.toolbar.textMuted }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: theme.toolbar.text, marginTop: 8 }}>
            {t('collab.invite.invalidTitle')}
          </div>
          <div style={{ fontSize: 13, color: theme.toolbar.textMuted, lineHeight: 1.7 }}>
            {t('collab.invite.invalidHint')}
          </div>
          <Button type="primary" style={{ marginTop: 16, minWidth: 160 }} onClick={onGoHome}>
            {t('collab.backToHome')}
          </Button>
        </div>
      </div>
    );
  }

  // 加入失败：页内持久引导（原实现只剩 toast，用户停留在无效页不知下一步）
  if (joinFailedReason) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          }}>
            <XCircle size={28} style={{ color: theme.toolbar.textMuted }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: theme.toolbar.text, marginTop: 8 }}>
            {t('collab.joinFailedTitle')}
          </div>
          <div style={{ fontSize: 13, color: theme.toolbar.textMuted, lineHeight: 1.7 }}>
            {joinFailedReason}
          </div>
          <div style={{ fontSize: 12, color: theme.toolbar.textMuted, lineHeight: 1.6, marginTop: 4 }}>
            {t('collab.joinFailedHint')}
          </div>
          <Button type="primary" style={{ marginTop: 16, minWidth: 160 }} onClick={onGoHome}>
            {t('collab.backToHome')}
          </Button>
        </div>
      </div>
    );
  }

  // 已提交申请等待审核（审核制房间）
  if (pendingApplied) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          {/* 卡片右上角刷新：审核通过后一键检查并进入画布（无需重新打开链接） */}
          <Button
            type="text"
            loading={refreshing}
            icon={<RefreshCw size={16} />}
            onClick={() => void handleRefresh()}
            style={{
              position: 'absolute', top: 12, right: 12,
              color: theme.toolbar.textMuted,
            }}
          >
            {t('collab.invite.refreshStatus')}
          </Button>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          }}>
            <Users size={28} style={{ color: theme.toolbar.textMuted }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: theme.toolbar.text, marginTop: 8 }}>
            {t('collab.invite.pendingTitle')}
          </div>
          <div style={{ fontSize: 13, color: theme.toolbar.textMuted, lineHeight: 1.7 }}>
            {t('collab.invite.pendingHint')}
          </div>
          <Button style={{ marginTop: 16, minWidth: 160 }} onClick={onGoHome}>
            {t('collab.backToHome')}
          </Button>
        </div>
      </div>
    );
  }

  // 有效邀请：邀请者信息 + 加入按钮
  const avatarSize = 72;
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {/* 邀请者头像（加载失败回落首字母） */}
        {info.ownerAvatarUrl && !avatarBroken ? (
          <img
            src={info.ownerAvatarUrl}
            alt={info.ownerName}
            onError={() => setAvatarBroken(true)}
            style={{
              width: avatarSize, height: avatarSize, borderRadius: '50%',
              objectFit: 'cover', border: `2px solid ${theme.toolbar.border}`,
            }}
          />
        ) : (
          <div style={{
            width: avatarSize, height: avatarSize, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            color: theme.toolbar.text, fontSize: 28, fontWeight: 600,
            border: `2px solid ${theme.toolbar.border}`,
          }}>
            {info.ownerName.slice(0, 1)}
          </div>
        )}

        <div style={{ fontSize: 16, fontWeight: 600, color: theme.toolbar.text, marginTop: 8 }}>
          {t('collab.invite.invitesYou', { name: info.ownerName })}
        </div>

        {/* 画布标题 */}
        <div style={{
          padding: '6px 14px', borderRadius: 8,
          background: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          border: `1px solid ${theme.toolbar.border}`,
          color: theme.toolbar.text, fontSize: 13, maxWidth: '100%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {info.canvasTitle || t('collab.invite.canvasFallback')}
        </div>

        {!isAuthenticated && (
          <div style={{ fontSize: 12, color: theme.toolbar.textMuted, lineHeight: 1.6 }}>
            {t('collab.invite.loginHint')}
          </div>
        )}

        <Button
          type="primary"
          size="large"
          loading={joining}
          style={{ marginTop: 12, minWidth: 200 }}
          onClick={() => void doJoin()}
        >
          {joining
            ? t('collab.invite.joining')
            : isAuthenticated
              ? t('collab.invite.join')
              : t('collab.invite.joinWithLogin')}
        </Button>
      </div>
    </div>
  );
}
