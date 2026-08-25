/**
 * ShortcutsDialog - 画布快捷键说明弹窗
 *
 * 居中弹窗(用于 TopBar 顶部栏、MobileNavDrawer 移动端抽屉)。
 * 渲染 5 类快捷键:编辑 / 选择 / 视图 / 画布 / 组合。
 * 条目由键盘插件注册表(单一事实源)经 getShortcutCatalog 自动派生,不再手写副本;
 * 手势类(Space 平移/Shift 拖出组)与注册表外监听(V 键)由 EXTRA_SHORTCUTS 补充声明。
 * 桌面端分类横向并排(3 列);移动端恢复竖向堆叠。
 * 使用 antd Modal 组件实现居中弹窗效果。
 */

import { Fragment } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { getShortcutCatalog, type ShortcutEntry, type ShortcutCatalogEntry } from '@zeroexo/plugin-keyboard';

export interface ShortcutsDialogProps {
  theme: ThemeConfig;
  onClose: () => void;
  /** 移动端:分类竖向堆叠;桌面端(默认):分类横向并排 */
  isMobile?: boolean;
  /** 键盘插件注册表(自动映射);缺省时仅展示手势类补充条目 */
  shortcuts?: readonly ShortcutEntry[];
}

// 注册表外补充条目:手势/内部监听类(不进 keyboard 注册表,UI 展示仍需声明)
// - Space 平移 / Shift 拖出组:画布手势(非 keyboard 插件分发)
// - V 键:interaction 插件内部监听(use-editor-state),非注册表条目
// - Wheel/Ctrl+Wheel:滚轮手势(2026-08-25 拍板反转:滚轮=上下平移、Ctrl+滚轮=缩放)
const noop = (): boolean => false;
const EXTRA_SHORTCUTS: ShortcutEntry[] = [
  { id: 'ui:pan-mode', key: 'Space', meta: { category: 'canvas', descriptionKey: 'shortcuts.panMode' }, handler: noop },
  { id: 'ui:select-mode', key: 'v', meta: { category: 'canvas', descriptionKey: 'shortcuts.selectMode' }, handler: noop },
  { id: 'ui:drag-detach', key: 'Shift', meta: { category: 'edit', descriptionKey: 'shortcuts.dragDetach' }, handler: noop },
  { id: 'ui:wheel-scroll', key: 'Wheel', meta: { category: 'view', descriptionKey: 'shortcuts.wheelScroll' }, handler: noop },
  { id: 'ui:ctrl-scroll-zoom', key: 'Wheel', ctrlKey: true, meta: { category: 'view', descriptionKey: 'shortcuts.ctrlScrollZoom' }, handler: noop },
];

// 分类展示顺序(目录条目缺省分类归 'other',UI 无展示位)
const CATEGORY_ORDER: ReadonlyArray<{ id: string; titleKey: string }> = [
  { id: 'edit', titleKey: 'shortcuts.categoryEdit' },
  { id: 'select', titleKey: 'shortcuts.categorySelect' },
  { id: 'view', titleKey: 'shortcuts.categoryView' },
  { id: 'canvas', titleKey: 'shortcuts.categoryCanvas' },
  { id: 'group', titleKey: 'shortcuts.categoryGroup' },
];

// 同操作多条注册(如成组: Enter 与 Ctrl+G 同效)只保留首条推荐展示(注册序即推荐序),
// 其余默认生效但不展示(用户拍板:避免"或"关系渲染成组合键误读 + 信息过载)
function dedupeByDescription(items: ShortcutCatalogEntry[]): ShortcutCatalogEntry[] {
  const seen = new Set<string>();
  const out: ShortcutCatalogEntry[] = [];
  for (const item of items) {
    if (seen.has(item.descriptionKey)) continue;
    seen.add(item.descriptionKey);
    out.push(item);
  }
  return out;
}

export function ShortcutsDialog({ theme, onClose, isMobile, shortcuts }: ShortcutsDialogProps): ReactElement {
  const { t } = useTranslation();

  // 注册表自动映射:注册条目 + 手势补充 → 分类目录(缺省归 'other' 不展示)
  const catalog = getShortcutCatalog(shortcuts ?? [], EXTRA_SHORTCUTS);
  const categories = CATEGORY_ORDER.map((cat) => ({
    titleKey: cat.titleKey,
    items: dedupeByDescription(catalog.filter((c) => c.category === cat.id)),
  })).filter((cat) => cat.items.length > 0);

  const shortcutsBodyStyle: CSSProperties = {
    padding: 20,
  };
  // 副标题:与多语言弹窗的 sectionLabel / ConfigDialog 副标题风格一致
  const subtitleStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
  const categoryStyle: CSSProperties = {
    marginBottom: 0,
  };
  const categoryTitleStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: theme.toolbar.accent,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
  // 分组间短虚线分隔(仅移动端竖向排版保留)
  const dividerStyle: CSSProperties = {
    height: 0,
    border: 'none',
    borderTop: `1px dashed ${theme.toolbar.border}`,
    margin: '18px 0',
  };
  // 桌面端:分类横向并排 3 列,组间留白;移动端:竖向堆叠,组间虚线分隔
  const gridStyle: CSSProperties = isMobile
    ? { display: 'flex', flexDirection: 'column' }
    : { display: 'flex', flexWrap: 'wrap', gap: '24px 28px', alignItems: 'flex-start' };
  const categoryWrapStyle: CSSProperties = isMobile
    ? {}
    : { flex: '1 1 calc(33.333% - 19px)', minWidth: 170 };
  const shortcutRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
  };
  const shortcutKeysStyle: CSSProperties = {
    display: 'flex',
    gap: 4,
  };
  const keyStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    height: 24,
    padding: '0 6px',
    borderRadius: 4,
    background: theme.toolbar.background,
    border: `1px solid ${theme.toolbar.border}`,
    fontSize: 12,
    fontWeight: 600,
    color: theme.toolbar.text,
    fontFamily: "'SF Mono', 'Monaco', 'Consolas', monospace",
  };
  const descriptionStyle: CSSProperties = {
    fontSize: 13,
    color: theme.toolbar.text,
  };

  return (
    <Modal
      open={true}
      title={t('menu.shortcuts')}
      centered
      onCancel={onClose}
      footer={null}
      width={isMobile ? 340 : 720}
      destroyOnHidden
      styles={{
        mask: { background: 'transparent' },
        body: shortcutsBodyStyle,
        /* 面板底色只作用于弹窗卡片本身(root,antd 6 已移除 content 键),不再铺满整个 wrapper,避免纯色背板 */
        root: {
          background: theme.toolbar.panel,
          color: theme.toolbar.text,
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
        },
        header: {
          background: theme.toolbar.panel,
          color: theme.toolbar.text,
        },
      }}
    >
      {/* 副标题 */}
      <div style={subtitleStyle}>{t('menu.shortcutsDescription')}</div>
      <div style={gridStyle}>
        {categories.map((category, categoryIndex) => (
          <div key={category.titleKey} style={categoryWrapStyle}>
            {isMobile && categoryIndex > 0 && <hr style={dividerStyle} />}
            <div style={categoryStyle}>
              <div style={categoryTitleStyle}>{t(category.titleKey)}</div>
              {category.items.map((item) => (
                <div key={item.id} style={shortcutRowStyle}>
                  <span style={descriptionStyle}>{t(item.descriptionKey)}</span>
                  <div style={shortcutKeysStyle}>
                    {item.caps.map((key, keyIndex) => (
                      <Fragment key={keyIndex}>
                        {keyIndex > 0 && (
                          <span
                            style={{
                              color: theme.toolbar.textMuted,
                              fontSize: 12,
                              marginRight: 4,
                            }}
                          >
                            +
                          </span>
                        )}
                        <span style={keyStyle}>{key}</span>
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
