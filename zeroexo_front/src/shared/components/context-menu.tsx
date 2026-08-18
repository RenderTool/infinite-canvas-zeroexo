/**
 * ContextMenu - 右键上下文菜单(自研,零 antd 依赖)
 *
 * 特性: 右键触发器 + 绝对定位菜单 + 外部点击关闭 + Escape 关闭 + Scale+Fade 动画
 * 使用 @zeroexo/plugin-theme 的 useTheme 获取主题色,支持亮/暗主题自适应
 * 视觉风格 1:1 复刻上下文ContextMenu.tailwind.jsx
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  divider?: boolean;
  onClick: () => void;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number } | null;
  onClose: () => void;
  /** 触发区域内容(右键点击区域) */
  children?: ReactNode;
}

export function ContextMenu({
  items,
  position,
  onClose,
  children,
}: ContextMenuProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const menuRef = useRef<HTMLUListElement>(null);
  const lastPosition = useRef(position);
  const openTimeRef = useRef(0);

  // 动画状态: mounted 控制 DOM 挂载, visible 控制 CSS 动画
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // 记住最后一次有效位置,供关闭动画期间使用
  if (position) {
    lastPosition.current = position;
  }
  const pos = position || lastPosition.current;

  // 打开/关闭动画控制
  // useLayoutEffect 确保在 paint 前完成初始 DOM 提交,React 18 生产模式下动画更可靠
  useLayoutEffect(() => {
    if (position) {
      openTimeRef.current = Date.now();
      setMounted(true);
      let rafId: number;
      const id = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => setVisible(true));
      });
      return () => { cancelAnimationFrame(id); cancelAnimationFrame(rafId); };
    } else if (mounted) {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps

  // 点击外部关闭(延迟注册,避免右键事件自身触发关闭)
  useEffect(() => {
    if (!position || !mounted) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (Date.now() - openTimeRef.current < 100) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [position, mounted, onClose]);

  // Escape 关闭
  useEffect(() => {
    if (!position) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [position, onClose]);

  // 阻止浏览器默认右键菜单
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // ===== 样式 =====

  const menuStyle: CSSProperties = {
    position: 'fixed',
    left: pos ? pos.x : 0,
    top: pos ? pos.y : 0,
    zIndex: 999,
    minWidth: 170,
    maxWidth: 'calc(100vw - 16px)',
    padding: '4px 0',
    margin: 0,
    listStyle: 'none',
    background: theme.toolbar.panel,
    border: `1px solid ${theme.toolbar.border}`,
    borderRadius: 6,
    boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    transform: visible ? 'scaleY(1)' : 'scaleY(0.85)',
    opacity: visible ? 1 : 0,
    transformOrigin: 'top center',
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity 0.15s ease-out, transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)',
  };

  const itemBaseStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 12px',
    fontSize: 13,
    fontWeight: 500,
    color: theme.toolbar.text,
    borderRadius: 0,
    cursor: 'pointer',
    transition: 'background 0.1s, color 0.1s',
  };

  const dividerStyle: CSSProperties = {
    height: 0,
    border: 'none',
    borderTop: `1px dashed ${theme.toolbar.border}`,
    margin: '4px 8px',
    padding: 0,
    cursor: 'default',
  };

  // ===== 事件 =====

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.divider) return;
    item.onClick();
    onClose();
  };

  const handleItemMouseEnter = (e: React.MouseEvent, item: ContextMenuItem) => {
    if (item.divider) return;
    const el = e.currentTarget as HTMLElement;
    if (item.danger) {
      el.style.background = `${theme.toolbar.danger}15`;
    } else {
      el.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    }
  };

  const handleItemMouseLeave = (e: React.MouseEvent) => {
    (e.currentTarget as HTMLElement).style.background = 'transparent';
  };

  return (
    <div onContextMenu={handleContextMenu} style={{ display: 'contents' }}>
      {children}
      {mounted && pos ? (
        <ul
          ref={menuRef}
          style={menuStyle}
          role="menu"
        >
          {items.map((item, index) =>
            item.divider ? (
              <li
                key={`divider-${index}`}
                style={dividerStyle}
                role="separator"
              />
            ) : (
              <li
                key={item.key}
                style={{
                  ...itemBaseStyle,
                  color: item.danger ? theme.toolbar.danger : theme.toolbar.text,
                }}
                role="menuitem"
                onClick={() => handleItemClick(item)}
                onMouseEnter={(e) => handleItemMouseEnter(e, item)}
                onMouseLeave={handleItemMouseLeave}
              >
                {item.icon ? (
                  <span style={{ display: 'inline-flex', width: 14, height: 14, flexShrink: 0 }}>
                    {item.icon}
                  </span>
                ) : null}
                <span style={{ flex: 1 }}>{item.label}</span>
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}