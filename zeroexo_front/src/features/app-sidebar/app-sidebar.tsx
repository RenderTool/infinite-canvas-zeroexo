/**
 * AppSidebar - 应用侧边栏导航(桌面端)
 *
 * ⚠️ 重要职责分离:
 * - AppSidebar 仅承载**导航菜单**(Logo / 主页 / 创作 / 画布 / 资产 / 帮助)
 * - 功能按钮(更新日志 / GitHub / 语言切换 / 换肤 / 同步 / 用户菜单)由 AppTopBar 渲染
 *
 * 桌面端:
 * - 固定在左侧(由 AppLayout.layoutBodyStyle flex row 布局控制)
 * - 包含 Logo + 4 个导航按钮 + 底部帮助按钮
 *
 * 移动端:
 * - 不渲染(由 AppLayout 注入的统一 MobileNavButton + MobileNavDrawer 替代)
 * - 移动端导航按钮在右上角
 *
 * 纯图标侧边栏,使用原生 SVG + CSS 动画实现,激活时有描边绘制和发光效果。
 */

import { useState, useCallback } from 'react';
import { Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { LAYOUT } from '@/shared/components/LAYOUT_CONSTANTS.js';
import { LogoIcon } from '@/assets/ico/index.js';
import { SidebarAnimatedIcon } from './sidebar-animated-icon.js';

export interface AppSidebarProps {
  activeRoute: string;
  onNavigate: (route: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies' | { name: 'auth'; mode: 'login' }) => void;
}

export interface NavItem {
  key: string;
  label: string;
  iconType: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies';
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '主页', iconType: 'home' },
  { key: 'canvas', label: '画布', iconType: 'canvas' },
  { key: 'assets', label: '资产', iconType: 'assets' },
  { key: 'publicPrompts', label: '公共提示词', iconType: 'publicPrompts' },
];

export function AppSidebar({ activeRoute, onNavigate }: AppSidebarProps): React.ReactElement {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const handleNavigate = useCallback((key: string) => {
    onNavigate(key as 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies');
  }, [onNavigate]);

  const bg = isDark ? 'transparent' : '#ffffff';
  const textColor = theme.toolbar.text;
  const accent = theme.toolbar.accent;

  return (
    <>
      <style>{`
        .zeroexo-sidebar-btn:hover {
          background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'} !important;
        }
        .zeroexo-sidebar-btn.active {
          background: ${accent}18 !important;
          color: ${accent} !important;
        }
        .zeroexo-sidebar-btn.active svg {
          color: ${accent} !important;
        }
        @keyframes zeroexo-sidebar-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
      <div style={{
        width: LAYOUT.SIDEBAR_COLLAPSED,
        minWidth: LAYOUT.SIDEBAR_COLLAPSED,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: bg,
        overflow: 'hidden',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        position: 'relative',
        zIndex: 50, // 确保 sidebar 在顶层,不被浮动 header 覆盖
        flexShrink: 0,
      }}>
        {/* ===== Logo ===== */}
        <div style={{
          padding: '16px 0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 10,
            color: textColor,
          }}>
            <LogoIcon size={30} />
          </div>
        </div>

        {/* ===== 导航菜单 ===== */}
        <div style={{ flex: 1, padding: '8px 10px', overflow: 'auto' }}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeRoute === item.key;
            const isHovered = hoveredKey === item.key;
            return (
              <Tooltip key={item.key} title={item.label} placement="right">
                <button
                  type="button"
                  onClick={() => handleNavigate(item.key)}
                  onMouseEnter={() => setHoveredKey(item.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className={`zeroexo-sidebar-btn ${isActive ? 'active' : ''}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '100%', height: 40, marginBottom: 4,
                    borderRadius: 10, border: 'none',
                    background: 'transparent',
                    color: isActive ? accent : textColor,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all .15s',
                  }}
                >
                  <SidebarAnimatedIcon
                    type={item.iconType}
                    size={item.iconType === 'publicPrompts' ? 18 : 20}
                    active={isActive}
                    hovered={isHovered}
                    color={isActive ? accent : textColor}
                    strokeWidth={1.5}
                  />
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* ===== 底部政策公告按钮 ===== */}
        <div style={{
          padding: '10px',
          display: 'flex',
          justifyContent: 'center',
        }}>
          <Tooltip title="政策公告" placement="right">
            <button
              type="button"
              className="zeroexo-sidebar-btn"
              onClick={() => handleNavigate('policies')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%',
                border: 'none', background: 'transparent',
                color: textColor,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all .15s',
              }}
            >
              <SidebarAnimatedIcon
                type="help"
                size={20}
                active={false}
                color={textColor}
                strokeWidth={1.5}
              />
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
