import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';

export interface MobileDrawerWrapperProps {
  open: boolean;
  children: ReactNode;
  zIndex?: number;
}

export function MobileDrawerWrapper({
  open,
  children,
  zIndex = 999,
}: MobileDrawerWrapperProps): React.ReactElement {
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MobileDrawerOverlayProps {
  open: boolean;
  onClick: () => void;
  /** 可选样式覆盖（如更淡的遮罩背景），默认值不变 */
  style?: CSSProperties;
}

export function MobileDrawerOverlay({
  open,
  onClick,
  style,
}: MobileDrawerOverlayProps): React.ReactElement {
  return (
    <div
      onClick={onClick}
      className="fixed inset-0 z-[998] bg-black/45 transition-opacity duration-300 ease-in-out"
      style={{
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        ...style,
      }}
    />
  );
}

export interface MobileDrawerPanelProps {
  open: boolean;
  children: ReactNode;
  style?: CSSProperties;
}

export function MobileDrawerPanel({
  open,
  children,
  style,
}: MobileDrawerPanelProps): React.ReactElement {
  return (
    <div
      className="fixed top-0 right-0 w-[320px] max-w-[85vw] h-full z-[999] flex flex-col shadow-[-8px_0_30px_rgba(0,0,0,0.12)] transition-transform duration-[0.35s] ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        ...style,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}