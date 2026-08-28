/**
 * ContextMenu - 右键上下文菜单(自研,零 antd 依赖)
 *
 * 特性: 右键触发器 + 绝对定位菜单 + 外部点击关闭 + Escape 关闭 + Scale+Fade 动画
 * 使用 @zeroexo/plugin-theme 的 useTheme 获取主题色,支持亮/暗主题自适应
 * 视觉风格 1:1 复刻上下文ContextMenu.tailwind.jsx
 *
 * 归属: 2026-08-20 自 app 层 src/shared/components 下沉(征集 #11 P0 反向依赖修复),
 *       插件包不再引用宿主类型; app 层 shared/index 改 re-export 本组件保持兼容
 *
 * 视觉与 Logo 下拉(antd Dropdown)对齐:亮/暗色背景、边框、圆角 8、boxShadowSecondary、
 * antd slide-up 动画曲线; 分组分隔线为短虚线; 菜单内滚动用原生捕获隔离,不穿透画布。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

  // 征集 #87 验收轮十一:边缘修正——靠右/靠下时菜单回移避免超出视口被裁剪。
  // 挂载后按实际尺寸测量一次(高度依赖菜单项数量)。
  const [adjusted, setAdjusted] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!mounted || !pos || !menuRef.current) {
      setAdjusted(null);
      return;
    }
    const el = menuRef.current;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 200;
    let x = pos.x;
    let y = pos.y;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x + w > vw - 8) x = Math.max(8, vw - w - 8);
    if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
    setAdjusted((prev) => (prev && prev.x === x && prev.y === y ? prev : { x, y }));
  }, [mounted, pos, items]);
  const finalPos = adjusted ?? pos;

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

  // 菜单内滚动隔离:原生捕获阶段拦截 wheel,阻止穿透到画布(React 合成 onWheel
  // 在 root 派发,晚于画布元素上的原生监听,无法拦截)。捕获阶段在事件到达
  // 菜单容器时先于更深层目标执行,stopPropagation 使画布缩放/滚动监听收不到事件。
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel, { capture: true, passive: true });
    return () => el.removeEventListener('wheel', stopWheel, { capture: true } as EventListenerOptions);
  }, [mounted]);

  // 阻止浏览器默认右键菜单
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // ===== 样式 =====

  // 与 AntdThemeProvider 映射一致:亮色下拉=#fff/#e7e5e4,暗色=toolbar.panel/border
  const panelBg = isDark ? theme.toolbar.panel : '#ffffff';
  const panelBorder = isDark ? theme.toolbar.border : '#e7e5e4';
  // antd Dropdown slide-up 动画曲线(平滑缓出,非弹性回弹)
  const motion = 'opacity 0.2s cubic-bezier(0.08, 0.82, 0.17, 1), transform 0.2s cubic-bezier(0.08, 0.82, 0.17, 1)';

  const menuStyle: CSSProperties = {
    position: 'fixed',
    left: finalPos ? finalPos.x : 0,
    top: finalPos ? finalPos.y : 0,
    zIndex: 999,
    minWidth: 170,
    maxWidth: 'calc(100vw - 16px)',
    maxHeight: 'min(60vh, 480px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: '4px 0',
    margin: 0,
    listStyle: 'none',
    background: panelBg,
    border: `1px solid ${panelBorder}`,
    borderRadius: 8,
    boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    transform: visible ? 'scaleY(1)' : 'scaleY(0.8)',
    opacity: visible ? 1 : 0,
    transformOrigin: 'top center',
    pointerEvents: visible ? 'auto' : 'none',
    transition: motion,
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
      {/* 征集 #87 验收轮十一:portal 到 body——避免祖先 transform 使 fixed 退化/被容器裁剪(抽屉/画布边缘场景) */}
      {mounted && finalPos ? createPortal(
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
        </ul>,
        document.body,
      ) : null}
    </div>
  );
}
