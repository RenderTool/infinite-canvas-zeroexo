/**
 * Tooltip - 悬浮提示(自研,零 antd 依赖)
 *
 * 特性: hover 显示 + 延迟 300ms + 上方定位
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';

export interface TooltipProps {
  title: ReactNode;
  theme: ThemeConfig;
  children: ReactNode;
  placement?: 'top' | 'bottom';
}

export function Tooltip({
  title,
  theme,
  children,
  placement = 'top',
}: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), 300);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const containerStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
  };

  const tipStyle: CSSProperties = {
    position: 'absolute',
    [placement]: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: placement === 'top' ? -6 : 6,
    marginBottom: placement === 'top' ? 0 : 6,
    padding: '4px 8px',
    background: theme.toolbar.text,
    color: theme.node.contentBackground,
    borderRadius: 6,
    fontSize: 11,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    zIndex: 9999,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  };

  return (
    <span
      style={containerStyle}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible ? <span style={tipStyle}>{title}</span> : null}
    </span>
  );
}
