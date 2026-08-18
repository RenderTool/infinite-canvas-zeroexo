/**
 * AppLayout - 应用布局壳(antd Layout)
 *
 * 支持三层布局：
 * 1. header（顶部栏，可选）- 悬浮在右上角，不影响内容和侧边栏布局
 * 2. sidebar（侧边栏，可选）
 * 3. content（主内容）
 *
 * 移动端:
 * - 顶部栏 + 侧边栏被隐藏
 * - 渲染统一的 MobileNavButton(右上角)+ MobileNavDrawer(由 mobileNavDrawer prop 注入)
 * - 解决主页/创作/画布移动端 NAV 按钮位置不统一、主页不显示的问题
 *
 * 背景色精确匹配原始配色方案:
 * - 暗色: radial-gradient(ellipse at top, #211d1a 0%, canvas.background 50%)
 * - 亮色: canvas.background
 *
 * 移动端防溢出:
 * - root / body / content 全部使用 overflow: hidden + min-width: 0
 * - 通过 position: relative 约束绝对定位元素的参考系
 * - 任何子组件的 absolute/fixed 元素都只能在视口内定位(top/right/bottom/left >= 0)
 */

import type { CSSProperties, ReactNode } from 'react';
import { Layout } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { MobileNavFloatingWrapper } from './mobile-nav-button.js';

const { Content } = Layout;

export interface AppLayoutProps {
  /** 顶部栏（可选）- 悬浮在右上角 */
  header?: ReactNode;
  /** 侧边栏（可选） */
  sidebar?: ReactNode;
  /** 页面内容 */
  children: ReactNode;
  /** 是否移动端 */
  isMobile?: boolean;
  /** 移动端导航抽屉触发按钮(默认由 AppLayout 渲染在右上角) */
  mobileNavTrigger?: ReactNode;
  /** 移动端导航抽屉节点(由调用方在合适位置注入,如 AppLayout 内部) */
  mobileNavDrawer?: ReactNode;
}

export function AppLayout({
  header,
  sidebar,
  children,
  isMobile,
  mobileNavTrigger,
  mobileNavDrawer,
}: AppLayoutProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const bg = isDark
    ? `radial-gradient(ellipse at top, #211d1a 0%, ${theme.canvas.background} 50%)`
    : '#ffffff';

  return (
    <Layout style={rootStyle(bg, theme)}>
      <div style={layoutBodyStyle}>
        {sidebar && !isMobile && (
          <div style={sidebarStyle}>{sidebar}</div>
        )}
        <Content style={contentStyle}>
          {/* 移动端:右上角统一触发按钮(主页/创作/画布列表都使用) */}
          {isMobile && mobileNavTrigger && (
            <MobileNavFloatingWrapper>{mobileNavTrigger}</MobileNavFloatingWrapper>
          )}
          {children}
        </Content>
      </div>
      {header && !isMobile && (
        <div style={floatingHeaderStyle}>{header}</div>
      )}
      {/* 移动端导航抽屉(渲染在 body 末层,通过 antd Drawer Portal 展示) */}
      {isMobile && mobileNavDrawer}
    </Layout>
  );
}

function rootStyle(
  bg: string,
  theme: { toolbar: { text: string } },
): CSSProperties {
  return {
    position: 'relative',
    height: '100vh',
    maxHeight: '100dvh', // 移动端使用动态视口高度,防止地址栏导致内容被遮挡
    width: '100vw',
    maxWidth: '100%',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: bg,
    color: theme.toolbar.text,
  };
}

const layoutBodyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'row',
  overflow: 'hidden',
  minWidth: 0,
  minHeight: 0,
  position: 'relative',
  width: '100%',
};

const sidebarStyle: CSSProperties = {
  flexShrink: 0,
  height: '100%',
  minHeight: 0,
};

const contentStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  position: 'relative',
  overflow: 'hidden',
  minWidth: 0,
  minHeight: 0,
};

const floatingHeaderStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  zIndex: 100,
  pointerEvents: 'none',
  maxWidth: '100%',
};
