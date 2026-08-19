import { useNavigate, Link } from 'react-router-dom';
import { ProForm, ProFormText } from '@ant-design/pro-components';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import { Languages } from 'lucide-react';
import { useAuth } from '@/contexts/auth';
import { showApiError } from '@/services/api-client';
import { useTranslation } from 'react-i18next';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('i18n-lang', lang);
  };

  const currentLang = localStorage.getItem('i18n-lang') || 'zh-CN';

  const handleSubmit = async (values: { email: string; password: string }) => {
    try {
      await login(values.email, values.password);
      navigate('/dashboard');
    } catch (err) {
      // 统一错误脱敏：5xx 不透传后端原始 message（防泄露堆栈/路径），业务文案正常展示
      showApiError(err, t('auth.message.loginFailed'));
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
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #595959)', margin: '24px 0 0' }}>{t('auth.loginTitle')}</p>
        </div>

        <ProForm
          onFinish={handleSubmit}
          submitter={{
            render: () => (
              <Button type="primary" htmlType="submit" block size="large" style={{ height: 44, borderRadius: 'var(--radius-lg, 8px)' }}>
                {t('auth.login')}
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
          <ProFormText.Password
            name="password"
            fieldProps={{
              size: 'large',
              prefix: <LockOutlined />,
              placeholder: t('auth.passwordPlaceholder'),
            }}
            rules={[{ required: true, message: t('auth.validation.password') }]}
          />
        </ProForm>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 14 }}>
          <Link to="/register">{t('auth.noAccount')}</Link>
        </div>
      </div>
    </div>
  );
}