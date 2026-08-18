/**
 * Modal - 通用对话框(自研,零 antd 依赖)
 *
 * 特性: createPortal + 点击遮罩关闭 + ESC 关闭 + 居中
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  footer?: ReactNode;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  theme: ThemeConfig;
  /** 移动端全屏铺满(四周留 12px 一致留白,顶到底部) */
  fullScreenOnMobile?: boolean;
  /** 自定义 z-index(默认 1000;全屏模式等需要更高层级时传入) */
  zIndex?: number;
}

export function Modal({
  open,
  title,
  footer,
  width = 520,
  onClose,
  children,
  theme,
  fullScreenOnMobile = false,
  zIndex = 1000,
}: ModalProps): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // 移动端全屏模式:四周 12px 一致留白,顶到底部
  const isMobileFullScreen = fullScreenOnMobile && window.innerWidth <= 768;

  const overlayStyle: CSSProperties = isMobileFullScreen
    ? {
        position: 'fixed',
        inset: 0,
        zIndex,
        display: 'grid',
        padding: 12,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
      }
    : {
        position: 'fixed',
        inset: 0,
        zIndex,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
      };

  const modalStyle: CSSProperties = isMobileFullScreen
    ? {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: theme.node.contentBackground,
        border: `1px solid ${theme.toolbar.border}`,
        borderRadius: 12,
        color: theme.toolbar.text,
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }
    : {
        width: Math.min(width, window.innerWidth - 48),
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        background: theme.node.contentBackground,
        border: `1px solid ${theme.toolbar.border}`,
        borderRadius: 12,
        color: theme.toolbar.text,
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        overflow: 'hidden',
      };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 20px',
    borderBottom: `1px solid ${theme.toolbar.border}`,
    fontSize: 15,
    fontWeight: 600,
    color: theme.toolbar.text,
  };

  const closeBtnStyle: CSSProperties = {
    width: 28,
    height: 28,
    border: 'none',
    background: 'transparent',
    color: theme.toolbar.textMuted,
    cursor: 'pointer',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  const modalBodyStyle: CSSProperties = isMobileFullScreen
    ? {
        padding: 12,
        overflowY: 'auto',
        flex: 1,
      }
    : {
        padding: 20,
        overflowY: 'auto',
        flex: 1,
      };

  const footerStyle: CSSProperties = {
    padding: '12px 20px',
    borderTop: `1px solid ${theme.toolbar.border}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  };

  return createPortal(
    <div
      style={overlayStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={modalStyle} role="dialog" aria-modal="true">
        {title ? (
          <div style={headerStyle}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
            <button
              type="button"
              style={closeBtnStyle}
              onClick={onClose}
              aria-label="关闭"
              className="zeroexo-icon-btn"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        <div style={modalBodyStyle}>{children}</div>
        {footer ? <div style={footerStyle}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
