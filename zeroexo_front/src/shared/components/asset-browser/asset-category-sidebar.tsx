/** @deprecated 已被 features/asset-library 取代，请勿新引用 */
/**
 * AssetCategorySidebar - 资产分类侧边栏
 *
 * 参考 zeroexo-asset-manager-v2.html 的双级导航树设计。
 * 支持展开/折叠分组、子分类选中、侧边栏折叠。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CategorySidebarProps } from './types.js';
import { createStyles } from './styles.js';
import { useTranslation } from 'react-i18next';

export function AssetCategorySidebar({
  categories,
  activeGroup,
  activeChild,
  collapsed,
  onGroupClick,
  onChildClick,
  onToggleCollapse,
  theme,
  sidebarBorderRadius,
}: CategorySidebarProps): React.ReactElement {
  const s = createStyles(theme);
  const { t } = useTranslation();
  // 仅对有子分类(>1)的分组初始化为展开
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(categories.filter((c) => c.children.length > 1).map((c) => c.group)),
  );

  // 折叠状态下的弹出菜单
  const [popupGroup, setPopupGroup] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupGroup(null);
      }
    };
    if (popupGroup) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [popupGroup]);

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const handleGroupClick = useCallback((group: string) => {
    if (collapsed) {
      const cat = categories.find((c) => c.group === group);
      if (cat && cat.children.length > 1) {
        setPopupGroup((prev) => (prev === group ? null : group));
      } else {
        onGroupClick(group as any);
      }
    } else {
      onGroupClick(group as any);
      const cat = categories.find((c) => c.group === group);
      if (cat && cat.children.length > 1) {
        toggleGroup(group);
      }
    }
  }, [onGroupClick, toggleGroup, categories, collapsed]);

  return (
    <div style={s.sidebar(collapsed, sidebarBorderRadius)}>
      {/* 侧边栏头部(折叠时显示标题,始终显示折叠按钮) */}
      <div style={s.sidebarHeader(collapsed)}>
        {!collapsed && <span style={s.sidebarTitle(collapsed)}>{t('assetCategorySidebar.assetCategory')}</span>}
        <button
          type="button"
          style={s.collapseBtn()}
          onClick={onToggleCollapse}
          title={collapsed ? t('assetCategorySidebar.expandSidebar') : t('assetCategorySidebar.collapseSidebar')}
        >
          <ChevronRight
            size={14}
            style={{
              transition: 'transform 0.2s ease',
              transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </button>
      </div>

      {/* 导航树 */}
      <div style={s.navTree(collapsed)}>
        {categories.map((cat) => {
          const isExpanded = expandedGroups.has(cat.group);
          const hasChildren = cat.children.length > 1;

          return (
            <div key={cat.group} style={s.navGroup()}>
              {/* 分组标签 */}
              <div
                ref={(el) => { groupRefs.current[cat.group] = el; }}
                style={s.navGroupLabel(collapsed)}
                onClick={() => handleGroupClick(cat.group)}
                title={cat.label}
              >
                <span style={s.navIcon()}>{cat.icon}</span>
                {!collapsed && (
                  <>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cat.label}
                    </span>
                    <span style={s.navCount(collapsed)}>{cat.count}</span>
                    {hasChildren && (
                      <ChevronRight
                        size={12}
                        style={{
                          color: theme.toolbar.textMuted,
                          transition: 'transform 0.2s ease',
                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </>
                )}
              </div>

              {/* 子分类 - 仅对有子分类的分组渲染 */}
              {!collapsed && hasChildren && (
                <div style={s.navChildren(isExpanded, collapsed)}>
                  {cat.children.map((child) => {
                    const isChildActive = activeGroup === cat.group && activeChild === child.key;
                    return (
                      <div
                        key={child.key}
                        style={s.navChild(isChildActive)}
                        onClick={() => onChildClick(cat.group, child.key)}
                      >
                        <span style={s.navDot(isChildActive)} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {child.label}
                        </span>
                        {child.count !== undefined && (
                          <span style={{ fontSize: 10, color: theme.toolbar.textMuted }}>
                            {child.count}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 折叠状态弹出菜单 */}
              {collapsed && popupGroup === cat.group && hasChildren && (
                <div
                  ref={popupRef}
                  style={{
                    position: 'fixed',
                    left: 56,
                    top: groupRefs.current[cat.group]?.getBoundingClientRect().top ?? 0,
                    minWidth: 140,
                    background: theme.mode === 'dark' ? (theme.canvas?.background ?? '#11110f') : '#fff',
                    border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                    borderRadius: 8,
                    padding: '6px 0',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                    zIndex: 1000,
                  }}
                >
                  {cat.children.map((child) => {
                    const isChildActive = activeGroup === cat.group && activeChild === child.key;
                    return (
                      <div
                        key={child.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 14px',
                          fontSize: 12,
                          color: isChildActive ? (theme.toolbar.accent ?? '#e94560') : theme.toolbar.text,
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onClick={() => {
                          onChildClick(cat.group, child.key);
                          setPopupGroup(null);
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: isChildActive ? (theme.toolbar.accent ?? '#e94560') : theme.toolbar.textMuted, flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{child.label}</span>
                        {child.count !== undefined && (
                          <span style={{ fontSize: 10, color: theme.toolbar.textMuted }}>{child.count}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      </div>
  );
}