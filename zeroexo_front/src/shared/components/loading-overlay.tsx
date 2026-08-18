/**
 * LoadingOverlay - 加载动画覆盖层
 *
 * 默认全屏 fixed 定位，覆盖整个页面，仅显示 LOGO 脉冲动画。
 * inline 模式（position: absolute）适用于在容器内显示加载动画。
 * 适用于编辑器、首页、资产库等需要加载的场景。
 * 主题色由 CSS 变量 --zeroexo-text-color 驱动，自动适配主题。
 */

import React from 'react';
import { LogoIcon } from '@/assets/ico/index.js';

export interface LoadingOverlayProps {
  /** 背景色，默认使用 theme.canvas.background，不传时使用透明 */
  background?: string;
  /** LOGO 尺寸，默认 80 */
  logoSize?: number;
  /** 是否为内联模式（position: absolute 填充父容器），默认 false（position: fixed 全屏） */
  inline?: boolean;
  /** 返回主页回调，传入后在左上角显示返回主页按钮 */
  onBackToHome?: () => void;
}

export function LoadingOverlay({ background, logoSize = 80, inline = false, onBackToHome }: LoadingOverlayProps): React.ReactElement {
  const positionStyle: React.CSSProperties = inline
    ? { position: 'absolute', inset: 0 }
    : { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 };

  return (
    <div style={{
      ...positionStyle,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: background ?? 'var(--zeroexo-canvas-bg, #1a1a2e)',
      zIndex: 9999,
    }}>
      {onBackToHome && (
        <button
          onClick={onBackToHome}
          style={{
            position: 'absolute',
            top: 16,
            left: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            background: 'rgba(0,0,0,0.3)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 13,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
            (e.currentTarget as HTMLButtonElement).style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.3)';
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.7)';
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          返回主页
        </button>
      )}
      <style>{`
        @keyframes logoPulse {
          0%, 100% { opacity: 0.4; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
      <div style={{
        animation: 'logoPulse 2s ease-in-out infinite',
        color: 'var(--zeroexo-text-color, currentColor)',
      }}>
        <LogoIcon size={logoSize} />
      </div>
    </div>
  );
}