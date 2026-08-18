/**
 * ChangelogPanel - 更新日志弹窗
 *
 * 特性:
 * - antd Modal 居中弹窗(与 AppearanceDialog / LanguageDialog 同款)
 * - 标题/副标题/筛选标签固定显示(不可滚动)
 * - 下方的日志列表独立滚动
 * - 完整 i18n 国际化
 * - 支持亮/暗主题自适应
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';

// ===== 类型 =====

interface ChangelogEntry {
  version: string;
  type: 'feature' | 'improvement' | 'fix';
  date: string;
  isNew: boolean;
  titleKey: string;
  bodyKey?: string;
  itemKeys?: string[];
  /** 已废弃的条目 key 列表（显示红色删除线） */
  deprecatedKeys?: string[];
}

type FilterType = 'all' | 'feature' | 'improvement' | 'fix';

export interface ChangelogPanelProps {
  open: boolean;
  onClose: () => void;
}

// ===== 真实项目日志 =====

const ENTRIES: ChangelogEntry[] = [
  {
    version: 'v0.13.0', type: 'feature', date: '2026-08-14', isNew: true,
    titleKey: 'changelogEntries.v0_13_0.title',
    bodyKey: 'changelogEntries.v0_13_0.body',
    itemKeys: [
      'changelogEntries.v0_13_0.items.0',
      'changelogEntries.v0_13_0.items.1',
      'changelogEntries.v0_13_0.items.2',
      'changelogEntries.v0_13_0.items.3',
      'changelogEntries.v0_13_0.items.4',
      'changelogEntries.v0_13_0.items.5',
      'changelogEntries.v0_13_0.items.6',
      'changelogEntries.v0_13_0.items.7',
      'changelogEntries.v0_13_0.items.8',
      'changelogEntries.v0_13_0.items.9',
      'changelogEntries.v0_13_0.items.10',
    ],
  },
  {
    version: 'v0.12.0', type: 'feature', date: '2026-08-03', isNew: false,
    titleKey: 'changelogEntries.v0_12_0.title',
    bodyKey: 'changelogEntries.v0_12_0.body',
    itemKeys: [
      'changelogEntries.v0_12_0.items.0',
      'changelogEntries.v0_12_0.items.1',
      'changelogEntries.v0_12_0.items.2',
      'changelogEntries.v0_12_0.items.3',
      'changelogEntries.v0_12_0.items.4',
    ],
  },
  {
    version: 'v0.11.0', type: 'feature', date: '2026-08-02', isNew: false,
    titleKey: 'changelogEntries.v0_11_0.title',
    bodyKey: 'changelogEntries.v0_11_0.body',
    itemKeys: [
      'changelogEntries.v0_11_0.items.0',
      'changelogEntries.v0_11_0.items.1',
      'changelogEntries.v0_11_0.items.2',
      'changelogEntries.v0_11_0.items.3',
      'changelogEntries.v0_11_0.items.4',
    ],
  },
  {
    version: 'v0.10.0', type: 'feature', date: '2026-08-01', isNew: false,
    titleKey: 'changelogEntries.v0_10_0.title',
    bodyKey: 'changelogEntries.v0_10_0.body',
    itemKeys: [
      'changelogEntries.v0_10_0.items.0',
      'changelogEntries.v0_10_0.items.1',
      'changelogEntries.v0_10_0.items.2',
      'changelogEntries.v0_10_0.items.3',
      'changelogEntries.v0_10_0.items.4',
      'changelogEntries.v0_10_0.items.5',
    ],
  },
  {
    version: 'v0.9.0', type: 'feature', date: '2026-07-30', isNew: false,
    titleKey: 'changelogEntries.v0_9_0.title',
    bodyKey: 'changelogEntries.v0_9_0.body',
    itemKeys: [
      'changelogEntries.v0_9_0.items.0',
      'changelogEntries.v0_9_0.items.1',
      'changelogEntries.v0_9_0.items.2',
      'changelogEntries.v0_9_0.items.3',
    ],
  },
  {
    version: 'v0.8.0', type: 'improvement', date: '2026-07-28', isNew: false,
    titleKey: 'changelogEntries.v0_8_0.title',
    bodyKey: 'changelogEntries.v0_8_0.body',
    itemKeys: [
      'changelogEntries.v0_8_0.items.0',
      'changelogEntries.v0_8_0.items.1',
      'changelogEntries.v0_8_0.items.2',
      'changelogEntries.v0_8_0.items.3',
      'changelogEntries.v0_8_0.items.4',
    ],
  },
  {
    version: 'v0.7.0', type: 'feature', date: '2026-07-25', isNew: false,
    titleKey: 'changelogEntries.v0_7_0.title',
    bodyKey: 'changelogEntries.v0_7_0.body',
    itemKeys: [
      'changelogEntries.v0_7_0.items.0',
      'changelogEntries.v0_7_0.items.1',
      'changelogEntries.v0_7_0.items.2',
      'changelogEntries.v0_7_0.items.3',
      'changelogEntries.v0_7_0.items.4',
    ],
  },
  {
    version: 'v0.6.0', type: 'improvement', date: '2026-07-20', isNew: false,
    titleKey: 'changelogEntries.v0_6_0.title',
    bodyKey: 'changelogEntries.v0_6_0.body',
    itemKeys: [
      'changelogEntries.v0_6_0.items.0',
      'changelogEntries.v0_6_0.items.1',
      'changelogEntries.v0_6_0.items.2',
      'changelogEntries.v0_6_0.items.3',
    ],
  },
  {
    version: 'v0.5.0', type: 'feature', date: '2026-07-15', isNew: false,
    titleKey: 'changelogEntries.v0_5_0.title',
    bodyKey: 'changelogEntries.v0_5_0.body',
    itemKeys: [
      'changelogEntries.v0_5_0.items.0',
      'changelogEntries.v0_5_0.items.1',
      'changelogEntries.v0_5_0.items.2',
      'changelogEntries.v0_5_0.items.3',
    ],
    deprecatedKeys: ['changelogEntries.v0_5_0.items.0'],
  },
  {
    version: 'v0.4.0', type: 'feature', date: '2026-07-10', isNew: false,
    titleKey: 'changelogEntries.v0_4_0.title',
    bodyKey: 'changelogEntries.v0_4_0.body',
    itemKeys: [
      'changelogEntries.v0_4_0.items.0',
      'changelogEntries.v0_4_0.items.1',
      'changelogEntries.v0_4_0.items.2',
      'changelogEntries.v0_4_0.items.3',
    ],
    deprecatedKeys: ['changelogEntries.v0_4_0.items.0', 'changelogEntries.v0_4_0.items.1'],
  },
];

const FILTER_OPTIONS: { key: FilterType; labelKey: string }[] = [
  { key: 'all', labelKey: 'changelog.filterAll' },
  { key: 'feature', labelKey: 'changelog.filterFeature' },
  { key: 'improvement', labelKey: 'changelog.filterImprovement' },
  { key: 'fix', labelKey: 'changelog.filterFix' },
];

// ===== 组件 =====

export function ChangelogPanel({ open, onClose }: ChangelogPanelProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  // 关闭时重置筛选
  useEffect(() => {
    if (!open) {
      setActiveFilter('all');
    }
  }, [open]);

  const filteredEntries = useMemo(() => {
    if (activeFilter === 'all') return ENTRIES;
    return ENTRIES.filter((e) => e.type === activeFilter);
  }, [activeFilter]);

  if (!open) return null;

  // ===== 主题色提取 =====
  const accent = theme.toolbar.accent;
  const text = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;
  const panelBg = theme.toolbar.panel;
  const cardBg = isDark ? '#1a1715' : '#ffffff';

  // 时间线灰色
  const timelineColor = isDark ? 'rgba(255,255,255,0.12)' : '#e2e8f0';
  const dotColor = isDark ? 'rgba(255,255,255,0.12)' : '#e2e8f0';
  const newDotColor = accent;

  // 文字颜色
  const headingColor = text;
  const subheadingColor = textMuted;
  const versionLabelColor = text;
  const versionBg = isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9';
  const entryTitleColor = text;
  const entryBodyColor = textMuted;
  const itemColor = textMuted;
  const itemDashColor = textMuted;

  // 筛选按钮
  const tabActiveBg = isDark ? '#ffffff' : '#0f172a';
  const tabActiveText = isDark ? '#0f172a' : '#ffffff';
  const tabInactiveBg = 'transparent';
  const tabInactiveText = textMuted;
  const tabInactiveBorder = border;
  const tabHoverBorder = isDark ? 'rgba(255,255,255,0.3)' : '#94a3b8';
  const tabHoverText = isDark ? 'rgba(255,255,255,0.85)' : '#334155';

  // 类型标签
  const typeBadgeColors: Record<string, { bg: string; text: string }> = {
    feature: { bg: isDark ? 'rgba(99,102,241,0.2)' : '#eef2ff', text: isDark ? '#a5b4fc' : '#4f46e5' },
    improvement: { bg: isDark ? 'rgba(16,185,129,0.2)' : '#ecfdf5', text: isDark ? '#6ee7b7' : '#059669' },
    fix: { bg: isDark ? 'rgba(245,158,11,0.2)' : '#fffbeb', text: isDark ? '#fcd34d' : '#d97706' },
  };

  // Modal 标题(放在 antd Modal 的 title 区,固定显示)
  const titleNode: ReactNode = (
    <div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: headingColor,
          lineHeight: 1.3,
        }}
      >
        {t('changelog.title')}
      </div>
      <div
        style={{
          fontSize: 12,
          color: subheadingColor,
          marginTop: 4,
          lineHeight: 1.4,
        }}
      >
        {t('changelog.subtitle')}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="calc(100vw - 32px)"
      style={{ maxWidth: 680, top: 20 }}
      destroyOnHidden
      title={titleNode}
      centered
      styles={{ mask: { background: 'transparent' } }}
    >
      <div style={containerStyle}>
        {/* 筛选标签 - 固定显示 */}
        <div style={filterBarStyle}>
          {FILTER_OPTIONS.map((opt) => {
            const isActive = activeFilter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setActiveFilter(opt.key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: `1px solid ${isActive ? tabActiveBg : tabInactiveBorder}`,
                  background: isActive ? tabActiveBg : tabInactiveBg,
                  color: isActive ? tabActiveText : tabInactiveText,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = tabHoverBorder;
                    e.currentTarget.style.color = tabHoverText;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = tabInactiveBorder;
                    e.currentTarget.style.color = tabInactiveText;
                  }
                }}
              >
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>

        {/* 时间线 Feed - 可滚动区域 */}
        <div
          style={{
            position: 'relative',
            padding: '20px 8px 8px 36px',
            overflowY: 'auto',
            maxHeight: 'calc(75vh - 180px)',
            minHeight: 0,
          }}
        >
          {/* 时间线竖线 */}
          <div
            style={{
              position: 'absolute',
              left: 12,
              top: 28,
              bottom: 20,
              width: 2,
              background: timelineColor,
            }}
          />

          {filteredEntries.map((entry, index) => (
            <div
              key={`${entry.version}-${index}`}
              style={{
                position: 'relative',
                marginBottom: 24,
              }}
            >
              {/* 时间线圆点 */}
              <div
                style={{
                  position: 'absolute',
                  left: -21,
                  top: 18,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: entry.isNew ? newDotColor : dotColor,
                  border: `2px solid ${panelBg}`,
                  boxShadow: entry.isNew ? `0 0 0 3px ${accent}33` : 'none',
                  zIndex: 1,
                }}
              />

              {/* Entry 卡片 */}
              <div
                style={{
                  background: cardBg,
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  padding: '16px 18px',
                }}
              >
                {/* Header 行 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: versionLabelColor,
                      background: versionBg,
                      padding: '2px 8px',
                      borderRadius: 5,
                      fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                    }}
                  >
                    {entry.version}
                  </span>

                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      padding: '2px 8px',
                      borderRadius: 5,
                      background: typeBadgeColors[entry.type]?.bg,
                      color: typeBadgeColors[entry.type]?.text,
                    }}
                  >
                    {t(`changelog.type${entry.type.charAt(0).toUpperCase()}${entry.type.slice(1)}`)}
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      color: textMuted,
                      marginLeft: 'auto',
                    }}
                  >
                    {entry.date}
                  </span>
                </div>

                {/* Title */}
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: entryTitleColor,
                    marginBottom: 6,
                  }}
                >
                  {t(entry.titleKey)}
                </div>

                {/* Body */}
                {entry.bodyKey && (
                  <div
                    style={{
                      fontSize: 13,
                      color: entryBodyColor,
                      lineHeight: 1.55,
                    }}
                  >
                    {t(entry.bodyKey)}
                  </div>
                )}

                {/* Items */}
                {entry.itemKeys && entry.itemKeys.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    {entry.itemKeys.map((itemKey, i) => {
                      const isDeprecated = entry.deprecatedKeys?.includes(itemKey);
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 6,
                            fontSize: 13,
                            color: isDeprecated ? '#ef4444' : itemColor,
                            lineHeight: 1.5,
                            textDecoration: isDeprecated ? 'line-through' : 'none',
                          }}
                        >
                          <span style={{ color: isDeprecated ? '#ef4444' : itemDashColor, flexShrink: 0 }}>–</span>
                          <span>{t(itemKey)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ===== 样式 =====

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const filterBarStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  padding: '4px 0 14px',
  borderBottom: '1px solid var(--border-color)',
  marginBottom: 4,
};
