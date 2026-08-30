/**
 * CanvasTabBar — 画布顶部页签条（Plan#50 / 征集 #97）
 *
 * 结构：固定「画布」页签（不可关闭，始终第一个）+ 资源页签（可关闭）。
 * 视觉：与画布顶栏同高的紧凑横条（36px），激活态 accent 下划线；横向溢出可滚动。
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { X, type LucideIcon } from 'lucide-react';
import { CANVAS_TAB_KEY, useCanvasTabStore } from './canvas-tab-store.js';
import type { CanvasTabKind } from './canvas-tab-store.js';
import { CANVAS_TAB_ICONS } from './icons.js';

function TabIcon({ kind }: { kind: CanvasTabKind }): React.ReactElement {
  // 与画布节点左上角/层级面板类型图标同源（出片=Film 而非通用文档图标）
  const Icon: LucideIcon = CANVAS_TAB_ICONS[kind];
  return <Icon size={12} />;
}

export function CanvasTabBar(): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const tabs = useCanvasTabStore((s) => s.tabs);
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const activateTab = useCanvasTabStore((s) => s.activateTab);
  const closeTab = useCanvasTabStore((s) => s.closeTab);
  const reorderTabs = useCanvasTabStore((s) => s.reorderTabs);
  // 拖拽中的资源页签下标（画布固定页签不参与排序）
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (tabs.length === 0) return null;

  // Plan#50 修正(用户拍板):页签条与标题同行(inline 于顶栏行),紧凑高度、无下边框/背景
  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    gap: 2,
    height: 30,
    flexShrink: 0,
    minWidth: 0,
    padding: '0 6px',
    overflowX: 'auto',
    overflowY: 'hidden',
    overscrollBehavior: 'contain',
    background: 'transparent',
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: '100%',
    padding: '0 10px',
    border: 'none',
    background: active ? `${theme.toolbar.accent}14` : 'transparent',
    color: active ? theme.toolbar.text : theme.toolbar.textMuted,
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'background 0.15s, color 0.15s',
  });

  const underlineStyle = (active: boolean): CSSProperties => ({
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
    background: active ? theme.toolbar.accent : 'transparent',
  });

  const closeBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    padding: 0,
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    opacity: 0.6,
    flexShrink: 0,
  };

  return (
    <div style={barStyle}>
      {/* 固定页签：画布（不可关闭） */}
      <button
        type="button"
        onClick={() => activateTab(CANVAS_TAB_KEY)}
        style={tabStyle(activeTabKey === CANVAS_TAB_KEY)}
        title={t('canvasTab.canvas', '画布')}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.toolbar.accent, flexShrink: 0 }} />
        {t('canvasTab.canvas', '画布')}
        <span style={underlineStyle(activeTabKey === CANVAS_TAB_KEY)} />
      </button>

      {/* 资源页签（可关闭，支持拖拽排序） */}
      {tabs.map((tab, idx) => {
        const active = activeTabKey === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            draggable
            onClick={() => activateTab(tab.key)}
            onDragStart={(e) => {
              setDragIndex(idx);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', tab.key);
            }}
            onDragOver={(e) => {
              // 仅当有拖拽源时允许放置，避免误触
              if (dragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== idx) reorderTabs(dragIndex, idx);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            style={tabStyle(active)}
            title={tab.title}
          >
            <TabIcon kind={tab.kind} />
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title}</span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={t('canvasTab.close', '关闭页签')}
              style={closeBtnStyle}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.key);
              }}
            >
              <X size={11} />
            </span>
            <span style={underlineStyle(active)} />
          </button>
        );
      })}
    </div>
  );
}
