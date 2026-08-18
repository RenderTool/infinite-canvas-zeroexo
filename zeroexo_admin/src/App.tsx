import { useEffect, useState, useMemo } from 'react';
import { RouterProvider, createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { ConfigProvider, Spin, theme } from 'antd';
import { setAccessToken } from '@/services/api-client';
import MainLayout from '@/layouts/MainLayout';
import Login from '@/pages/login';
import Register from '@/pages/register';
import ApplyPage from '@/pages/apply';
import Logs from '@/pages/logs';
import UsersList from '@/pages/users-list';
import UsersRecycle from '@/pages/users-recycle';
import UsersApplications from '@/pages/users-applications';
import Analytics from '@/pages/analytics';
import UserResources from '@/pages/user-resources';
import ApiSettings from '@/pages/api-settings';
import AiTest from '@/pages/ai-test';
import SiteContent from '@/pages/site-content';
import PublicPrompts from '@/pages/public-prompts';
import PricingSettings from '@/pages/pricing-settings';
import AdminCredit from '@/pages/admin-credit';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en';
import i18n from './i18n';

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && (user.role === 'admin' || user.role === 'super_admin' || user.role === 'operator')) {
    return <>{children}</>;
  }
  return <Navigate to="/apply" replace />;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (user && (user.role === 'admin' || user.role === 'super_admin' || user.role === 'operator')) {
    return <Navigate to="/analytics" replace />;
  }
  return <Navigate to="/apply" replace />;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (user) {
    return <HomeRedirect />;
  }
  return <>{children}</>;
}

const antdLocaleMap: Record<string, typeof zhCN> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

function AppContent() {
  useEffect(() => {
    const token = localStorage.getItem('admin-token');
    if (token) {
      setAccessToken(token);
    }
  }, []);

  const router = createBrowserRouter(
    [
      {
        path: '/login',
        element: (
          <AuthRoute>
            <Login />
          </AuthRoute>
        ),
      },
      {
        path: '/register',
        element: (
          <AuthRoute>
            <Register />
          </AuthRoute>
        ),
      },
      {
        path: '/',
        element: <ProtectedRoute />,
        children: [
          {
            path: '/',
            element: <HomeRedirect />,
          },
          {
            path: 'apply',
            element: <ApplyPage />,
          },
          {
            element: <AdminGuard><MainLayout /></AdminGuard>,
            children: [
              {
                path: 'logs',
                element: <Logs />,
              },
              {
                path: 'api-settings',
                element: <Navigate to="/api-settings/ai" replace />,
              },
              {
                path: 'api-settings/*',
                element: <ApiSettings />,
              },
              {
                path: 'ai-test',
                element: <AiTest />,
              },
              {
                path: 'analytics',
                element: <Navigate to="/analytics/operations" replace />,
              },
              {
                path: 'analytics/operations',
                element: <Analytics />,
              },
              {
                path: 'analytics/billing',
                element: <Analytics />,
              },
              {
                path: 'users',
                element: <Navigate to="/users/list" replace />,
              },
              {
                path: 'users/list',
                element: <UsersList />,
              },
              {
                path: 'users/recycle',
                element: <UsersRecycle />,
              },
              {
                path: 'users/applications',
                element: <UsersApplications />,
              },
              {
                path: 'site-operations',
                element: <Navigate to="/site-operations/content" replace />,
              },
              {
                path: 'site-operations/content',
                element: <SiteContent />,
              },
              {
                path: 'site-operations/public-prompts',
                element: <PublicPrompts />,
              },
              {
                path: 'site-operations/pricing',
                element: <PricingSettings />,
              },
              {
                path: 'site-operations/credits',
                element: <AdminCredit />,
              },
              {
                path: 'users/:userId/resources',
                element: <UserResources />,
              },
            ],
          },
        ],
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
    {
      basename: '/admin',
    },
  );

  return <RouterProvider router={router} />;
}

export default function App() {
  const [locale, setLocale] = useState(() => {
    const lang = localStorage.getItem('i18n-lang') || 'zh-CN';
    return antdLocaleMap[lang] || zhCN;
  });

  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      const antdLocale = antdLocaleMap[lng] || zhCN;
      setLocale(antdLocale);
      dayjs.locale(lng === 'zh-CN' ? 'zh-cn' : 'en');
    };
    i18n.on('languageChanged', handleLanguageChange);
    const currentLang = i18n.language || 'zh-CN';
    dayjs.locale(currentLang === 'zh-CN' ? 'zh-cn' : 'en');
    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  const themeConfig = useMemo(() => ({
    algorithm: theme.defaultAlgorithm,
    token: {
      // 品牌主色
      colorPrimary: '#1677ff',
      colorPrimaryHover: '#4096ff',
      colorPrimaryActive: '#0958d9',
      colorPrimaryBg: '#e6f4ff',
      // 功能色
      colorSuccess: '#10b981',
      colorSuccessBg: '#ecfdf5',
      colorWarning: '#f59e0b',
      colorWarningBg: '#fffbeb',
      colorError: '#ef4444',
      colorErrorBg: '#fef2f2',
      colorInfo: '#1677ff',
      // 文本色（WCAG AA 对比度）
      colorText: '#171717',
      colorTextSecondary: '#525252',
      colorTextTertiary: '#a3a3a3',
      colorTextQuaternary: '#d4d4d4',
      // 背景层级
      colorBgLayout: '#fafafa',
      colorBgContainer: '#ffffff',
      colorBgElevated: '#f5f5f5',
      // 边框
      colorBorder: '#e5e5e5',
      colorBorderSecondary: '#f5f5f5',
      // 圆角
      borderRadius: 6,
      borderRadiusSM: 4,
      borderRadiusLG: 8,
      // 字体
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      fontSize: 14,
      fontSizeHeading1: 28,
      fontSizeHeading2: 20,
      fontSizeHeading3: 16,
      fontSizeHeading4: 14,
      fontSizeHeading5: 12,
      // 控件尺寸
      controlHeight: 36,
      controlHeightLG: 44,
      controlHeightSM: 24,
      // 间距
      marginXS: 4,
      marginSM: 8,
      margin: 16,
      marginMD: 24,
      marginLG: 32,
      paddingXS: 4,
      paddingSM: 8,
      padding: 16,
      paddingMD: 24,
      paddingLG: 32,
    },
    components: {
      Layout: {
        headerBg: '#ffffff',
        headerHeight: 56,
        headerPadding: '0 24px',
        headerBorderRight: '1px solid #e5e5e5',
        siderBg: '#ffffff',
        bodyBg: '#fafafa',
      },
      Menu: {
        itemBg: 'transparent',
        itemSelectedBg: '#eff6ff',
        itemHoverBg: '#f5f5f5',
        itemHeight: 40,
        itemBorderRadius: 6,
        itemColor: '#525252',
        itemSelectedColor: '#1677ff',
        itemHoverColor: '#171717',
      },
      Table: {
        headerBg: '#f5f5f5',
        headerColor: '#525252',
        headerSplitColor: '#e5e5e5',
        rowHoverBg: '#f5f5f5',
        borderColor: '#f5f5f5',
        cellPaddingBlock: 12,
        cellPaddingInline: 16,
        fontSize: 13,
        headerFontSize: 13,
        headerFontWeight: 600,
      },
      Card: {
        paddingLG: 16,
        paddingSM: 8,
        headerFontSize: 15,
        headerHeight: 52,
        headerFontWeight: 600,
      },
      Button: {
        controlHeightSM: 24,
        controlHeight: 36,
        controlHeightLG: 44,
        borderRadius: 6,
        fontWeight: 500,
      },
      Input: {
        controlHeight: 36,
        activeBorderColor: '#1677ff',
        hoverBorderColor: '#1677ff',
        activeShadow: '0 0 0 2px rgba(22, 119, 255, 0.1)',
      },
      Select: {
        controlHeight: 36,
        optionSelectedBg: '#eff6ff',
        optionActiveBg: '#f5f5f5',
      },
      Modal: {
        contentBg: '#ffffff',
        headerBg: '#ffffff',
        titleColor: '#171717',
        titleFontSize: 18,
        titleFontWeight: 600,
        bodyPadding: 24,
        headerPadding: '16px 24px',
        footerPadding: '16px 24px',
      },
      Tag: {
        defaultBg: '#f5f5f5',
      },
      Switch: {
        trackHeight: 22,
        trackMinWidth: 40,
      },
    },
  }), []);

  return (
    <ConfigProvider locale={locale} theme={themeConfig} modal={{ centered: true }}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ConfigProvider>
  );
}