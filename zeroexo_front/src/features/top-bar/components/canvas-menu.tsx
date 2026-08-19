/**
 * CanvasMenu - 画布左上角 Logo 下拉菜单
 *
 * 点击 Logo 弹出下拉列表:
 * ① 回到主页
 * ② 创建新项目
 * ③ 拷贝项目(拷贝当前画布副本并打开)
 * ④ 删除本画布
 *
 * 使用共享 Dropdown 组件,与红色加号列表样式统一。
 */

import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Home, Plus, Copy, Trash2, LogOut, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import { useAuth } from '../../auth/auth-store.js';
import { LogoIcon } from '@/assets/ico/index.js';

export interface CanvasMenuProps {
  theme: ThemeConfig;
  onHome: () => void;
  onNewProject: () => void;
  onCopyProject: () => void;
  onDeleteProject: () => void;
}

export function CanvasMenu({
  theme,
  onHome,
  onNewProject,
  onCopyProject,
  onDeleteProject,
}: CanvasMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const { user, isAuthenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const handleHome = useCallback(() => { setOpen(false); onHome(); }, [onHome]);
  const handleNew = useCallback(() => { setOpen(false); onNewProject(); }, [onNewProject]);
  const handleCopy = useCallback(() => { setOpen(false); onCopyProject(); }, [onCopyProject]);
  const handleDelete = useCallback(() => { setOpen(false); onDeleteProject(); }, [onDeleteProject]);
  const handleLogout = useCallback(async () => {
    setOpen(false);
    await logout();
  }, [logout]);

  const items: MenuProps['items'] = [
    { key: 'home', label: t('menu.backHome'), icon: <Home size={14} />, onClick: handleHome },
    { key: 'new', label: t('menu.newProject'), icon: <Plus size={14} />, onClick: handleNew },
    { key: 'copy', label: t('menu.copyProject'), icon: <Copy size={14} />, onClick: handleCopy },
    { key: 'delete', label: t('menu.deleteCanvas'), icon: <Trash2 size={14} />, danger: true, onClick: handleDelete },
    // 底部区域: 登录态显示账号信息与退出登录
    ...(isAuthenticated && user
      ? [
          { type: 'divider' as const },
          { key: 'user', label: user.username, icon: <User size={14} />, disabled: true },
          { key: 'logout', label: t('auth.logout'), icon: <LogOut size={14} />, danger: true, onClick: handleLogout },
        ]
      : []),
  ];

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      menu={{ items }}
    >
      <Tooltip title={t('topbar.home')}>
        <button
          type="button"
          aria-label={t('topbar.home')}
          style={logoBtnStyle(theme)}
        >
          <LogoIcon size={28} />
        </button>
      </Tooltip>
    </Dropdown>
  );
}

function logoBtnStyle(theme: ThemeConfig): CSSProperties {
  return {
    display: 'grid',
    placeItems: 'center',
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: theme.toolbar.text,
    cursor: 'pointer',
    transition: 'background 0.15s',
  };
}
