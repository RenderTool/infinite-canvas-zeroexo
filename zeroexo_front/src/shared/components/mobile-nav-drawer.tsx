/**
 * MobileNavDrawer - 移动端导航抽屉(统一标准 UI 框架)
 *
 * 设计规范(严格执行):
 * 1. 布局分为 3 个固定区域:
 *    [Header] LOGO + 品牌标题 (固定)
 *    [Nav]    可变导航区 (唯一允许外部注入的区域)
 *    [Footer] 登录/登出区 (固定样式, 不带头像和昵称)
 * 2. 除 Nav 分组之间外,全局禁止边框/分割线。
 * 3. 图标尺寸: 18x18, 与文本间距: 12px。
 * 4. 文本与图标垂直居中对齐。
 */

import { useCallback, type ReactNode } from 'react';
import {
  Home,
  Plus,
  Copy,
  Trash2,
  Keyboard,
  Settings2,
  Bot,
  X as XIcon,
  LogIn,
  LogOut,
  Palette,
  Languages,
} from 'lucide-react';
import { Drawer, Button as AntdButton, Menu as AntdMenu } from 'antd';
import type { MenuProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { LogoIcon } from '@/assets/ico/index.js';
import { SidebarAnimatedIcon } from '@/features/app-sidebar/sidebar-animated-icon.js';

/**
 * 统一图标包裹组件——解决 antd Menu 对 Lucide 组件和原生 SVG 处理方式不同导致的间距不一致问题。
 * 所有图标强制包裹在固定尺寸的 <div> 中,确保 antd Menu 始终看到相同的元素类型。
 */
function DrawerIcon(icon: ReactNode): ReactNode {
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      flexShrink: 0,
    }}>
      {icon}
    </div>
  );
}

export interface NavRouteItem {
  key: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies';
  label: string;
  icon?: React.ReactNode;
}

export interface NavProjectAction {
  key: 'home' | 'newProject' | 'copyProject' | 'deleteProject';
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
}

export interface MobileNavDrawerProps {
  theme: ThemeConfig;
  open: boolean;
  onClose: () => void;

  navItems?: NavRouteItem[];
  activeKey?: string;
  onNavigate?: (key: NavRouteItem['key']) => void;

  projectActions?: NavProjectAction[];
  onProjectAction?: (key: NavProjectAction['key']) => void;

  onToggleAgent?: () => void;
  onOpenShortcuts?: () => void;
  onOpenSettings?: () => void;

  /** 设置组固定回调 */
  onOpenAppearance?: () => void;
  onOpenLanguage?: () => void;

  syncNode?: React.ReactNode;

  isAuthenticated?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function MobileNavDrawer({
  theme,
  open,
  onClose,
  navItems,
  activeKey,
  onNavigate,
  projectActions,
  onProjectAction,
  onToggleAgent,
  onOpenShortcuts,
  onOpenSettings,
  onOpenAppearance,
  onOpenLanguage,
  syncNode,
  isAuthenticated,
  onLogin,
  onLogout,
}: MobileNavDrawerProps): React.ReactElement {
  const { t } = useTranslation();
  const textColor = theme.toolbar.text;

  const close = useCallback(() => onClose(), [onClose]);

  const handleNavClick = useCallback(
    (key: string) => {
      onNavigate?.(key as NavRouteItem['key']);
      close();
    },
    [onNavigate, close],
  );

  const handleProjectAction = useCallback(
    (key: string) => {
      onProjectAction?.(key as NavProjectAction['key']);
      close();
    },
    [onProjectAction, close],
  );

  const closeThen = useCallback(
    (cb?: () => void) => {
      close();
      cb?.();
    },
    [close],
  );

  /** ===== 构造 Nav 区 Menu Items ===== */
  const menuItems: MenuProps['items'] = [];

  // 1. 可变导航组
  if (navItems && navItems.length > 0) {
    navItems.forEach((item) => {
      const defaultIcon = defaultNavIcon(item.key);
      menuItems.push({
        key: item.key,
        icon: item.icon ?? defaultIcon,
        label: item.label,
        onClick: () => handleNavClick(item.key),
      });
    });
  } else if (projectActions && projectActions.length > 0) {
    projectActions.forEach((action) => {
      menuItems.push({
        key: action.key,
        icon: action.icon,
        label: action.label,
        danger: action.danger,
        onClick: () => handleProjectAction(action.key),
      });
    });
  }

  // 2. 工具组
  const hasTools = onOpenShortcuts || onOpenSettings || onToggleAgent;
  if (hasTools) {
    if (menuItems.length > 0) menuItems.push({ type: 'divider' });
    if (onOpenShortcuts) menuItems.push({ key: 'shortcuts', icon: DrawerIcon(<Keyboard size={18} />), label: t('menu.shortcuts'), onClick: () => closeThen(onOpenShortcuts) });
    if (onOpenSettings) menuItems.push({ key: 'settings', icon: DrawerIcon(<Settings2 size={18} />), label: t('settings.title'), onClick: () => closeThen(onOpenSettings) });
    if (onToggleAgent) menuItems.push({ key: 'agent', icon: DrawerIcon(<Bot size={18} />), label: t('topbar.toggleAgent'), onClick: () => closeThen(onToggleAgent) });
  }

  // 3. 固定设置组
  if (onOpenAppearance || onOpenLanguage) {
    if (menuItems.length > 0) menuItems.push({ type: 'divider' });
    if (onOpenAppearance) {
      menuItems.push({ key: 'appearance', icon: DrawerIcon(<Palette size={18} />), label: t('topbar.appearance'), onClick: () => closeThen(onOpenAppearance) });
    }
    if (onOpenLanguage) {
      menuItems.push({ key: 'language', icon: DrawerIcon(<Languages size={18} />), label: t('languageDialog.title'), onClick: () => closeThen(onOpenLanguage) });
    }
  }

  return (
    <Drawer
      closable={false}
      placement="left"
      size={280}
      open={open}
      onClose={close}
      styles={{
        body: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: 0,
          background: theme.toolbar.background,
        },
        header: {
          background: theme.toolbar.background,
          padding: '16px 20px',
          margin: 0,
        },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: textColor }}>
          <LogoIcon size={24} />
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em' }}>ZEROEXO</span>
        </div>
      }
      extra={
        <AntdButton
          type="text"
          icon={<XIcon size={18} />}
          onClick={close}
          aria-label={t('common.close')}
          style={{ color: textColor, width: 32, height: 32 }}
        />
      }
    >
      <style>{`
        .zeroexo-nav-drawer-items .ant-menu-item {
          height: 48px !important;
          line-height: 48px !important;
          border-radius: 8px !important;
          margin: 2px 8px !important;
          padding-inline: 14px !important;
          font-size: 14px !important;
          display: flex !important;
          align-items: center !important;
        }
        .zeroexo-nav-drawer-items .ant-menu-item .ant-menu-item-icon {
          margin-inline-end: 12px !important;
          flex-shrink: 0 !important;
        }
        .zeroexo-nav-drawer-items .ant-menu-item .ant-menu-title-content {
          display: inline-flex !important;
          align-items: center !important;
          line-height: 18px !important;
        }
        .zeroexo-nav-drawer-items .ant-menu-item-divider {
          margin: 8px 12px !important;
          border-top: 1px dashed ${theme.toolbar.border} !important;
        }
        .zeroexo-nav-drawer-items .ant-menu-item-selected {
          background: ${theme.toolbar.accent}1A !important;
          color: ${theme.toolbar.accent} !important;
        }
        .zeroexo-nav-drawer-items .ant-menu-item-selected .ant-menu-item-icon {
          color: ${theme.toolbar.accent} !important;
        }
        .zeroexo-nav-drawer-items .ant-menu-item-selected .ant-menu-item-icon > * {
          color: ${theme.toolbar.accent} !important;
        }
      `}</style>
      
      {/* ===== 可变 Nav 区 ===== */}
      <AntdMenu
        mode="inline"
        className="zeroexo-nav-drawer-items"
        selectedKeys={activeKey ? [activeKey] : []}
        items={menuItems}
        style={{ borderInlineEnd: 'none', background: 'transparent', padding: '8px 0' }}
      />

      {/* 同步节点 (可选) */}
      {syncNode && (
        <div style={{ padding: '0 16px' }}>
          {syncNode}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* ===== 固定 Footer 区 (登录/登出) ===== */}
      {isAuthenticated ? (
        <div style={{ padding: '8px 16px 16px' }}>
          <AntdButton
            type="text"
            icon={<LogOut size={18} />}
            onClick={() => closeThen(onLogout)}
            block
            danger
            style={{
              height: 48,
              justifyContent: 'flex-start',
              fontSize: 14,
              borderRadius: 8,
            }}
          >
            {t('auth.logout')}
          </AntdButton>
        </div>
      ) : onLogin ? (
        <div style={{ padding: '8px 16px 16px' }}>
          <AntdButton
            type="text"
            icon={<LogIn size={18} />}
            onClick={() => closeThen(onLogin)}
            block
            style={{
              height: 48,
              justifyContent: 'flex-start',
              color: textColor,
              fontSize: 14,
              borderRadius: 8,
            }}
          >
            {t('auth.login')}
          </AntdButton>
        </div>
      ) : null}
    </Drawer>
  );
}

function defaultNavIcon(key: NavRouteItem['key']): React.ReactNode {
  const icon = (() => {
    switch (key) {
      case 'home':
        return <SidebarAnimatedIcon type="home" size={18} active={false} hovered={false} color="currentColor" mode="inline" />;
      case 'canvas':
        return <SidebarAnimatedIcon type="canvas" size={18} active={false} hovered={false} color="currentColor" mode="inline" />;
      case 'assets':
        return <SidebarAnimatedIcon type="assets" size={18} active={false} hovered={false} color="currentColor" mode="inline" />;
      case 'publicPrompts':
        return <SidebarAnimatedIcon type="publicPrompts" size={18} active={false} hovered={false} color="currentColor" mode="inline" />;
      case 'policies':
        return <SidebarAnimatedIcon type="policies" size={18} active={false} hovered={false} color="currentColor" mode="inline" />;
    }
  })();
  return DrawerIcon(icon);
}

export { Home, Plus, Copy, Trash2 };