/**
 * StackCollectToast - 收纳提示胶囊(画布锚定,非打扰式)
 *
 * 连线自动收纳后在堆叠节点顶部中央上方显示,带「移除」可撤销,5 秒自动淡出。
 * hover 暂停倒计时;同节点新收纳时重置计时并更新文案。
 * 通过 portal 渲染到 body(fixed 定位),依据 viewport 世界→屏幕换算锚定,
 * 视觉尺寸恒定,不随画布缩放,不受节点容器 overflow 裁剪。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut } from 'lucide-react';
import type { NodeRecord } from '@zeroexo/core';
import { useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';

/** 自动淡出延时(毫秒) */
const AUTO_DISMISS_MS = 5000;
/** 淡出动画时长(毫秒) */
const FADE_MS = 300;

export interface StackCollectToastProps {
  store: ReactGraphStore;
  /** 锚定的堆叠节点(跟随其世界位置) */
  node: NodeRecord;
  /** 文案,如「已收纳 · 图片」 */
  label: string;
  /** 点击「移出」把刚收纳的卡片解绑为独立节点(与胶囊 eject 行为一致) */
  onRemove: () => void;
  /** 完全消失后回调(清理快照) */
  onDismissed: () => void;
}

export function StackCollectToast({
  store,
  node,
  label,
  onRemove,
  onDismissed,
}: StackCollectToastProps): React.ReactElement | null {
  const viewport = useViewport(store);
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef(false);

  // label 变化(新收纳)重置计时
  useEffect(() => {
    setFading(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFading(true), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [label]);

  // 淡出动画结束后通知父级清理
  useEffect(() => {
    if (!fading || dismissedRef.current) return;
    fadeTimerRef.current = setTimeout(() => onDismissed(), FADE_MS);
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [fading, onDismissed]);

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  // hover 暂停倒计时,移出后重启
  const handleMouseEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setFading(false);
  };
  const handleMouseLeave = () => {
    if (timerRef.current || dismissedRef.current) return;
    timerRef.current = setTimeout(() => setFading(true), AUTO_DISMISS_MS);
  };

  const handleRemove = () => {
    dismissedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    onRemove();
    onDismissed();
  };

  // 世界坐标 → 屏幕坐标:节点顶部中央上方
  const cx = (node.position.x + (node.size?.width ?? 620) / 2) * viewport.k + viewport.x;
  const cy = node.position.y * viewport.k + viewport.y;

  return createPortal(
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'fixed',
        left: cx,
        top: cy,
        transform: 'translate(-50%, calc(-100% - 6px))',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 10px 5px 12px',
        borderRadius: 999,
        backgroundColor: 'rgba(28, 25, 23, 0.92)',
        color: '#fff',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
        zIndex: 1000,
        userSelect: 'none',
        opacity: fading && !dismissedRef.current ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        pointerEvents: 'auto',
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        title="移出为独立节点"
        onClick={handleRemove}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-primary, #e94560)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <LogOut size={12} />
        移出
      </button>
    </div>,
    document.body,
  );
}
