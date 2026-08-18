/**
 * 自研轻量 Modal(零 antd 依赖)
 * 基于 createPortal,支持 ESC 关闭 + 遮罩点击关闭
 * 样式硬编码暗色主题,Phase 8 收敛到 ThemeConfig token
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  width = 520,
  children,
  footer,
}: ModalProps): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: `${width}px`,
          maxWidth: '90vw',
          maxHeight: '90vh',
          background: '#1e1e2e',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          color: '#e0e0f0',
        }}
      >
        {title && (
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {title}
          </div>
        )}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 自研按钮(变体: default/primary/danger) */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger';
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'default',
  size = 'md',
  style,
  ...rest
}: ButtonProps): React.ReactElement {
  const base: React.CSSProperties = {
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: size === 'sm' ? 12 : 14,
    padding: size === 'sm' ? '4px 10px' : '6px 14px',
    transition: 'opacity 0.15s',
  };
  const variants: Record<string, React.CSSProperties> = {
    default: { background: 'rgba(255,255,255,0.08)', color: '#e0e0f0' },
    primary: { background: '#e94560', color: '#fff' },
    danger: { background: '#ff6b6b', color: '#fff' },
  };
  return <button style={{ ...base, ...variants[variant], ...style }} {...rest} />;
}
