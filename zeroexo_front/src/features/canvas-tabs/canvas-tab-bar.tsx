/**
 * CanvasTabBar — 画布顶部页签条（Plan#50 / 征集 #97）
 *
 * 结构：固定「画布」页签（不可关闭，始终第一个）+ 资源页签（可关闭）。
 * 视觉：与画布顶栏同高的紧凑横条（36px），激活态 accent 下划线；横向溢出可滚动。
 */

import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { FileText, X } from 'lucide-react';
import { CANVAS_TAB_KEY, useCanvasTabStore } from './canvas-tab-store.js';
import type { CanvasTabKind } from './canvas-tab-store.js';

function TabIcon({ kind }: { kind: CanvasTabKind }): React.ReactElement {
  // 剧本/分镜/工作台均用文字符号图标（后续可按 kind 细分）
  void kind;
  return <FileText size={12} />;
}

export function CanvasTabBar(): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const tabs = useCanvasTabStore((s) => s.tabs);
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const activateTab = useCanvasTabStore((s) => s.activateTab);
  const closeTab = useCanvasTabStore((s) => s.closeTab);

  // 无资源页签时不占高度（保持画布页原样）
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

      {/* 资源页签（可关闭） */}
      {tabs.map((tab) => {
        const active = activeTabKey === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => activateTab(tab.key)}
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
