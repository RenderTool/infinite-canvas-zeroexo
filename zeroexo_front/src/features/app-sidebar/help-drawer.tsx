/**
 * HelpDrawer - 帮助与反馈弹窗
 *
 * 从侧边栏底部帮助按钮触发，聚合所有法律政策入口。
 * 帮助与反馈已合并到顶部 GitHub 图标。
 * 包含：政策公告（聚合协议/隐私/声明）、关注我
 */

import { useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Modal } from 'antd';
import {
  QrCode,
  Newspaper,
  ExternalLink,
  Github,
} from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';

export interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}

interface HelpItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  type: 'navigate' | 'external';
  href?: string;
}

const HELP_ITEMS: HelpItem[] = [
  { key: 'policies', label: '政策公告', icon: <Newspaper size={18} />, type: 'navigate' },
  { key: 'follow', label: '关注我们', icon: <QrCode size={18} />, type: 'navigate' },
  { key: 'github', label: '帮助与反馈', icon: <Github size={18} />, type: 'external', href: 'https://github.com' },
];

export function HelpDrawer({ open, onClose, onNavigate }: HelpDrawerProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const handleClick = useCallback((item: HelpItem) => {
    if (item.type === 'external' && item.href) {
      window.open(item.href, '_blank');
    } else if (item.type === 'navigate') {
      onNavigate(item.key);
      onClose();
    }
  }, [onNavigate, onClose]);

  const itemStyle = (theme: any): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    color: theme.toolbar.text,
    fontSize: 13,
    transition: 'all 0.15s',
    border: 'none',
    background: 'transparent',
    width: '100%',
    textAlign: 'left',
    fontFamily: 'inherit',
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={320}
      centered
      destroyOnHidden
      title={null}
      styles={{
        body: {
          padding: '8px 0',
        },
        container: {
          background: isDark ? '#1a1a1a' : '#ffffff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          borderRadius: 12,
          boxShadow: isDark
            ? '0 8px 32px rgba(0,0,0,0.4)'
            : '0 8px 32px rgba(0,0,0,0.1)',
        },
      }}
    >
      <div style={{ padding: '4px 0' }}>
        {/* 标题 */}
        <div style={{
          padding: '4px 16px 12px',
          fontSize: 15,
          fontWeight: 600,
          color: theme.toolbar.text,
          fontFamily: "'Sora', system-ui, sans-serif",
          borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
        }}>
          更多
        </div>

        {/* 菜单项 */}
        <div style={{ padding: '8px' }}>
          {HELP_ITEMS.map((item) => {
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleClick(item)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
                style={itemStyle(theme)}
              >
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  color: theme.toolbar.text,
                  flexShrink: 0,
                }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.type === 'external' && <ExternalLink size={14} style={{ opacity: 0.4 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}