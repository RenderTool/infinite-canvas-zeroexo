/**
 * AuthPage - 登录/注册页面(antd 重构)
 *
 * 左侧:表单区(antd Form)
 * 右侧:品牌展示区(深色渐变,装饰元素)
 * 移动端:仅显示左侧表单区
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, X } from 'lucide-react';
import { Form, Input, Button, Typography, App, ConfigProvider, Tooltip, theme as antdTheme } from 'antd';
import { LanguageSwitcher } from '@/shared/components/language-switcher.js';
import { DARK_THEME } from '@zeroexo/plugin-theme';
import { useAuth } from './auth-store.js';
import { ApiError } from '@/services/api-client.js';
import { translateApiError } from '@/shared/utils/api-error.js';
import i18n from '@/i18n/config';
import { LogoIcon } from '@/assets/ico/index.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { ForgotPasswordModal } from './forgot-password-modal.js';
import { HeroVideoPlayer } from './hero-video-player.js';
import { pageStyle, leftPanelStyle, centeredWrapperStyle, formContainerStyle, switchStyle, AUTH_PAGE_CSS, AUTH_HIDE_SCROLLBAR_CSS } from './auth-styles.js';

const { Text } = Typography;

export type AuthMode = 'login' | 'register';

export interface AuthPageProps {
  mode: AuthMode;
  onSuccess: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  /** 关闭登录页回到主页（未登录用户可关闭） */
  onClose?: () => void;
}



export function AuthPage({ mode, onSuccess, onSwitchMode, onClose }: AuthPageProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const isMobile = useIsMobile();

  const darkTheme = DARK_THEME;
  const { login, register } = useAuth();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const setCodeSent = useState(false)[1];
  const [codeSending, setCodeSending] = useState(false);
  const [codeTimer, setCodeTimer] = useState(0);
  const [smtpConfig, setSmtpConfig] = useState<{ domains: string[]; smtpConfigured: boolean } | null>(null);

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

  const isLogin = mode === 'login';

  const handleSendCode = async () => {
    const email = form.getFieldValue('email');
    if (!email) {
      message.error(i18n.t('errors.AUTH_EMAIL_REQUIRED'));
      return;
    }
    setCodeSending(true);
    try {
      const res = await fetch('/api/auth/send-register-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      // 先读取响应文本，避免 JSON 解析错误
      const text = await res.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        console.error('响应解析失败:', text);
        throw new Error(t('auth.serverResponseMalformed'));
      }
      
      if (!res.ok) {
        throw new Error(json.message || t('auth.sendFailedWithStatus', { status: res.status }));
      }
      
      setCodeSent(true);
      message.success(json.message || t('auth.codeSent'));
      setCodeTimer(60);
      const interval = setInterval(() => {
        setCodeTimer((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('发送验证码失败:', err);
      message.error(err instanceof Error ? translateApiError(err) : i18n.t('errors.BAD_REQUEST'));
    } finally {
      setCodeSending(false);
    }
  };

  const handleSubmit = async (values: Record<string, string | undefined>) => {
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(values.email!, values.password!);
      } else {
        if (values.password !== values.confirmPassword) {
          message.error(t('auth.passwordMismatch'));
          setSubmitting(false);
          return;
        }
        if (!values.code) {
          message.error(t('auth.codeRequired'));
          setSubmitting(false);
          return;
        }
        await register(values.email!, values.username!, values.password!, values.code!);
      }
      onSuccess();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('auth.failed');
      message.error(translateApiError(msg));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ConfigProvider
      theme={{
        cssVar: { key: 'zx-auth' },
        algorithm: antdTheme.darkAlgorithm,
        token: {
          zIndexPopupBase: 20000,
          colorPrimary: '#ff1a2c',
          colorBgLayout: '#0d0b0a',
          colorBgContainer: 'rgba(255,255,255,0.03)',
          colorBgElevated: '#1a1a1a',
          colorText: '#ffffff',
          colorTextSecondary: 'rgba(255,255,255,0.6)',
          colorBorder: 'rgba(255,255,255,0.1)',
          colorError: '#ff1a2c',
          borderRadius: 8,
          fontSize: 13,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        },
        components: {
          Button: { primaryShadow: 'none', controlHeight: 32, fontSize: 13, fontWeight: 500 },
          Input: { controlHeight: 36, fontSize: 14 },
          Modal: { borderRadiusLG: 12, paddingContentHorizontal: 24, paddingMD: 20 },
        },
      }}
      getPopupContainer={() => document.body}
    >
      {/* 赛博朋克风格 CSS */}
      <style>{AUTH_PAGE_CSS}</style>
      <style>{AUTH_HIDE_SCROLLBAR_CSS}</style>
      <div data-auth-page style={pageStyle}>
        {/* 顶部品牌 - 固定左上角, 与主页同款尺寸位置 */}
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 16,
          zIndex: 100,
          cursor: 'pointer',
          color: '#ffffff',
        }}>
          <LogoIcon size={28} />
          <span style={{
            fontSize: 16,
            fontWeight: 300,
            letterSpacing: '0.12em',
            fontFamily: "'Sora', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
            color: '#ffffff',
          }}>zeroExo</span>
        </div>

        {/* 关闭按钮 - 固定定位,未登录用户可关闭回到主页 */}
        {onClose && (
          <Tooltip title={t('common.close')}>
            <button
              type="button"
              onClick={onClose}
              style={{
                position: 'fixed',
                top: 8,
                right: 16,
                zIndex: 100,
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.08)',
                color: darkTheme.toolbar.text,
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </Tooltip>
        )}

        {/* 语言切换 - 右上角关闭按钮左侧 */}
        <div style={{
          position: 'fixed',
          top: 8,
          right: onClose ? 56 : 16,
          zIndex: 100,
        }}>
          <LanguageSwitcher theme={darkTheme} />
        </div>

        {/* 表单区全屏居中 */}
        <div style={leftPanelStyle(isMobile)}>
          <div style={centeredWrapperStyle}>
          <ConfigProvider
            theme={{
              token: {
                colorPrimary: '#1c1917',
              },
              components: {
                Input: {
                  borderRadius: 8,
                  colorBgContainer: 'transparent',
                  colorText: '#fff',
                  colorTextPlaceholder: 'rgba(255,255,255,0.15)',
                  activeBorderColor: 'rgba(255,26,44,0.3)',
                  hoverBorderColor: 'rgba(255,255,255,0.1)',
                  activeShadow: 'none',
                  paddingInline: 20,
                },
                Button: {
                  borderRadius: 0,
                },
              },
            }}
          >
          <div style={formContainerStyle(isMobile)}>
              {/* 顶部装饰线 */}
              <div style={{
                width: 60,
                height: 2,
                background: 'linear-gradient(90deg, #ff1a2c, transparent)',
                marginBottom: 4,
              }} />

              {/* 子标题 */}
              <Text style={{ fontSize: 14, color: '#ffffff', letterSpacing: '0.05em' }}>
                {isLogin ? t('auth.loginSubtitle') : t('auth.registerSubtitle')}
              </Text>

              {/* 表单 */}
              <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
                style={{ width: '100%', display: 'flex', flexDirection: 'column', rowGap: 16 }}
                requiredMark={false}
                size="middle"
              >
                <Form.Item name="email" label={t('auth.email')} rules={[
                  { required: true, message: t('errors.AUTH_EMAIL_REQUIRED') },
                  { type: 'email', message: t('auth.emailInvalid') },
                  {
                    validator: (_, value) => {
                      if (!value || smtpConfig === null) return Promise.resolve();
                      if (smtpConfig.domains.length === 0) return Promise.resolve();
                      const domain = value.split('@')[1]?.toLowerCase();
                      if (domain && !smtpConfig.domains.includes(domain)) {
                        return Promise.reject(new Error(t('auth.emailDomainOnly', { domains: smtpConfig.domains.join(', ') })));
                      }
                      return Promise.resolve();
                    },
                  },
                ]} rootClassName="auth-form-item">
                  <div className="auth-input-wrapper">
                    <Input placeholder={t('auth.emailPlaceholder')} className="auth-form-input" />
                    <div className="auth-input-scanline"></div>
                  </div>
                </Form.Item>

                {!isLogin && (
                  <Form.Item name="username" label={t('auth.username')} rules={[{ required: true, message: t('auth.usernameRequired') }]} rootClassName="auth-form-item">
                    <div className="auth-input-wrapper">
                      <Input placeholder={t('auth.usernamePlaceholder')} className="auth-form-input" />
                      <div className="auth-input-scanline"></div>
                    </div>
                  </Form.Item>
                )}

                <Form.Item name="password" label={t('auth.password')} rules={[{ required: true, min: 6, message: t('auth.passwordMin') }]} rootClassName="auth-form-item">
                  <div className="auth-input-wrapper">
                    <Input.Password
                      placeholder={t('auth.passwordPlaceholder')}
                      className="auth-form-input"
                      iconRender={(visible) => (visible ? <Eye size={16} /> : <EyeOff size={16} />)}
                    />
                    <div className="auth-input-scanline"></div>
                  </div>
                </Form.Item>

                {!isLogin && (
                  <Form.Item name="confirmPassword" label={t('auth.confirmPassword')} rules={[
                    { required: true, message: t('auth.confirmPasswordRequired') },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue('password') === value) return Promise.resolve();
                        return Promise.reject(new Error(t('auth.passwordMismatch')));
                      },
                    }),
                  ]} rootClassName="auth-form-item">
                    <div className="auth-input-wrapper">
                      <Input.Password placeholder={t('auth.confirmPasswordPlaceholder')} className="auth-form-input" />
                      <div className="auth-input-scanline"></div>
                    </div>
                  </Form.Item>
                )}

                {!isLogin && (
                  <Form.Item name="code" label={t('auth.codePlaceholder')} rules={[{ required: true, message: t('auth.codeRequired') }]}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Input
                        maxLength={6}
                        placeholder={t('auth.codePlaceholder')}
                        style={{ flex: 1 }}
                        className="auth-form-input"
                      />
                      <Button
                        disabled={codeSending || codeTimer > 0}
                        loading={codeSending}
                        onClick={handleSendCode}
                        className="auth-code-btn"
                      >
                        {codeTimer > 0 ? `${codeTimer}s` : t('auth.sendCode')}
                      </Button>
                    </div>
                  </Form.Item>
                )}

                {isLogin && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
                    <div></div>
                    <Button type="link" style={{ padding: 0, height: 'auto', fontSize: 12 }} onClick={() => setShowForgotModal(true)} className="auth-forgot-link">
                      {t('auth.forgotPassword')}
                    </Button>
                  </div>
                )}

                {/* 注册协议 */}
                {!isLogin && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
                    {t('auth.registerAgreement')}{' '}
                    <a href="#/legal/policies/terms" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                      {t('auth.termsOfService')}
                    </a>
                    {' '}{t('auth.and')}{' '}
                    <a href="#/legal/policies/privacy" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                      {t('auth.privacyPolicy')}
                    </a>
                  </div>
                )}

                <Form.Item style={{ marginBottom: 0 }}>
                  <Button type="primary" htmlType="submit" block loading={submitting} size="large" className="auth-login-btn">
                    <span>{isLogin ? t('auth.login') : t('auth.register')}</span>
                  </Button>
                </Form.Item>
              </Form>

              {/* 切换 */}
              <div style={switchStyle}>
                <Text style={{ fontSize: 13, color: '#ffffff' }}>
                  {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
                </Text>
                <Button type="link" onClick={() => onSwitchMode(isLogin ? 'register' : 'login')} style={{ padding: 0, height: 'auto' }} className="auth-switch-link">
                  {isLogin ? t('auth.register') : t('auth.login')}
                </Button>
              </div>
            </div>
          </ConfigProvider>
          </div>

          {/* 底部信息 */}
          <footer style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            // 透明区域不拦截点击,避免遮挡登录/注册按钮;仅政策图标本身可点击
            pointerEvents: 'none',
            zIndex: 10,
          }}>
            {/* 左下角：政策公告圆形图标 */}
            <Tooltip title={t('auth.policyNotice')}>
              <a
                href="#/legal/policies/privacy"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  color: 'rgba(255,255,255,0.4)',
                  textDecoration: 'none',
                  pointerEvents: 'auto',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
              >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2 2 6.5 2 12s4.5 10 10 10z" />
                <path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4" />
                <path d="M12 17h.01" />
              </svg>
            </a>
            </Tooltip>

            {/* 底部居中：技术信息 */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, lineHeight: 1.6 }}>
                <span>ZeroExo v1.0.0</span>
                <span style={{ margin: '0 6px', opacity: 0.3 }}>|</span>
                <span>Build 2026.08.23</span>
                <span style={{ margin: '0 6px', opacity: 0.3 }}>|</span>
                <span>React 19 + NestJS</span>
              </div>
              <div style={{ marginTop: 2, color: 'rgba(255,255,255,0.15)', fontSize: 9 }}>ZeroExo &copy; 2026</div>
            </div>

            {/* 右下角占位平衡 */}
            <div style={{ width: 36 }} />
          </footer>
        </div>

        {/* 全屏背景视频(桌面端显示),左侧表单在前景 */}
        {!isMobile && <HeroVideoPlayer />}

        {/* 透视网格覆盖层 */}
        {!isMobile && (
          <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1,
            perspective: '600px',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute',
              width: '200vw',
              height: '200vh',
              left: '-50vw',
              top: '-50vh',
              background: `
                linear-gradient(transparent 49.5%, var(--auth-accent-glow-dim) 49.5% 50.5%, transparent 50.5%),
                linear-gradient(90deg, transparent 49.5%, var(--auth-accent-glow-dim) 49.5% 50.5%, transparent 50.5%)
              `,
              backgroundSize: '60px 60px, 60px 60px',
              transform: 'rotateX(70deg) translateZ(-200px)',
              animation: 'auth-grid-shift 3s linear infinite',
              opacity: 1,
            }} />
          </div>
        )}

        {/* 光晕/雾气 */}
        {!isMobile && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 3, pointerEvents: 'none',
            background: `
              radial-gradient(ellipse 40% 30% at 20% 60%, ${darkTheme.toolbar.accent}10 0%, transparent 70%),
              radial-gradient(ellipse 35% 25% at 80% 40%, ${darkTheme.toolbar.accent}08 0%, transparent 70%),
              radial-gradient(ellipse 60% 40% at 50% 80%, rgba(100,0,0,0.08) 0%, transparent 60%)
            `,
            animation: 'auth-fog-drift 8s ease-in-out infinite alternate',
          }} />
        )}

        {/* 扫描线 */}
        {!isMobile && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 4, pointerEvents: 'none',
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)',
          }} />
        )}

        {/* 暗角 */}
        {!isMobile && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 5, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 70% 70% at 50% 50%, transparent 30%, rgba(0,0,0,0.75) 100%)',
          }} />
        )}

        {/* 左侧装饰文字 */}
        {!isMobile && (
          <div style={{
            position: 'fixed', left: 30, top: '50%', transform: 'translateY(-50%)',
            zIndex: 8, pointerEvents: 'none',
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 9, letterSpacing: 2,
            color: darkTheme.toolbar.accent + '60',
            writingMode: 'vertical-rl',
            textTransform: 'uppercase',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ animation: 'auth-deco-flicker 3s ease-in-out infinite' }}>// SYS.ONLINE</span>
              <span style={{ animation: 'auth-deco-flicker 3s ease-in-out infinite', animationDelay: '1s' }}>// SECURE_LINK</span>
              <span style={{ animation: 'auth-deco-flicker 3s ease-in-out infinite', animationDelay: '2s' }}>// ENCRYPTED</span>
            </div>
          </div>
        )}

        {/* 右侧数据流 */}
        {!isMobile && (
          <div style={{
            position: 'fixed', right: 30, top: '50%', transform: 'translateY(-50%)',
            zIndex: 8, pointerEvents: 'none',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{
                width: 3, height: 12,
                background: darkTheme.toolbar.accent,
                opacity: 0.3,
                animation: `auth-data-flow 2s ease-in-out ${i * 0.3}s infinite`,
              }} />
            ))}
          </div>
        )}

        {/* 忘记密码弹窗 */}
        <ForgotPasswordModal open={showForgotModal} onClose={() => setShowForgotModal(false)} />
      </div>
    </ConfigProvider>
  );
}




