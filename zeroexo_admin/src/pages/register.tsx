import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ProForm, ProFormText } from '@ant-design/pro-components';
import { UserOutlined, MailOutlined, LockOutlined } from '@ant-design/icons';
import { Button, Dropdown, message } from 'antd';
import { Languages } from 'lucide-react';
import { apiPost, showApiError } from '@/services/api-client';
import type { ProFormInstance } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';

export default function Register() {
  const navigate = useNavigate();
  const formRef = useRef<ProFormInstance>();
  const [countdown, setCountdown] = useState(0);
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('i18n-lang', lang);
  };

  const currentLang = localStorage.getItem('i18n-lang') || 'zh-CN';

  const handleSendCode = async (email: string) => {
    if (!email) {
      message.warning(t('auth.validation.enterEmailFirst'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      message.warning(t('auth.validation.validEmail'));
      return;
    }
    try {
      await apiPost('/auth/send-register-code', { email });
      message.success(t('auth.message.codeSent'));
      setCountdown(60);
    } catch (err: any) {
      message.error(err.response?.data?.message || t('auth.message.sendFailed'));
    }
  };

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      await apiPost('/auth/register', {
        email: values.email,
        username: values.username,
        password: values.password,
        code: values.code,
      });
      message.success(t('auth.message.registerSuccess'));
      navigate('/login');
    } catch (err) {
      showApiError(err, t('auth.message.registerFailed'));
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#fff',
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: 16, left: 16 }}>
        <Dropdown
          menu={{
            items: [
              {
                key: 'zh-CN',
                label: t('settings.chinese'),
                disabled: currentLang === 'zh-CN',
                onClick: () => handleLanguageChange('zh-CN'),
              },
              {
                key: 'en-US',
                label: t('settings.english'),
                disabled: currentLang === 'en-US',
                onClick: () => handleLanguageChange('en-US'),
              },
            ],
          }}
          placement="bottomLeft"
          autoAdjustOverflow
        >
          <Button size="small" type="text" icon={<Languages size={18} />} />
        </Dropdown>
      </div>

      <div style={{ width: 400, maxWidth: '90vw' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img src="/admin/ZeroExoLogo.svg" alt="ZeroExo" style={{ width: 56, height: 56 }} />
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 200, margin: 0, color: 'var(--color-text-primary, #1a1a2e)', letterSpacing: '-0.02em' }}>ZeroExo</h1>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #595959)', margin: '4px 0 0' }}>{t('app.admin')}</p>
            </div>
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #595959)', margin: '24px 0 0' }}>{t('auth.registerTitle')}</p>
        </div>

        <ProForm
          formRef={formRef}
          onFinish={handleSubmit}
          submitter={{
            render: () => (
              <Button type="primary" htmlType="submit" block size="large" style={{ height: 44, borderRadius: 'var(--radius-lg, 8px)' }}>
                {t('auth.register')}
              </Button>
            ),
          }}
        >
          <ProFormText
            name="email"
            fieldProps={{
              size: 'large',
              prefix: <MailOutlined />,
              placeholder: t('auth.emailPlaceholder'),
            }}
            rules={[
              { required: true, message: t('auth.validation.email') },
              { type: 'email', message: t('auth.validation.validEmail') },
            ]}
          />

          <ProFormText
            name="username"
            fieldProps={{
              size: 'large',
              prefix: <UserOutlined />,
              placeholder: t('auth.usernamePlaceholder'),
            }}
            rules={[
              { required: true, message: t('auth.validation.username') },
              { min: 3, message: t('auth.validation.usernameMin') },
              { max: 32, message: t('auth.validation.usernameMax') },
              { pattern: /^[a-zA-Z0-9_-]+$/, message: t('auth.validation.usernamePattern') },
            ]}
          />

          <ProFormText.Password
            name="password"
            fieldProps={{
              size: 'large',
              prefix: <LockOutlined />,
              placeholder: t('auth.passwordPlaceholder'),
            }}
            rules={[
              { required: true, message: t('auth.validation.password') },
              { min: 6, message: t('auth.validation.passwordMin') },
            ]}
          />

          <ProFormText.Password
            name="confirm"
            fieldProps={{
              size: 'large',
              prefix: <LockOutlined />,
              placeholder: t('auth.confirmPasswordPlaceholder'),
            }}
            rules={[
              { required: true, message: t('auth.validation.confirmPassword') },
              ({ getFieldValue }) => ({
                validator(_: any, value: string) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error(t('auth.validation.passwordNotMatch')));
                },
              }),
            ]}
          />

          <ProFormText
            name="code"
            fieldProps={{
              size: 'large',
              placeholder: t('auth.codePlaceholder'),
              suffix: (
                <Button
                  type="link"
                  size="small"
                  disabled={countdown > 0}
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => {
                    const email = formRef.current?.getFieldValue('email') as string;
                    handleSendCode(email);
                  }}
                >
                  {countdown > 0 ? `${countdown}s` : t('auth.getCode')}
                </Button>
              ),
            }}
            rules={[{ required: true, message: t('auth.validation.code') }]}
          />
        </ProForm>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14 }}>
          <Link to="/login">{t('auth.hasAccount')}</Link>
        </div>
      </div>
    </div>
  );
}