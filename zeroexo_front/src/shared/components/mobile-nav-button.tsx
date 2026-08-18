/**
 * MobileNavButton - 移动端导航抽屉触发按钮
 *
 * 统一在所有页面(主页/创作/画布列表/画布编辑)右上角显示,
 * 触发 MobileNavDrawer 打开。
 *
 * 设计要点:
 * - 浮动在页面右上角(top: 8, right: 8),zIndex 100
 * - 与 AppTopBar/TopBar 视觉一致(32x32 圆形按钮,Lucide Menu icon)
 * - 自动继承 .zeroexo-icon-btn hover 缩放动画
 */

import type { CSSProperties } from 'react';
import { Menu } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import i18n from '@/i18n/config';

export interface MobileNavButtonProps {
  onClick: () => void;
  /** 按钮大小,默认 32 */
  size?: number;
  /** 自定义 title 属性 */
  title?: string;
}

export function MobileNavButton({
  onClick,
  size = 32,
  title = i18n.t('mobileNav.menu'),
}: MobileNavButtonProps): React.ReactElement | null {
  const { theme } = useTheme();
  const isMobile = useIsMobile();

  // 仅在移动端渲染
  if (!isMobile) return null;

  const buttonStyle: CSSProperties = {
    width: size,
    height: size,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: 8,
    background: theme.toolbar.background,
    color: theme.toolbar.text,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="zeroexo-icon-btn"
      style={buttonStyle}
    >
      <Menu size={18} />
    </button>
  );
}

/**
 * MobileNavFloatingWrapper - 移动端导航按钮浮动容器
 *
 * 包裹 MobileNavButton,固定在页面右上角(top: 8, right: 8)。
 * 使用绝对定位,以 page(整个视口)为参考系。
 */
export function MobileNavFloatingWrapper({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement | null {
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 100,
        pointerEvents: 'auto',
      }}
    >
      {children}
    </div>
  );
}
