/**
 * canvas-assets/components/common - 画布资产抽屉通用展示组件（纯渲染，数据由 store 驱动）
 *
 * 与主页资产库不共享任何编排层；仅复用 antd / lucide 等基础 UI 元件。
 */

import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Pagination } from 'antd';
import { ChevronDown, Search, Upload } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';

// ===== 分组 Tab =====

export interface GroupTabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

/** 侧边栏导航（纯图标，无文字 label，无数字角标） */
export function SidebarNav({ items, active, onChange, theme }: {
  items: GroupTabItem[];
  active: string;
  onChange: (key: string) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      padding: '8px 6px',
      flexShrink: 0,
    }}>
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <div
            key={item.key}
            onClick={() => onChange(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: 'pointer',
              background: isActive ? theme.toolbar.accent : 'transparent',
              color: isActive ? '#fff' : theme.toolbar.textMuted,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {item.icon}
          </div>
        );
      })}
    </div>
  );
}

export function GroupTabs({ items, active, onChange, theme }: {
  items: GroupTabItem[];
  active: string;
  onChange: (key: string) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      overflowY: 'hidden',
      padding: '0 20px 0',
      gap: 24,
      flexShrink: 0,
    }}>
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <div
            key={item.key}
            onClick={() => onChange(item.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? theme.toolbar.text : theme.toolbar.textMuted,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              position: 'relative',
            }}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span style={{ fontSize: 11, opacity: 0.5 }}>{item.count}</span>
            )}
            <span style={{
              position: 'absolute',
              bottom: 0, left: 0, right: 0,
              height: 2,
              borderRadius: 1,
              background: isActive ? theme.toolbar.accent : 'transparent',
            }} />
          </div>
        );
      })}
    </div>
  );
}

// ===== 来源切换（我的 / 公共，显眼分段按钮） =====

export function SourceSwitch({ value, onChange, theme }: {
  value: string;
  onChange: (v: string) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const options = [
    { key: 'mine', label: t('promptSource.mine') },
    { key: 'public', label: t('promptSource.public') },
  ];
  return (
    <div style={{
      display: 'inline-flex',
      padding: 2,
      borderRadius: 6,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
      flexShrink: 0,
    }}>
      {options.map((opt) => {
        const selected = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: 'none',
              fontSize: 12,
              fontWeight: selected ? 600 : 400,
              color: selected ? '#fff' : theme.toolbar.textMuted,
              background: selected ? theme.toolbar.accent : 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ===== 分类 chips =====

export function CategoryChips({ items, active, onChange, theme }: {
  items: Array<{ key: string | null; label: string; count?: number }>;
  active: string | null;
  onChange: (key: string | null) => void;
  theme: ThemeConfig;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      // 2026-08-31 用户拍板：分类标签不用水平滚动，flex 自适应换行
      flexWrap: 'wrap',
      gap: 4,
      flexShrink: 0,
    }}>
      {items.map((item) => {
        const selected = (item.key ?? null) === active;
        return (
          <button
            key={item.key ?? 'all'}
            type="button"
            onClick={() => onChange(item.key ?? null)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              height: 24,
              padding: '0 8px',
              fontSize: 11,
              fontWeight: selected ? 600 : 400,
              borderRadius: 6,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              border: selected ? `1px solid ${theme.toolbar.accent}` : '1px solid transparent',
              background: selected ? theme.toolbar.accent : 'transparent',
              color: selected ? '#fff' : theme.toolbar.textMuted,
            }}
          >
            {item.label}
            {typeof item.count === 'number' && item.count > 0 && (
              <span style={{ fontSize: 10, opacity: 0.6 }}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ===== 搜索框 =====

export function SearchBox({ value, onChange, placeholder, theme }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  theme: ThemeConfig;
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: 1,
      minWidth: 0,
      height: 26,
      padding: '0 8px',
      borderRadius: 6,
      background: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    }}>
      <Search size={12} style={{ opacity: 0.4, flexShrink: 0 }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 12,
          color: theme.toolbar.text,
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

// ===== 分页 =====

export function PaginationBar({ page, total, pageSize, onChange }: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}): React.ReactElement | null {
  if (total <= pageSize) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0', flexShrink: 0 }}>
      <Pagination current={page} total={total} pageSize={pageSize} onChange={onChange} showSizeChanger={false} size="small" />
    </div>
  );
}

// ===== 空态 / 错误态 =====

export function EmptyState({ text, theme }: { text?: string; theme: ThemeConfig }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{
      padding: 60,
      textAlign: 'center',
      fontSize: 13,
      color: theme.toolbar.textMuted,
    }}>
      {text ?? t('assetLibrary.empty')}
    </div>
  );
}

export function ErrorBar({ message, onRetry }: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderRadius: 8,
      fontSize: 12,
      background: 'rgba(239,68,68,0.08)',
      color: '#ef4444',
      flexShrink: 0,
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      <Button size="small" onClick={onRetry}>{t('common.retry', { defaultValue: '重试' })}</Button>
    </div>
  );
}

// ===== 加载骨架 =====

export function SkeletonGrid({ theme }: { theme: ThemeConfig }): React.ReactElement {
  const isDark = theme.mode === 'dark';
  const bg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: '4px 20px' }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ height: 120, borderRadius: 10, background: bg }} />
      ))}
    </div>
  );
}

// ===== 工具栏行（筛选 + 搜索） =====

export function ToolbarRow({ children, style }: { children: ReactNode; style?: CSSProperties }): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '8px 20px 10px',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      flexShrink: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}

// ===== 虚线加号格子（新建入口） =====

export function AddTile({ label, onClick, theme }: {
  label: string;
  onClick: () => void;
  theme: ThemeConfig;
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: '100%',
        height: 44,
        flexShrink: 0,
        border: `1.5px dashed ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`,
        borderRadius: 8,
        background: 'transparent',
        color: theme.toolbar.textMuted,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <Upload size={16} />
      {label}
    </button>
  );
}

// ===== 折叠触发（ChevronDown 图标按钮，通用） =====

export function ChevronButton(): React.ReactElement {
  return <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0 }} />;
}
