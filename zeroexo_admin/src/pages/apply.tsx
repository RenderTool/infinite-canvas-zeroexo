import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Modal, Input, message, Steps, Tag } from 'antd';
import {
  UserSwitchOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { apiGet, apiPost, showApiError } from '@/services/api-client';
import { useAuth } from '@/contexts/auth';
import { useTranslation } from 'react-i18next';
import { color as themeColor } from '@/design-tokens';

export default function ApplyPage() {
  const { user, logout, refreshUser } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [appStatus, setAppStatus] = useState<string | null>(null);
  const [appType, setAppType] = useState<string>('');
  const [appCreatedAt, setAppCreatedAt] = useState<string>('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyReason, setApplyReason] = useState('');
  const [applying, setApplying] = useState(false);
  const approvedRef = useRef(false);

  const fetchAppStatus = useCallback(async () => {
    // 已处理过 approved 状态，跳过后续请求避免循环
    if (approvedRef.current) return;
    setStatusLoading(true);
    try {
      const data = await apiGet<{ application: { id: string; type: string; status: string; createdAt: string } | null }>('/auth/apply/status');
      if (data.application) {
        setAppStatus(data.application.status);
        setAppType(data.application.type);
        setAppCreatedAt(data.application.createdAt);

        // 申请已批准，刷新用户信息并跳转到首页
        if (data.application.status === 'approved') {
          approvedRef.current = true;
          try {
            // 通过 AuthContext 更新内存中的用户信息(角色)，避免跳转后仍按旧角色判定被弹回
            const freshUser = await refreshUser();
            if (!freshUser) throw new Error('refresh user failed');
            // 直接跳转到首页，无需刷新页面
            navigate('/', { replace: true });
          } catch {
            // 刷新用户信息失败 => token 已过期，清除并重定向到登录页
            // 注：accessToken/user 已不再存于 localStorage，此处仅清理遗留凭据与 refreshToken
            sessionStorage.removeItem('admin-refresh-token');
            localStorage.removeItem('admin-token');
            localStorage.removeItem('admin-user');
            navigate('/login', { replace: true });
          }
          return;
        }
      } else {
        setAppStatus(null);
        setAppType('');
        setAppCreatedAt('');
      }
    } catch {
      //
    } finally {
      if (!approvedRef.current) {
        setStatusLoading(false);
      }
    }
  }, [navigate, refreshUser]);

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'super_admin' && user.role !== 'operator') {
      if (!approvedRef.current) {
        fetchAppStatus();
      }
    }
  }, [user, fetchAppStatus]);

  const safeDate = (val: string | undefined | null, fallback = '') => {
    if (!val) return fallback;
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return fallback;
      return d.toLocaleString();
    } catch {
      return fallback;
    }
  };

  const handleApplyAdmin = async () => {
    setApplying(true);
    try {
      await apiPost('/auth/apply', {
        type: 'admin',
        reason: applyReason || undefined,
      });
      message.success(t('success.save'));
      setApplyOpen(false);
      setApplyReason('');
      fetchAppStatus();
    } catch (err) {
      showApiError(err, t('error.save'));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--color-bg-page, #f5f5f5)', position: 'relative' }}>
      {/* 退出登录按钮 */}
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={() => {
            logout();
            navigate('/login');
          }}
        >
          {t('auth.logout')}
        </Button>
      </div>
      <Card style={{ width: 520, borderRadius: 'var(--radius-lg, 8px)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <UserSwitchOutlined style={{ fontSize: 48, color: themeColor.warning, marginBottom: 16 }} />
          <h3 style={{ color: '#d46b08', marginBottom: 8 }}>{t('dashboard.user.normal')}</h3>
          <p style={{ color: 'var(--color-text-tertiary, #bfbfbf)', marginBottom: 24 }}>{t('dashboard.user.applyHint')}</p>

          {statusLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
              <LoadingOutlined style={{ fontSize: 20, color: themeColor.primary }} />
              <span style={{ color: 'var(--color-text-tertiary, #bfbfbf)' }}>{t('dashboard.user.loadingStatus')}</span>
            </div>
          ) : appStatus === 'pending' ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginBottom: 12 }}>
                <LoadingOutlined style={{ fontSize: 20, color: themeColor.warning }} />
                <span style={{ fontWeight: 500, color: '#d46b08' }}>{t('dashboard.user.applying')}</span>
                <Tag color="orange">{t('dashboard.user.pending')}</Tag>
              </div>
              <Steps
                size="small"
                current={0}
                style={{ maxWidth: 400, margin: '0 auto' }}
                items={[
                  { title: t('dashboard.user.submitted'), description: safeDate(appCreatedAt) },
                  { title: t('dashboard.user.adminReview'), description: t('dashboard.user.waitReview') },
                  { title: appType === 'admin' ? t('dashboard.user.becomeAdmin') : t('dashboard.user.becomeOperator') },
                ]}
              />
            </div>
          ) : appStatus === 'approved' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
              <CheckCircleOutlined style={{ fontSize: 20, color: themeColor.success }} />
              <span style={{ fontWeight: 500, color: '#389e0d' }}>
                {t('dashboard.user.approved')}{appType === 'admin' ? t('dashboard.user.becomeAdmin') : t('dashboard.user.becomeOperator')}
              </span>
              <Tag color="green">{t('dashboard.user.approvedTag')}</Tag>
            </div>
          ) : appStatus === 'rejected' ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginBottom: 12 }}>
                <CloseCircleOutlined style={{ fontSize: 20, color: themeColor.error }} />
                <span style={{ flex: 1, color: '#cf1322' }}>
                  {t('dashboard.user.rejected')}
                  {appCreatedAt ? <span style={{ color: 'var(--color-text-tertiary, #bfbfbf)', marginLeft: 8, fontSize: 12 }}>（{safeDate(appCreatedAt)}）</span> : null}
                </span>
                <Tag color="red">{t('dashboard.user.rejectedTag')}</Tag>
              </div>
              <Button type="primary" ghost onClick={() => { setAppStatus(null); setApplyOpen(true); }}>
                {t('dashboard.user.reapply')}
              </Button>
            </div>
          ) : (
            <div>
              <Button
                type="primary"
                size="large"
                icon={<UserSwitchOutlined />}
                style={{ borderColor: themeColor.warning, color: themeColor.warning, background: '#fff' }}
                onClick={() => setApplyOpen(true)}
              >
                {t('dashboard.user.applyAdmin')}
              </Button>
            </div>
          )}
        </div>

        <Modal
          title={t('dashboard.user.applyAdmin')}
          open={applyOpen}
          onCancel={() => { setApplyOpen(false); setApplyReason(''); }}
          onOk={handleApplyAdmin}
          confirmLoading={applying}
          okText={t('auth.submitApply')}
        >
          <p style={{ marginBottom: 12, color: '#666' }}>{t('dashboard.user.applyDesc')}</p>
          <Input.TextArea
            rows={4}
            value={applyReason}
            onChange={(e) => setApplyReason(e.target.value)}
            placeholder={t('dashboard.user.applyReason')}
          />
        </Modal>
      </Card>
    </div>
  );
}