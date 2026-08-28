/**
 * CanvasMenu - 画布左上角 Logo 下拉菜单
 *
 * 点击 Logo 弹出下拉列表:
 * ① 回到主页
 * ② 创建新项目
 * ③ 拷贝项目(拷贝当前画布副本并打开)
 * ④ 删除本画布
 * ⑤ 文档(即将上线占位) ⑥ 快捷键弹窗(征集 #87 验收轮三:自顶栏独立按钮收入)
 *
 * 使用共享 Dropdown 组件,与红色加号列表样式统一。
 */

import { useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Home, Plus, Copy, Trash2, LogOut, User, BookOpen, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import { useAuth } from '../../auth/auth-store.js';
import { LogoIcon } from '@/assets/ico/index.js';
import { useReadOnly } from '@/shared/readonly-context.js';
import { ShortcutsDialog } from '@/shared/components/index.js';
import type { ShortcutEntry } from '@zeroexo/plugin-keyboard';

export interface CanvasMenuProps {
  theme: ThemeConfig;
  onHome: () => void;
  onNewProject: () => void;
  onCopyProject: () => void;
  onDeleteProject: () => void;
  /** 快捷键注册表(征集 #87 验收轮三:快捷键入口收入本下拉后透传给弹窗) */
  keyboardShortcuts?: readonly ShortcutEntry[];
}

export function CanvasMenu({
  theme,
  onHome,
  onNewProject,
  onCopyProject,
  onDeleteProject,
  keyboardShortcuts,
}: CanvasMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const { user, isAuthenticated, logout } = useAuth();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
    // 只读隐藏拷贝/删除（2026-08-25 系统性只读防护）：拷贝项目=创建副本、删除=销毁画布，均属项目级写操作
    ...(!readOnly
      ? [
          { key: 'copy', label: t('menu.copyProject'), icon: <Copy size={14} />, onClick: handleCopy },
          { key: 'delete', label: t('menu.deleteCanvas'), icon: <Trash2 size={14} />, danger: true, onClick: handleDelete },
        ]
      : []),
    // 征集 #87 验收轮三:文档/快捷键自顶栏独立按钮收入本下拉(浏览类入口,只读也可见)
    { key: 'docs', label: t('topbar.docsComingSoon'), icon: <BookOpen size={14} />, onClick: () => { setOpen(false); } },
    { key: 'shortcuts', label: t('menu.shortcuts'), icon: <Keyboard size={14} />, onClick: () => { setOpen(false); setShortcutsOpen(true); } },
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
    <>
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
            <LogoIcon size={30} />
          </button>
        </Tooltip>
      </Dropdown>
      {/* 快捷键弹窗(征集 #87 验收轮三:入口自顶栏收入 LOGO 下拉) */}
      {shortcutsOpen ? (
        <ShortcutsDialog
          theme={theme}
          onClose={() => setShortcutsOpen(false)}
          shortcuts={keyboardShortcuts}
        />
      ) : null}
    </>
  );
}

function logoBtnStyle(theme: ThemeConfig): CSSProperties {
  return {
    display: 'grid',
    placeItems: 'center',
    // 征集 #87 验收轮二十二:与主页 AppSidebar LOGO 同款(36×36 圆角 10,图标 30)
    width: 36,
    height: 36,
    borderRadius: 10,
    border: 'none',
    background: 'transparent',
    color: theme.toolbar.text,
    cursor: 'pointer',
    transition: 'background 0.15s',
  };
}
