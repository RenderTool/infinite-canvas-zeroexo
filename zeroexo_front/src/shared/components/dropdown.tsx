/**
 * Dropdown - 下拉菜单(自研,零 antd 依赖)
 *
 * 特性: 受控 open + 点击外部关闭 + 触发器自定义 + items 配置式
 * 支持自适应定位: 自动检测可用空间,避免溢出屏幕
 * Q弹动画: 弹出 scale(0.85)→1 + 收起 scale(1)→0.85,使用 overshoot 缓动曲线
 * 支持 fixed 定位: 当 fixed=true 时使用 position:fixed 脱离父容器,悬浮在节点之上
 */

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';

export interface DropdownItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

export interface DropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: DropdownItem[];
  trigger: ReactNode;
  theme: ThemeConfig;
  align?: 'left' | 'right';
  width?: number;
  /** 菜单向上展开(触发器在底部时使用) */
  dropUp?: boolean;
  /** 弹出方向: 'bottom'(默认) | 'top' | 'right' | 'left' | 'auto' */
  position?: 'bottom' | 'top' | 'right' | 'left' | 'auto';
  /** 触发器是否占满父容器宽度 */
  fullWidth?: boolean;
  /** 自定义 z-index(默认 200;全屏模式等需要更高层级时传入) */
  zIndex?: number;
  /** 使用 fixed 定位(脱离父容器,悬浮在节点之上,避免被父容器 overflow:hidden 裁剪) */
  fixed?: boolean;
}

type ResolvedPosition = 'bottom' | 'top' | 'right' | 'left';

// Q弹缓动曲线: 轻微 overshoot,弹出有弹性感
const BOUNCY_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const OPEN_DURATION = '0.3s';
const CLOSE_DURATION = '0.18s';

export function Dropdown({
  open,
  onOpenChange,
  items,
  trigger,
  theme,
  align = 'left',
  width = 200,
  dropUp = false,
  position = 'bottom',
  fullWidth = false,
  zIndex = 200,
  fixed = false,
}: DropdownProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // mounted: 菜单是否挂载(open 或收起动画期间为 true)
  const [mounted, setMounted] = useState(false);
  // visible: 控制动画状态(true=展开态,false=收起态)
  const [visible, setVisible] = useState(false);
  const [resolvedPos, setResolvedPos] = useState<ResolvedPosition>(
    position === 'auto' ? (dropUp ? 'top' : 'bottom') : position,
  );
  // fixed 定位的菜单坐标
  const [fixedPosition, setFixedPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // 点击外部关闭(portal 模式下也检查菜单本身)
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      // fixed/portal 模式下菜单在 document.body 中,需额外检查
      if (fixed && menuRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open, onOpenChange, fixed]);

  // 自适应定位:菜单打开时检测可用空间
  useLayoutEffect(() => {
    if (!open || !ref.current) return;

    if (position !== 'auto') {
      setResolvedPos(position);
    } else {
      const triggerRect = ref.current.getBoundingClientRect();
      const menuWidth = width;
      const menuEstimatedHeight = Math.min(items.length * 36 + 8, 400);
      const margin = 8;

      const spaceBelow = window.innerHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      const spaceRight = window.innerWidth - triggerRect.right;
      const spaceLeft = triggerRect.left;

      if (spaceBelow >= menuEstimatedHeight + margin) {
        setResolvedPos('bottom');
      } else if (spaceAbove >= menuEstimatedHeight + margin) {
        setResolvedPos('top');
      } else if (spaceRight >= menuWidth + margin) {
        setResolvedPos('right');
      } else if (spaceLeft >= menuWidth + margin) {
        setResolvedPos('left');
      } else {
        const max = Math.max(spaceBelow, spaceAbove, spaceRight, spaceLeft);
        if (max === spaceBelow) setResolvedPos('bottom');
        else if (max === spaceAbove) setResolvedPos('top');
        else if (max === spaceRight) setResolvedPos('right');
        else setResolvedPos('left');
      }
    }

    // fixed 模式: 计算菜单的 fixed 坐标
    if (fixed && ref.current) {
      const triggerRect = ref.current.getBoundingClientRect();
      const actualPos = position === 'auto' ? resolvedPos : position;
      const menuWidth = width;
      const menuEstimatedHeight = Math.min(items.length * 36 + 8, 400);
      const margin = 4;

      let left = 0;
      let top = 0;

      switch (actualPos) {
        case 'bottom':
          left = align === 'right' ? triggerRect.right - menuWidth : triggerRect.left;
          top = triggerRect.bottom + margin;
          break;
        case 'top':
          left = align === 'right' ? triggerRect.right - menuWidth : triggerRect.left;
          top = triggerRect.top - menuEstimatedHeight - margin;
          break;
        case 'right':
          left = triggerRect.right + margin;
          top = triggerRect.top;
          break;
        case 'left':
          left = triggerRect.left - menuWidth - margin;
          top = triggerRect.top;
          break;
      }

      // 确保不超出屏幕
      left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - menuEstimatedHeight - 8));

      setFixedPosition({ left, top });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position, width, items.length, fixed]);

  // 挂载/卸载 + 动画状态控制
  // useLayoutEffect 确保在 paint 前完成初始 DOM 提交,React 18 生产模式下动画更可靠
  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      let rafId: number;
      const id = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => setVisible(true));
      });
      return () => { cancelAnimationFrame(id); cancelAnimationFrame(rafId); };
    } else if (mounted) {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 180);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const containerStyle: CSSProperties = {
    position: 'relative',
    display: fullWidth ? 'flex' : 'inline-flex',
    ...(fullWidth ? { width: '100%' } : {}),
  };

  function getMenuPositionStyle(pos: ResolvedPosition): CSSProperties {
    const base: CSSProperties = {
      zIndex,
      minWidth: width,
      maxWidth: 'calc(100vw - 16px)',
      maxHeight: 'calc(100vh - 32px)',
      overflow: 'hidden',
    };

    if (fixed) {
      return {
        ...base,
        position: 'fixed',
        left: fixedPosition.left,
        top: fixedPosition.top,
      };
    }

    switch (pos) {
      case 'bottom':
        return { ...base, top: '100%', left: align === 'right' ? 'auto' : 0, right: align === 'right' ? 0 : 'auto', marginTop: 4 };
      case 'top':
        return { ...base, bottom: '100%', left: align === 'right' ? 'auto' : 0, right: align === 'right' ? 0 : 'auto', marginBottom: 4 };
      case 'right':
        return { ...base, left: '100%', top: 0, marginLeft: 4 };
      case 'left':
        return { ...base, right: '100%', top: 0, marginRight: 4 };
    }
  }

  function getTransformOrigin(pos: ResolvedPosition): string {
    switch (pos) {
      case 'bottom': return 'top';
      case 'top': return 'bottom';
      case 'right': return 'left';
      case 'left': return 'right';
    }
  }

  const menuStyle: CSSProperties = {
    ...getMenuPositionStyle(resolvedPos),
    padding: 4,
    background: theme.node.contentBackground,
    border: `1px solid ${theme.toolbar.border}`,
    borderRadius: 8,
    boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
    color: theme.toolbar.text,
    // Q弹动画:弹出 scale 0.85→1 overshoot,收起 scale 1→0.85 ease-in
    transform: visible ? 'scale(1)' : 'scale(0.85)',
    opacity: visible ? 1 : 0,
    transformOrigin: getTransformOrigin(resolvedPos),
    transition: visible
      ? `transform ${OPEN_DURATION} ${BOUNCY_EASE}, opacity ${OPEN_DURATION} ease-out`
      : `transform ${CLOSE_DURATION} cubic-bezier(0.4, 0, 1, 1), opacity ${CLOSE_DURATION} ease-in`,
    pointerEvents: visible ? 'auto' : 'none',
  };

  const itemStyle = (item: DropdownItem): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 12px',
    borderRadius: 4,
    cursor: item.disabled ? 'not-allowed' : 'pointer',
    opacity: item.disabled ? 0.4 : 1,
    color: item.danger ? theme.toolbar.danger : theme.toolbar.text,
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    transition: 'background 0.12s',
  });

  const menuContent = mounted ? (
    <div ref={menuRef} style={menuStyle} data-dropdown-menu>
      {items.map((item, index) =>
        item.divider ? (
          <div
            key={`divider-${index}`}
            style={{
              height: 1,
              margin: '4px 0',
              background: theme.toolbar.border,
            }}
          />
        ) : (
          <div
            key={item.key}
            style={itemStyle(item)}
            onMouseEnter={(event) => {
              if (!item.disabled) {
                event.currentTarget.style.background = theme.mode === 'dark'
                  ? 'rgba(255,255,255,0.06)'
                  : 'rgba(0,0,0,0.05)';
              }
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
            }}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onOpenChange(false);
            }}
          >
            {item.icon ? <span style={{ display: 'inline-flex', width: 16, height: 16 }}>{item.icon}</span> : null}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
          </div>
        ),
      )}
    </div>
  ) : null;

  return (
    <div ref={ref} style={containerStyle}>
      <div
        onClick={() => onOpenChange(!open)}
        style={{ cursor: 'pointer', display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : undefined }}
      >
        {trigger}
      </div>
      {fixed ? createPortal(menuContent, document.body) : menuContent}
    </div>
  );
}