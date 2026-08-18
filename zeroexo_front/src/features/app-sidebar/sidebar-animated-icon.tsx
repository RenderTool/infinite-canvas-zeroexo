/**
 * SidebarAnimatedIcon - 侧边栏动画图标
 *
 * 使用原生 SVG + CSS 动画实现:
 * - 常态: 完整显示
 * - hover/激活时: 播放描边绘制动画 + 轻微缩放
 *
 * 注: keyframes 在模块加载时注入一次,组件渲染不包含任何 <style> 标签,
 * 保证 antd Menu 等容器能正确识别为图标元素并添加 ant-menu-item-icon 类。
 */

import type { CSSProperties } from 'react';

export interface SidebarAnimatedIconProps {
  type: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies' | 'help';
  size?: number;
  active?: boolean;
  hovered?: boolean;
  color?: string;
  strokeWidth?: number;
}

const ICON_PATHS: Record<string, string> = {
  home: 'M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z',
  canvas: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5L19 18H5z',
  assets: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM9 13h6M9 17h4',
  publicPrompts: 'M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z',
  policies: 'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0V7m0 15h12M8 7h8M8 11h8M8 15h4',
  help: 'M12 22c5.5 0 10-4.5 10-10S17.5 2 12 2 2 6.5 2 12s4.5 10 10 10zM9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4M12 17h.01',
};

/** 模块级注入 keyframes(仅执行一次) */
let keyframesInjected = false;
function ensureKeyframes(): void {
  if (keyframesInjected || typeof document === 'undefined') return;
  keyframesInjected = true;
  const id = 'zeroexo-icon-keyframes';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `@keyframes zeroexo-icon-draw{0%{stroke-dashoffset:200}100%{stroke-dashoffset:0}}`;
  document.head.appendChild(style);
}

/**
 * 渲染模式:
 * - inline(默认): 返回单个 <svg> 元素,适用于 antd Menu 等容器,antd 自动添加 ant-menu-item-icon 类
 * - wrapped: 返回 <span> 包裹 <svg>,适用于侧边栏按钮等需要 hover 缩放动画的场景
 */
export type IconRenderMode = 'inline' | 'wrapped';

export function SidebarAnimatedIcon({
  type,
  size = 20,
  active = false,
  hovered = false,
  color = 'currentColor',
  strokeWidth = 1.5,
  mode = 'wrapped',
}: SidebarAnimatedIconProps & { mode?: IconRenderMode }): React.ReactElement {
  ensureKeyframes();

  const path = ICON_PATHS[type];
  const animate = hovered || active;

  const pathStyle: CSSProperties = {
    strokeDasharray: 200,
    strokeDashoffset: 0,
    animation: animate
      ? 'zeroexo-icon-draw 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards'
      : 'none',
  };

  const svgProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  const svg = (
    <svg {...svgProps}>
      <path d={path} style={pathStyle} />
    </svg>
  );

  if (mode === 'inline') return svg;

  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
    transform: animate ? 'scale(1.08)' : 'scale(1)',
  };

  return <span style={containerStyle}>{svg}</span>;
}