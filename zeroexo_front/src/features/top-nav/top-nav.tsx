/**
 * TopNav - 顶部导航(antd 原生组件)
 *
 * 使用 antd Button/Avatar/Dropdown/Menu 替代自定义按钮,
 * 与 antd Layout 主题风格一致。
 */

import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutGrid,
  Image as ImageIcon,
  FileText,
  LogIn,
  LogOut,
  Menu,
  Github,
  X,
  Sparkles,
} from 'lucide-react';
import {
  Menu as AntdMenu,
  Drawer,
  Button,
  Dropdown,
  Tooltip,
} from 'antd';
import type { MenuProps } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useAuth } from '../auth/auth-store.js';
import { LogoIcon } from '@/assets/ico/index.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { LanguageSwitcher } from '@/shared/components/language-switcher.js';
import { AppearanceDialog } from '@/shared/components/index.js';

if (typeof document !== 'undefined') {
  const styleId = 'zeroexo-nav-spin';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    document.head.appendChild(style);
  }
}

export interface TopNavProps {
  activeRoute: string;
  onNavigate: (route: 'home' | 'creation' | 'assets' | 'prompts' | { name: 'auth'; mode: 'login' }) => void;
}

export function TopNav({ activeRoute, onNavigate }: TopNavProps): React.ReactElement {
  const { theme, mode } = useTheme();
  const { t } = useTranslation();
  const { user, isAuthenticated, logout } = useAuth();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const handleNavigate = useCallback(
    (target: 'home' | 'creation' | 'assets' | 'prompts' | { name: 'auth'; mode: 'login' }) => {
      onNavigate(target);
      setDrawerOpen(false);
    },
    [onNavigate],
  );

  const handleLogout = useCallback(async () => {
    await logout();
    onNavigate({ name: 'auth', mode: 'login' });
  }, [logout, onNavigate]);

  // antd Menu 导航项（不含换肤/语言 — 桌面端标题栏已有独立按钮）
  const menuItems: MenuProps['items'] = [
    { key: 'creation', icon: <Sparkles size={16} />, label: '剧创' },
    { key: 'home', icon: <LayoutGrid size={16} />, label: t('nav.canvas') },
    { key: 'assets', icon: <ImageIcon size={16} />, label: t('nav.assets') },
    { key: 'prompts', icon: <FileText size={16} />, label: t('nav.prompts') },
  ];

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    handleNavigate(key as 'home' | 'creation' | 'assets' | 'prompts');
  };

  // 用户菜单状态
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogoutAndClose = useCallback(async () => {
    setUserMenuOpen(false);
    await logout();
    onNavigate({ name: 'auth', mode: 'login' });
  }, [logout, onNavigate]);

  const isDark = theme.mode === 'dark';

  return (<>
      <style>{`
        /* Menu 透明背景及颜色覆盖(TopNav 作用域) */
        .zeroexo-topnav .ant-menu-horizontal {
          background: transparent !important;
          border-bottom: none !important;
        }
        .zeroexo-topnav .ant-menu-horizontal > .ant-menu-item {
          background: transparent !important;
          color: ${theme.toolbar.textMuted} !important;
          height: 45px !important;
          line-height: 45px !important;
        }
        .zeroexo-topnav .ant-menu-horizontal > .ant-menu-item:hover {
          color: ${theme.toolbar.text} !important;
        }
        .zeroexo-topnav .ant-menu-horizontal > .ant-menu-item-selected {
          color: ${theme.toolbar.text} !important;
        }
        .zeroexo-topnav .ant-menu-horizontal > .ant-menu-item-selected::after,
        .zeroexo-topnav .ant-menu-horizontal > .ant-menu-submenu-selected::after {
          border-bottom-color: ${theme.toolbar.accent} !important;
        }

        /* HOVER 时底部线条变红(比正式选中透明度更高,线条更浅) */
        .zeroexo-topnav .ant-menu-horizontal > .ant-menu-item:hover::after {
          border-bottom-color: ${theme.toolbar.accent} !important;
          opacity: 0.25;
        }

        /* Dropdown/Popover 弹出层背景颜色(全局,因为 antd 渲染在 body 层) */
        .ant-dropdown .ant-dropdown-menu,
        .ant-popover .ant-popover-inner {
          background: ${isDark ? theme.canvas.background : '#ffffff'} !important;
        }

        /* 抽屉内 Inline Menu 背景透明(继承抽屉背景色) */
        .ant-drawer-body .ant-menu-inline {
          background: transparent !important;
        }
      `}</style>
      <header className="zeroexo-topnav" style={headerStyle(theme)}>
        <div style={innerStyle}>
          <div style={leftSectionStyle}>
            {/* LOGO - div 无按钮效果 */}
            <Tooltip title={t('nav.canvas')}>
              <div
                onClick={() => handleNavigate('home')}
                style={brandStyle(theme)}
              >
                <LogoIcon size={28} style={logoStyle} />
                <span style={brandTextStyle(theme)}>{t('nav.brand')}</span>
              </div>
            </Tooltip>
          </div>

          <div style={rightSectionStyle}>
            {/* 导航菜单 - 移到右侧 */}
            {!isMobile && (
              <AntdMenu
                mode="horizontal"
                selectedKeys={[activeRoute]}
                items={menuItems}
                onClick={handleMenuClick}
                style={menuStyle}
              />
            )}

            {/* GitHub 按钮 */}
            <Button
              type="text"
              icon={<Github size={16} />}
              href="https://github.com/RenderTool/zeroexo-platform-infinite-canvas"
              target="_blank"
              rel="noopener noreferrer"
              style={iconBtnInHeader}
            />

            {/* 语言切换 */}
            <LanguageSwitcher theme={theme} />

            {/* 换肤按钮 */}
            <Button
              type="text"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2"/><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/><path d="M16 12a4 4 0 0 0-4-4"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/></svg>
              }
              onClick={() => setAppearanceOpen(true)}
              style={iconBtnInHeader}
            />

            {isMobile ? (
              <Button
                type="text"
                icon={<Menu size={20} />}
                onClick={() => setDrawerOpen(true)}
                aria-label={t('nav.menu')}
                style={iconBtnInHeader}
              />
            ) : isAuthenticated && user ? (
              <Dropdown
                open={userMenuOpen}
                onOpenChange={setUserMenuOpen}
                menu={{
                  items: [
                    { key: 'logout', label: t('auth.logout'), icon: <LogOut size={14} />, danger: true, onClick: handleLogoutAndClose },
                  ],
                }}
              >
                <Button type="text" style={userBtnStyle}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.text }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path key="body" d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                      <circle key="head" cx="12" cy="7" r="4"/>
                    </svg>
                  </span>
                </Button>
              </Dropdown>
            ) : (
              <Button
                type="default"
                size="small"
                icon={<LogIn size={14} />}
                onClick={() => handleNavigate({ name: 'auth', mode: 'login' })}
              >
                {t('auth.login')}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* 移动端抽屉 */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: theme.toolbar.text }}>
            <LogoIcon size={24} />
            <span style={{ fontSize: 16, fontWeight: 200, letterSpacing: '-0.02em' }}>
              {t('nav.brand')}
            </span>
          </div>
        }
        closable={false}
        extra={
          <Button type="text" icon={<X size={18} />} onClick={() => setDrawerOpen(false)} />
        }
        placement="left"
        size={300}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{
          body: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            gap: 0,
            padding: 0,
            background: theme.toolbar.background,
          },
          header: {
            background: theme.toolbar.background,
            borderBottom: `1px solid ${theme.toolbar.border}`,
          },
        }}>
        <style>{`
          .zeroexo-topnav-drawer-items .ant-menu-item {
            height: 36px !important;
            line-height: 36px !important;
            border-radius: 6px !important;
            margin: 2px 8px !important;
            padding-inline: 14px !important;
            font-size: 13px !important;
          }
          .zeroexo-topnav-drawer-items .ant-menu-item .ant-menu-item-icon {
            font-size: 14px !important;
            margin-inline-end: 6px !important;
          }
          .zeroexo-topnav-drawer-items .ant-menu-item-divider {
            margin: 4px 8px !important;
          }
        `}</style>
        <AntdMenu
          mode="inline"
          className="zeroexo-topnav-drawer-items"
          selectedKeys={[activeRoute]}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderInlineEnd: 'none', background: 'transparent' }}
        />

        <div style={{ flex: 1 }} />

        <div style={{ borderTop: `1px solid ${theme.toolbar.border}` }}>
          <Button
            type="text"
            size="large"
            icon={isAuthenticated ? <LogOut size={18} /> : <LogIn size={18} />}
            onClick={isAuthenticated ? handleLogout : () => handleNavigate({ name: 'auth', mode: 'login' })}
            style={drawerFooterBtnStyle}
            block
          >
            {isAuthenticated ? t('auth.logout') : t('auth.login')}
          </Button>
        </div>
      </Drawer>

      {appearanceOpen ? (
        <AppearanceDialog
          theme={theme}
          currentMode={mode}
          onClose={() => setAppearanceOpen(false)}
        />
      ) : null}
    </>
  );
}

// ===== 样式 =====

function headerStyle(theme: { toolbar: { background: string; border: string } }): CSSProperties {
  return {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    height: 45,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    background: theme.toolbar.background + 'cc',
    borderBottom: `1px solid ${theme.toolbar.border}`,
    backdropFilter: 'blur(16px) saturate(180%)',
    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
    padding: '0 24px',
  };
}

const innerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  height: '100%',
  gap: 16,
};

const leftSectionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
  height: '100%',
};

const rightSectionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  justifyContent: 'flex-end',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const menuStyle: CSSProperties = {
  borderBottom: 'none',
  background: 'transparent',
  height: 45,
  lineHeight: '45px',
  marginLeft: 8,
  marginRight: 8,
};

/** LOGO - div,无按钮样式 */
function brandStyle(theme: { toolbar: { text: string } }): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    height: 45,
    userSelect: 'none',
    color: theme.toolbar.text,
  };
}

const logoStyle: CSSProperties = {
  flexShrink: 0,
};

/** 顶部栏图标按钮统一尺寸(32x32,水平居中) */
const iconBtnInHeader: CSSProperties = {
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  fontSize: 16,
};

function brandTextStyle(theme: { toolbar: { text: string } }): CSSProperties {
  return {
    color: theme.toolbar.text,
    fontSize: 16,
    fontWeight: 200,
    letterSpacing: '-0.02em',
  };
}

const userBtnStyle: CSSProperties = {
  height: 36,
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px',
  borderRadius: 8,
};

const drawerFooterBtnStyle: CSSProperties = {
  height: 44,
  borderRadius: 8,
};
