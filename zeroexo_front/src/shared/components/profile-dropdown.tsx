/**
 * ProfileDropdown - 用户账户菜单（换肤同款 Modal）
 *
 * 特性: 头像按钮触发器 + 点击打开 antd Modal（居中弹窗，与 AppearanceDialog 风格一致）
 * 分组之间使用短虚线分割。
 * 包含：政策公告、退出登录
 */

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';

// ===== SVG 图标(内联,零外部依赖) =====

function HelpIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function LogoutIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ===== 类型 =====

export interface ProfileDropdownUser {
  username?: string;
  nickname?: string;
}

export interface ProfileDropdownProps {
  user?: ProfileDropdownUser | null;
  onHelp?: () => void;
  onLogout?: () => void;
  onNavigate?: (path: string) => void;
}

// ===== 样式常量 =====

const dashedDividerStyle: CSSProperties = {
  width: 32,
  height: 0,
  border: 'none',
  borderTop: `1px dashed currentColor`,
  opacity: 0.2,
  margin: '8px 0',
};

const menuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  width: '100%',
  padding: '9px 11px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
  transition: 'background 0.12s',
  outline: 'none',
};

const menuItemIconStyle: CSSProperties = {
  width: 16,
  height: 16,
  flexShrink: 0,
};

// ===== 组件 =====

export function ProfileDropdown({
  onHelp,
  onLogout,
}: ProfileDropdownProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);

  const isDark = theme.mode === 'dark';

  const handleHelp = () => {
    setOpen(false);
    onHelp?.();
  };

  const handleLogout = () => {
    setOpen(false);
    onLogout?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 9999,
          padding: '4px 10px 4px 4px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'background 0.15s, border-color 0.15s',
          color: theme.toolbar.text,
          outline: 'none',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.toolbar.background;
          e.currentTarget.style.borderColor = theme.toolbar.border;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.borderColor = 'transparent';
        }}
      >
        <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.text }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </span>
      </button>

      <Modal
        open={open}
        title={t('profileDropdown.account')}
        centered
        onCancel={() => setOpen(false)}
        footer={null}
        width={360}
        destroyOnHidden
      >
        {/* 帮助与反馈 */}
        <button
          type="button"
          style={{ ...menuItemStyle, color: theme.toolbar.text }}
          onClick={handleHelp}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f8fafc';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
          }}
        >
          <span style={{ ...menuItemIconStyle, color: theme.toolbar.textMuted }}><HelpIcon /></span>
          {t('profileDropdown.policyAnnouncement')}
        </button>

        {/* 短虚线分割线 */}
        <hr style={{ ...dashedDividerStyle, color: theme.toolbar.textMuted }} />

        {/* 退出登录 */}
        <button
          type="button"
          style={{ ...menuItemStyle, color: theme.toolbar.danger }}
          onClick={handleLogout}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDark ? 'rgba(255,107,107,0.1)' : '#fef2f2';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none';
          }}
        >
          <span style={{ ...menuItemIconStyle, color: theme.toolbar.danger }}><LogoutIcon /></span>
          {t('auth.logout')}
        </button>
      </Modal>
    </>
  );
}