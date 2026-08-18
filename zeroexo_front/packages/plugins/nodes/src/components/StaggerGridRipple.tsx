/**
 * StaggerGridRipple - AI 生成中的动态网格涟漪效果
 *
 * 复刻参考效果:点击/触发时网格点从原点向外扩散涟漪动画。
 * 无 GSAP 依赖,纯 CSS keyframes + React 状态驱动。
 *
 * 状态:
 * - idle: 静态网格点
 * - generating: 持续涟漪动画(从中心向外循环)
 * - error: 红色闪烁
 * - completed: 绿色涟漪收尾
 *
 * fillContainer 模式:铺满父容器,用于占位节点全背景。
 * isDark 控制配色:暗色主题使用深色点,亮色主题使用浅色点。
 */
import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_ROWS = 8;
const DEFAULT_COLS = 14;

interface StaggerGridRippleProps {
  status: 'idle' | 'generating' | 'completed' | 'error';
  accentColor?: string;
  /** 是否暗色主题(影响默认点背景色,默认 true) */
  isDark?: boolean;
  /** 点击网格点时触发(可选,用于交互) */
  onRippleClick?: (index: number) => void;
  /** 铺满父容器(用于占位节点全背景) */
  fillContainer?: boolean;
  /** 自定义网格行列数(默认 8x14) */
  gridSize?: { rows: number; cols: number };
  /** 叠加在涟漪上的内容(文字/按钮等) */
  children?: React.ReactNode;
}

export function StaggerGridRipple({
  status,
  accentColor = '#818cf8',
  isDark = true,
  onRippleClick,
  fillContainer = false,
  gridSize,
  children,
}: StaggerGridRippleProps): React.ReactElement {
  const rows = gridSize?.rows ?? DEFAULT_ROWS;
  const cols = gridSize?.cols ?? DEFAULT_COLS;
  const total = rows * cols;

  const [rippleOrigin, setRippleOrigin] = useState<number | null>(null);
  const [rippleKey, setRippleKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 生成中:从中心持续循环涟漪
  useEffect(() => {
    if (status !== 'generating') return;
    const center = Math.floor(total / 2);
    const interval = setInterval(() => {
      setRippleOrigin(center);
      setRippleKey((k) => k + 1);
    }, 3500);
    setRippleOrigin(center);
    setRippleKey((k) => k + 1);
    return () => clearInterval(interval);
  }, [status, total]);

  // 完成时:从中心触发一次收尾涟漪
  useEffect(() => {
    if (status !== 'completed') return;
    const center = Math.floor(total / 2);
    setRippleOrigin(center);
    setRippleKey((k) => k + 1);
  }, [status, total]);

  // 错误时:从中心触发一次红色涟漪
  useEffect(() => {
    if (status !== 'error') return;
    const center = Math.floor(total / 2);
    setRippleOrigin(center);
    setRippleKey((k) => k + 1);
  }, [status, total]);

  const handleDotClick = useCallback((index: number) => {
    setRippleOrigin(index);
    setRippleKey((k) => k + 1);
    onRippleClick?.(index);
  }, [onRippleClick]);

  const dotGap = fillContainer ? 2 : 4;

  // 主题配色：浅色主题使用补色使涟漪更清晰
  const dotBg = isDark ? '#2a3354' : `${accentColor}40`; // 浅色: 主题色半透明
  const dotBgError = isDark ? '#3a1a1a' : '#fee2e2';
  const dotBgGenerating = isDark ? '#2a3354' : `${accentColor}20`; // 浅色: 主题色低透明度
  const containerBg = fillContainer ? 'transparent' : (isDark ? 'rgba(255,255,255,0.03)' : `${accentColor}08`);
  const containerBorder = fillContainer ? 'none' : `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : `${accentColor}20`}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <style>{`
        @keyframes zx-sgr-ripple {
          0% { transform: scale(1); background-color: var(--sgr-bg); }
          15% { transform: scale(2.2); background-color: var(--sgr-primary); }
          35% { transform: scale(0.6); background-color: var(--sgr-secondary); }
          100% { transform: scale(1); background-color: var(--sgr-bg); }
        }
        @keyframes zx-sgr-error-ripple {
          0% { transform: scale(1); background-color: var(--sgr-bg); }
          15% { transform: scale(2.2); background-color: #ef4444; }
          35% { transform: scale(0.6); background-color: #f87171; }
          100% { transform: scale(1); background-color: var(--sgr-bg); }
        }
        @keyframes zx-sgr-complete-ripple {
          0% { transform: scale(1); background-color: var(--sgr-bg); }
          15% { transform: scale(2.2); background-color: #22d3ee; }
          35% { transform: scale(0.6); background-color: #2dd4bf; }
          100% { transform: scale(1); background-color: var(--sgr-bg); }
        }
        @keyframes zx-sgr-idle-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .sgr-dot {
          border-radius: 50%;
          cursor: default;
          will-change: transform, background-color;
          transition: transform 0.15s, background-color 0.15s;
        }
        .sgr-dot:hover {
          transform: scale(1.3);
        }
        .sgr-dot.idle {
          animation: zx-sgr-idle-pulse 2s ease-in-out infinite;
        }
      `}</style>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div
          ref={containerRef}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, ${fillContainer ? '1fr' : '12px'})`,
            gap: dotGap,
            padding: fillContainer ? '0' : '14px 16px',
            borderRadius: fillContainer ? 0 : 14,
            background: containerBg,
            border: containerBorder,
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
          }}
        >
          {Array.from({ length: total }, (_, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            const originRow = rippleOrigin !== null ? Math.floor(rippleOrigin / cols) : -1;
            const originCol = rippleOrigin !== null ? rippleOrigin % cols : -1;
            const dist = rippleOrigin !== null
              ? Math.sqrt((row - originRow) ** 2 + (col - originCol) ** 2)
              : 0;
            const delay = dist * 0.035;

            let animName = 'none';
            if (rippleOrigin !== null) {
              if (status === 'error') {
                animName = 'zx-sgr-error-ripple';
              } else if (status === 'completed') {
                animName = 'zx-sgr-complete-ripple';
              } else {
                animName = 'zx-sgr-ripple';
              }
            }

            const isGenerating = status === 'generating';
            const bgColor = isGenerating ? dotBgGenerating : (status === 'error' ? dotBgError : dotBg);

            return (
              <div
                key={`${rippleKey}-${i}`}
                className={`sgr-dot ${rippleOrigin === null ? 'idle' : ''}`}
                onClick={() => handleDotClick(i)}
                style={{
                  '--sgr-bg': bgColor,
                  '--sgr-primary': status === 'error' ? '#ef4444' : accentColor,
                  '--sgr-secondary': status === 'error' ? '#f87171' : (isDark ? '#22d3ee' : '#6366f1'),
                  animation: rippleOrigin !== null
                    ? `${animName} 0.9s ${delay}s cubic-bezier(0.23, 1, 0.32, 1) both`
                    : (isGenerating ? 'zx-sgr-idle-pulse 2s ease-in-out infinite' : 'none'),
                  background: bgColor,
                  width: fillContainer ? '100%' : '12px',
                  height: fillContainer ? '100%' : '12px',
                  aspectRatio: fillContainer ? '1' : undefined,
                  minWidth: fillContainer ? '2px' : undefined,
                  minHeight: fillContainer ? '2px' : undefined,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
        {/* 叠加层:文字/按钮渲染在涟漪之上 */}
        {children && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 1,
          }}>
            <div style={{ pointerEvents: 'auto' }}>
              {children}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}