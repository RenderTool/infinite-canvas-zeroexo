/**
 * App - 应用根(路由 + 布局装配 + 鉴权守卫)
 *
 * P0.3 重构:
 * - 加载期间(authInitialized=false)显示全屏 Loading,不渲染任何路由
 * - 未认证时仅允许访问 auth 路由,其他路由重定向到 auth/login
 * - 已认证时访问 auth 路由重定向到 home
 *
 * 布局:
 * - home/canvas/assets/prompts:顶部栏 + 侧边栏 + 主内容
 * - editor:编辑器自带 TopBar(无顶部栏/侧边栏)
 * - auth:认证页独立布局(无顶部栏/侧边栏)
 *
 * 移动端 NAV 统一:
 * - 主页/画布/素材/提示词 共享一个 MobileNavButton(右上角触发) + MobileNavDrawer
 * - 画布编辑页(EditorPage) 仍走自己的 TopBar,但 TopBar 内部使用同一套 MobileNavDrawer
 * - 按钮统一放右上角,解决主页原本没有显示按钮的问题
 */

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { App as AntdApp } from 'antd';
import {
  AppLayout,
  AntdThemeProvider,
  MobileNavButton,
  MobileNavDrawer,
  ChangelogPanel,
  type NavRouteItem,
} from '@/shared/components/index.js';
import { AppSidebar, AppTopBar } from '@/features/app-sidebar/index.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { HomePage } from '@/pages/home/home-page.js';
import { EditorPage } from '@/pages/editor/editor-canvas/editor-page.js';
import {
  AssetLibraryPage,
  PublicPromptsPage,
} from '@/features/asset-library/index.js';
import { PolicyPage } from '@/pages/legal/index.js';
import { AuthPage } from '@/features/auth/auth-page.js';
import type { AuthMode } from '@/features/auth/auth-page.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { InvitePage } from '@/features/collaboration/invite-page.js';
import { ErrorBoundary } from '@/shared/components/index.js';

import { CanvasPage } from '@/pages/home/canvas-page.js';
import { CanvasV2Page } from '@/pages/canvas-v2/canvas-v2-page.js';
import { AppearanceDialog, LanguageDialog } from '@/shared/components/index.js';

type Route =
  | { name: 'home' }
  | { name: 'canvas'; canvasId?: string }
  | { name: 'editor'; canvasId: string }
  | { name: 'canvasV2' }
  | { name: 'assets'; defaultGroup?: string; defaultChild?: string; focusId?: string }
  | { name: 'publicPrompts' }
  | { name: 'auth'; mode: AuthMode }
  | { name: 'legal'; page: 'policies'; policyKey?: string }
  | { name: 'invite'; inviteCode: string; autoJoin?: boolean }
  ;

/**
 * URL hash 路由持久化 - 刷新/分享链接时恢复路由,避免重载回主页。
 *
 * Hash 格式:
 *   #/                          → home
 *   #/canvas/<canvasId>         → canvas
 *   #/editor/<canvasId>         → editor
 *   #/assets                    → assets
 *   #/assets/prompt           → assets (资产库)
 *   #/auth/<mode>               → auth
 *   #/legal/policies           → legal (policies)
 *   #/c/<inviteCode>           → invite (协作邀请码解析)
 */
function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\//, '');
  if (!path) return { name: 'home' };
  const parts = path.split('/');
  // 提取基础路径和查询参数
  const firstPart = parts[0] ?? '';
  const qsIndex = firstPart.indexOf('?');
  const basePath = qsIndex >= 0 ? firstPart.substring(0, qsIndex) : firstPart;
  const searchParams = qsIndex >= 0 ? new URLSearchParams(firstPart.substring(qsIndex + 1)) : new URLSearchParams();
  switch (basePath) {
    case 'canvas':
      return parts[1] ? { name: 'canvas', canvasId: decodeURIComponent(parts[1]) } : { name: 'canvas' };
    case 'editor':
      return parts[1] ? { name: 'editor', canvasId: decodeURIComponent(parts[1]) } : { name: 'canvas' };
    case 'canvas-v2':
      return { name: 'canvasV2' };
    case 'assets':
      // Plan#29 V3: 主体入口已移除, /assets/subject/* 统一回落 assets(不再路由到主体创建页)
      // 支持查询参数 ?group=prompt&child=favorite&focus=<id>
      return {
        name: 'assets',
        defaultGroup: searchParams.get('group') || undefined,
        defaultChild: searchParams.get('child') || undefined,
        focusId: searchParams.get('focus') || undefined,
      };
    case 'public-prompts':
      return { name: 'publicPrompts' };
    case 'auth':
      return { name: 'auth', mode: parts[1] === 'register' ? 'register' : 'login' };
    case 'legal':
      return { name: 'legal', page: 'policies', policyKey: parts[2] || undefined };
    case 'admin-policies':
      return { name: 'home' };
    case 'c':
      // 协作邀请链接: /c/<inviteCode> → 解析后跳转目标画布编辑器
      return parts[1] ? { name: 'invite', inviteCode: decodeURIComponent(parts[1]) } : { name: 'home' };
    default:
      return { name: 'home' };
  }
}

function serializeRoute(route: Route): string {
  switch (route.name) {
    case 'canvas':
      return route.canvasId ? `#/canvas/${encodeURIComponent(route.canvasId)}` : '#/canvas';
    case 'editor':
      return `#/editor/${encodeURIComponent(route.canvasId)}`;
    case 'canvasV2':
      return '#/canvas-v2';
    case 'assets':
      const qp: string[] = [];
      if (route.defaultGroup) qp.push(`group=${encodeURIComponent(route.defaultGroup)}`);
      if (route.defaultChild) qp.push(`child=${encodeURIComponent(route.defaultChild)}`);
      if (route.focusId) qp.push(`focus=${encodeURIComponent(route.focusId)}`);
      return qp.length > 0 ? `#/assets?${qp.join('&')}` : '#/assets';
    case 'publicPrompts':
      return '#/public-prompts';
    case 'auth':
      return `#/auth/${route.mode}`;
    case 'legal':
      return route.policyKey ? `#/legal/${route.page}/${route.policyKey}` : `#/legal/${route.page}`;
    case 'invite':
      return `#/c/${encodeURIComponent(route.inviteCode)}`;
    default:
      return '#/';
  }
}

/** 全屏 Loading(鉴权初始化期间显示) */
function FullScreenLoading(): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const bg = theme.canvas.background;
  const fg = theme.toolbar.text;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        background: bg,
        color: fg,
        zIndex: 9999,
      }}
    >
      <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: 13, opacity: 0.7 }}>{t('common.loading')}</span>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function App(): React.ReactElement {
  const { loading, isAuthenticated, logout } = useAuth();
  const isMobile = useIsMobile();
  // 初始化时从 URL hash 恢复路由,解决刷新后跳回主页的问题
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  // Plan#38 Phase 9: 未登录点击邀请页「加入」跳登录前暂存邀请码,
  // 登录/注册成功后回流到邀请页并自动加入（不再丢失）
  const pendingInviteCodeRef = useRef<string | null>(null);

  // 移动端导航抽屉状态(主页/创作/画布/素材/提示词 共享)
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // 换肤弹窗状态
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // 更新日志弹窗
  const [changelogOpen, setChangelogOpen] = useState(false);
  // 语言设置弹窗(移动端抽屉触发)
  const [languageOpen, setLanguageOpen] = useState(false);

  const { theme } = useTheme();
  const { t, i18n } = useTranslation();

  // 路由守卫:
  // - 已登录用户访问 auth 自动跳转主页
  // - 未登录时仅允许访问公开路由(home/auth/legal/publicPrompts/invite),
  //   其他路由(编辑器/画布/资产等)一律重定向到登录页,
  //   避免未登录即可打开他人画布链接造成越权访问。
  // - invite 为公开路由(腾讯云文档式邀请体验,Plan#38 Phase 9):
  //   未登录可浏览邀请落地页,点击加入时再引导登录并回流自动加入。
  useEffect(() => {
    if (loading) return;
    if (isAuthenticated && route.name === 'auth') {
      setRoute({ name: 'home' });
      return;
    }
    if (!isAuthenticated) {
      const publicRoutes = new Set(['home', 'auth', 'legal', 'publicPrompts', 'invite']);
      if (!publicRoutes.has(route.name)) {
        setRoute({ name: 'auth', mode: 'login' });
      }
    }
  }, [loading, isAuthenticated, route.name]);

  // 路由 → URL hash 同步(支持刷新/分享链接/浏览器前进后退)
  // 初次恢复用 replaceState(避免污染历史),后续导航用 pushState(支持后退)
  const isInitialHashSync = useRef(true);
  useEffect(() => {
    const expected = serializeRoute(route);
    if (window.location.hash !== expected) {
      if (isInitialHashSync.current) {
        window.history.replaceState(null, '', expected);
      } else {
        window.history.pushState(null, '', expected);
      }
    }
    isInitialHashSync.current = false;
  }, [route]);

  // 监听浏览器前进/后退(hashchange),同步到 route
  useEffect(() => {
    const onHashChange = (): void => {
      const next = parseHash(window.location.hash);
      setRoute((prev) => (serializeRoute(prev) === serializeRoute(next) ? prev : next));
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, []);

  // 鉴权初始化期间显示全屏 Loading
  if (loading) {
    return <FullScreenLoading />;
  }

  // 需要显示顶部栏 + 侧边栏的路由（canvasV2 / editor / canvas(带id) 为全屏独立画布页，不套主布局，避免与主页框架叠加）
  const showHeaderAndSidebar = route.name !== 'editor' && route.name !== 'canvasV2' && route.name !== 'auth' && route.name !== 'legal' && route.name !== 'invite' && !(route.name === 'canvas' && !!route.canvasId);

  // 当前活跃路由名（用于侧边栏高亮）
  const activeRoute = route.name === 'canvas' ? 'canvas' : route.name === 'home' ? 'home' : route.name === 'assets' ? 'assets' : route.name === 'publicPrompts' ? 'publicPrompts' : route.name === 'legal' && route.page === 'policies' ? 'policies' : '';

  /** 侧边栏导航回调 */
  const handleNavigate = (target: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies' | { name: 'auth'; mode: 'login' }): void => {
    // 未登录时点击资产/画布直接跳转登录页，不再显示页面内登录提示
    if (typeof target === 'string' && (target === 'assets' || target === 'canvas') && !isAuthenticated) {
      setRoute({ name: 'auth', mode: 'login' });
      return;
    }
    if (typeof target === 'string') {
      if (target === 'policies') {
        setRoute({ name: 'legal', page: 'policies' });
      } else {
        setRoute({ name: target } as Route);
      }
    } else {
      setRoute(target);
    }
  };

  // 抽屉导航项(主页/画布列表/资产库/公共提示词/政策公告 共用)
  const navItems: NavRouteItem[] = [
    { key: 'home', label: t('nav.home') },
    { key: 'canvas', label: t('nav.canvas') },
    { key: 'assets', label: t('nav.assets') },
    { key: 'publicPrompts', label: t('nav.publicPrompts') },
    { key: 'policies', label: t('nav.policies') },
  ];

  return (
    <AntdThemeProvider>
      <AntdApp>
        {/* 全局图标 hover 动画样式 */}
        <style>{`
          .zeroexo-icon-btn {
            transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
          }
          .zeroexo-icon-btn:hover {
            transform: scale(1.1) !important;
          }
          .zeroexo-icon-btn:active {
            transform: scale(0.95) !important;
          }
          @keyframes zeroexo-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }
          /* 移动端防溢出:确保 html/body 不会有滚动条,且任何 div 都不会顶到 viewport 外 */
          html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            max-width: 100vw;
            overflow: hidden;
            overscroll-behavior: none;
          }
          body {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            -webkit-overflow-scrolling: touch;
          }
          @media (max-width: 768px) {
            html, body, #root {
              max-height: 100dvh;
            }
          }
        `}</style>
        <AppLayout
          isMobile={isMobile}
          header={showHeaderAndSidebar && !isMobile ? (
            <AppTopBar
              onNavigate={handleNavigate}
              activeRoute={activeRoute}
              onRequestAppearance={() => setAppearanceOpen(true)}
              onRequestChangelog={() => setChangelogOpen(true)}
            />
          ) : undefined}
          sidebar={showHeaderAndSidebar && !isMobile ? (
            <AppSidebar activeRoute={activeRoute} onNavigate={handleNavigate} />
          ) : undefined}
          mobileNavTrigger={isMobile && showHeaderAndSidebar ? (
            <MobileNavButton onClick={() => setMobileNavOpen(true)} title={t('nav.menu')} />
          ) : undefined}
          mobileNavDrawer={isMobile && showHeaderAndSidebar ? (
            <MobileNavDrawer
              theme={theme}
              open={mobileNavOpen}
              onClose={() => setMobileNavOpen(false)}
              navItems={navItems}
              activeKey={activeRoute}
              onNavigate={(key) => handleNavigate(key)}
              onOpenAppearance={() => setAppearanceOpen(true)}
              onOpenLanguage={() => setLanguageOpen(true)}
              isAuthenticated={isAuthenticated}
              onLogin={() => handleNavigate({ name: 'auth', mode: 'login' })}
              onLogout={async () => {
                await logout();
                handleNavigate({ name: 'auth', mode: 'login' });
              }}
            />
          ) : undefined}
        >
          <ErrorBoundary>
            {route.name === 'home' ? (
              <HomePage
                onOpenProject={(id) => setRoute({ name: 'editor', canvasId: id })}
                onOpenCanvas={(id) => setRoute({ name: 'canvas', canvasId: id })}
                onNavigate={handleNavigate}
              />
            ) : route.name === 'canvas' ? (
              route.canvasId ? (
                <EditorPage
                  key={route.canvasId}
                  canvasId={route.canvasId}
                  onBack={() => setRoute({ name: 'canvas' })}
                  onOpenProject={(id) => setRoute({ name: 'editor', canvasId: id })}
                />
              ) : (
                <CanvasPage
                  onOpen={(id) => setRoute({ name: 'editor', canvasId: id })}
                />
              )
            ) : route.name === 'editor' ? (
              <EditorPage
                key={route.canvasId}
                canvasId={route.canvasId}
                onBack={() => setRoute({ name: 'canvas' })}
                onOpenProject={(id) => setRoute({ name: 'editor', canvasId: id })}
              />
            ) : route.name === 'canvasV2' ? (
              <CanvasV2Page onBack={() => setRoute({ name: 'home' })} />
            ) : route.name === 'invite' ? (
              // 邀请落地页（腾讯云文档式：展示邀请者信息 + 加入；未登录可浏览，
              // 加入时引导登录并回流自动加入；失效链接展示失效页）
              <InvitePage
                inviteCode={route.inviteCode}
                autoJoin={!!route.autoJoin}
                isAuthenticated={isAuthenticated}
                onJoined={(canvasId) => setRoute({ name: 'editor', canvasId })}
                onGoHome={() => setRoute({ name: 'home' })}
                onGoLogin={() => {
                  pendingInviteCodeRef.current = route.inviteCode;
                  setRoute({ name: 'auth', mode: 'login' });
                }}
              />
            ) : route.name === 'assets' ? (
              <AssetLibraryPage
                defaultGroup={route.defaultGroup}
                defaultChild={route.defaultChild}
                focusId={route.focusId}
                onNavigateHome={() => setRoute({ name: 'home' })}
              />
            ) : route.name === 'publicPrompts' ? (
              <PublicPromptsPage />
            ) : route.name === 'legal' ? (
              <PolicyPage policyKey={route.policyKey} />
            ) : (
              <AuthPage
                mode={route.mode}
                onSuccess={() => {
                  // 登录前来自邀请页 → 回流到邀请页并自动加入；否则回主页
                  const code = pendingInviteCodeRef.current;
                  pendingInviteCodeRef.current = null;
                  setRoute(code ? { name: 'invite', inviteCode: code, autoJoin: true } : { name: 'home' });
                }}
                onSwitchMode={(mode) => setRoute({ name: 'auth', mode })}
                onClose={() => setRoute({ name: 'home' })}
              />
            )}
          </ErrorBoundary>
        </AppLayout>

        {/* 换肤弹窗(全局唯一) */}
        {appearanceOpen ? (
          <AppearanceDialog
            theme={theme}
            currentMode={theme.mode}
            onClose={() => setAppearanceOpen(false)}
          />
        ) : null}

        {/* 语言设置弹窗(移动端抽屉触发) */}
        {languageOpen ? (
          <LanguageDialog
            theme={theme}
            currentLang={(i18n.language as any) || 'zh'}
            onClose={() => setLanguageOpen(false)}
          />
        ) : null}

        {/* 更新日志弹窗(全局唯一) */}
        <ChangelogPanel open={changelogOpen} onClose={() => setChangelogOpen(false)} />
      </AntdApp>
    </AntdThemeProvider>
  );
}
