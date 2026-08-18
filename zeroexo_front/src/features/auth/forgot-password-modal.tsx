/**
 * ForgotPasswordModal - 忘记密码弹窗(三步流程:提交邮箱 → 验证码 → 重置密码)
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Steps, Typography, Space, Button, Input, App } from 'antd';
import { translateApiError } from '@/shared/utils/api-error.js';
import i18n from '@/i18n/config';

const { Text } = Typography;

export interface ForgotPasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ForgotPasswordModal({ open, onClose }: ForgotPasswordModalProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [smtpConfig, setSmtpConfig] = useState<{ domains: string[]; smtpConfigured: boolean } | null>(null);
  const [emailError, setEmailError] = useState('');

  // 挂载时获取支持的邮箱域名列表
  useEffect(() => {
    fetch('/api/auth/email-domains')
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        }
        const text = await r.text();
        if (!text) {
          throw new Error('响应为空');
        }
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error(`JSON 解析失败: ${text.substring(0, 100)}`);
        }
      })
      .then((data) => {
        setSmtpConfig({ domains: data?.domains ?? [], smtpConfigured: data?.smtpConfigured ?? false });
      })
      .catch((err) => {
        console.error('获取邮箱配置失败:', err);
        setSmtpConfig({ domains: [], smtpConfigured: false });
      });
  }, []);

  const validateEmail = (value: string): string => {
    if (!value) return '请输入邮箱';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return '请输入有效的邮箱地址';
    if (smtpConfig && smtpConfig.domains.length > 0) {
      const domain = value.split('@')[1]?.toLowerCase();
      if (domain && !smtpConfig.domains.includes(domain)) {
        return `仅支持 ${smtpConfig.domains.join(', ')} 邮箱`;
      }
    }
    return '';
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    setEmailError(validateEmail(val));
  };

  const handleSendCode = async () => {
    const err = validateEmail(email);
    if (err) {
      message.error(translateApiError(err));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.message || '发送失败');
      }
      setStep(1);
    } catch (err) {
      message.error(err instanceof Error ? translateApiError(err) : i18n.t('errors.BAD_REQUEST'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyCode = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/verify-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.message || '验证失败');
      }
      const data = await res.json();
      setToken(data.data?.token ?? data.token);
      setStep(2);
    } catch (err) {
      message.error(err instanceof Error ? translateApiError(err) : i18n.t('errors.BAD_REQUEST'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword) {
      message.error(t('auth.passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.message || '重置失败');
      }
      message.success(t('auth.resetPasswordSuccess'));
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? translateApiError(err) : i18n.t('errors.BAD_REQUEST'));
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { title: t('auth.forgotPasswordBtn') },
    { title: t('auth.forgotPasswordVerifyBtn') },
    { title: t('auth.forgotPasswordResetBtn') },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('auth.forgotPasswordTitle')}
      footer={null}
      width={420}
      centered
      destroyOnHidden
    >
      <Steps current={step} size="small" items={steps} style={{ marginBottom: 24, marginTop: 4 }} />

      {step === 0 && (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>{t('auth.forgotPasswordDesc')}</Text>
          <Input
            type="email"
            value={email}
            onChange={handleEmailChange}
            placeholder={t('auth.emailPlaceholder') || '请输入邮箱地址（如 xxx@qq.com）'}
            status={emailError ? 'error' : undefined}
          />
          {emailError && <Text type="danger" style={{ fontSize: 12, marginTop: -8 }}>{emailError}</Text>}
          <Button type="primary" block loading={submitting} onClick={handleSendCode}>
            {t('auth.forgotPasswordBtn')}
          </Button>
        </Space>
      )}

      {step === 1 && (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>{t('auth.forgotPasswordCodeDesc')}</Text>
          <Input.OTP
            length={6}
            value={code}
            onChange={(val) => setCode(val)}
            style={{ width: '100%' }}
          />
          <Button type="primary" block loading={submitting} disabled={code.length !== 6} onClick={handleVerifyCode}>
            {t('auth.forgotPasswordVerifyBtn')}
          </Button>
        </Space>
      )}

      {step === 2 && (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>{t('auth.forgotPasswordResetDesc')}</Text>
          <Input.Password
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('auth.forgotPasswordNewPwPlaceholder')}
          />
          <Input.Password
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('auth.forgotPasswordConfirmPwPlaceholder')}
          />
          <Button type="primary" block loading={submitting} disabled={!newPassword || !confirmPassword} onClick={handleResetPassword}>
            {t('auth.forgotPasswordResetBtn')}
          </Button>
        </Space>
      )}
    </Modal>
  );
}