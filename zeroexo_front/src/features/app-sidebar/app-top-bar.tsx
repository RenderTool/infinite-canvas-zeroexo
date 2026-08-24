/**
 * AppTopBar - 应用顶部栏(桌面端)
 *
 * ⚠️ 重要职责分离:
 * - AppTopBar 仅承载**功能按钮**(更新日志 / GitHub / 语言切换 / 换肤 / 同步 / 用户菜单)
 * - 导航菜单(主页 / 创作 / 画布 / 资产)由 AppSidebar 渲染,绝对不要放在这里
 *
 * 桌面端:
 * - 浮在右上角(由 AppLayout.floatingHeaderStyle 控制)
 * - 不显示导航菜单,只显示功能按钮
 *
 * 移动端:
 * - 不渲染(由 AppLayout 注入的统一 MobileNavButton 替代)
 * - 移动端导航按钮在右上角(MobileNavFloatingWrapper 控制)
 *
 * 设计原则:
 * - 桌面端: 悬浮显示,内容由 features/app-sidebar/AppTopBar 负责
 * - 移动端: 不渲染(避免与 AppLayout 注入的统一移动端导航重复)
 */

import { useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, LogIn, FileText } from 'lucide-react';
import { Button, Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useAuth } from '@/features/auth/auth-store.js';
import { LanguageSwitcher } from '@/shared/components/language-switcher.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { ProfileDropdown } from '@/shared/components/index.js';

export interface AppTopBarProps {
  onNavigate: (route: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies' | { name: 'auth'; mode: 'login' }) => void;
  activeRoute?: string;
  /** 是否由外部控制"打开换肤"弹窗状态(由 app.tsx 接管) */
  onRequestAppearance?: () => void;
  /** 打开更新日志 */
  onRequestChangelog?: () => void;
}

export function AppTopBar({
  onNavigate,
  onRequestAppearance,
  onRequestChangelog,
}: AppTopBarProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { user, isAuthenticated, logout } = useAuth();
  const isMobile = useIsMobile();

  const handleLogout = useCallback(async () => {
    await logout();
    onNavigate({ name: 'auth', mode: 'login' });
  }, [logout, onNavigate]);

  /** 移动端不再渲染本组件(由 AppLayout 的统一 MobileNavButton 替代) */
  if (isMobile) return null;
  const textColor = theme.toolbar.text;

  return (
    <>
    <header style={headerStyle}>
      <div style={innerStyle}>
        <div style={rightSectionStyle}>
          {/* 更新日志 */}
          <Tooltip title="更新日志">
            <Button
              type="text"
              icon={<FileText size={16} />}
              onClick={() => onRequestChangelog?.()}
              className="zeroexo-icon-btn"
              style={iconBtnStyle(textColor)}
            />
          </Tooltip>

          {/* GitHub */}
          <Tooltip title="GitHub">
            <Button
              type="text"
              icon={<Github size={16} />}
              href="https://github.com/RenderTool/zeroexo-platform-infinite-canvas"
              target="_blank"
              rel="noopener noreferrer"
              className="zeroexo-icon-btn"
              style={iconBtnStyle(textColor)}
            />
          </Tooltip>

          {/* 语言切换 */}
          <LanguageSwitcher theme={theme} />

          {/* 换肤 */}
          <Tooltip title="外观设置">
            <Button
              type="text"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2"/><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/><path d="M16 12a4 4 0 0 0-4-4"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/></svg>
              }
              onClick={() => onRequestAppearance?.()}
              className="zeroexo-icon-btn"
              style={iconBtnStyle(textColor)}
            />
          </Tooltip>

          {/* 用户菜单 */}
          {isAuthenticated && user ? (
            <ProfileDropdown
              user={user}
              onHelp={() => { window.location.hash = '#/legal/policies'; }}
              onLogout={handleLogout}
              onNavigate={(path) => console.log('navigate to', path)}
            />
          ) : (
            <Tooltip title={t('auth.login')}>
              <Button
                type="text"
                icon={<LogIn size={16} />}
                onClick={() => onNavigate({ name: 'auth', mode: 'login' })}
                className="zeroexo-icon-btn"
                style={iconBtnStyle(textColor)}
              />
            </Tooltip>
          )}
        </div>
      </div>
    </header>
    </>
  );
}

// ===== 样式 =====

const headerStyle: CSSProperties = {
  height: 'auto',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  pointerEvents: 'auto',
};

const innerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  height: '100%',
};

const rightSectionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  justifyContent: 'flex-end',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '8px 12px',
  borderRadius: 12,
  background: 'transparent',
  border: 'none',
};

function iconBtnStyle(color: string): CSSProperties {
  return {
    width: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    fontSize: 16,
    color,
  };
}
