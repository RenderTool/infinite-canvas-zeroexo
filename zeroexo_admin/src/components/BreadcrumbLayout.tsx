/**
 * BreadcrumbLayout - 全局统一页面骨架
 *
 * 所有页面统一采用「顶部面包屑 + 内容区」结构，保证面包屑在视觉上
 * 处于完全一致的相对位置（顶部 padding 24px 32px）。
 * toolbar 渲染于面包屑同一行的右侧，替代原 PageContainer 的 extra。
 *
 * 设计规范：
 * - 外层 padding: 24px 32px（上下 24，左右 32）
 * - 面包屑区域 minHeight: 24px
 * - 内容区 marginTop: 16px
 * - 内容区 flex: 1, minHeight: 0（确保正确填充）
 */
import type { ReactNode } from 'react';
import { Breadcrumb } from 'antd';

export interface BreadcrumbLayoutItem {
  title: ReactNode;
  /** 点击面包屑项时的跳转链接（可选） */
  href?: string;
  /** 点击面包屑项时的回调（可选） */
  onClick?: (e: React.MouseEvent) => void;
}

interface BreadcrumbLayoutProps {
  /** 面包屑层级，如 [用户管理, 用户列表] */
  items: BreadcrumbLayoutItem[];
  /** 顶部右侧操作区（替代原 PageContainer extra） */
  toolbar?: ReactNode;
  children: ReactNode;
}

export default function BreadcrumbLayout({
  items,
  toolbar,
  children,
}: BreadcrumbLayoutProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: '24px 32px 0',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 24 }}>
        <Breadcrumb
          items={items.map((item) => ({
            title: item.title,
            href: item.href,
            onClick: item.onClick,
          }))}
          style={{ fontSize: 13, color: 'var(--color-text-secondary, #525252)' }}
        />
        <div style={{ flex: 1 }} />
        {toolbar}
      </div>
      <div className="breadcrumb-layout-content" style={{ flex: 1, minHeight: 0, marginTop: 16, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}
