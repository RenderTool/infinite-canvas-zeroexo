/**
 * ShortcutsDialog - 画布快捷键说明弹窗
 *
 * 居中弹窗(用于 TopBar 顶部栏、MobileNavDrawer 移动端抽屉)。
 * 渲染 4 类快捷键:编辑 / 选择 / 视图 / 画布。
 * 使用 antd Modal 组件实现居中弹窗效果。
 */

import { Fragment } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';

export interface ShortcutsDialogProps {
  theme: ThemeConfig;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  descriptionKey: string;
}

interface ShortcutCategory {
  titleKey: string;
  items: ShortcutItem[];
}

const SHORTCUTS: ShortcutCategory[] = [
  {
    titleKey: 'shortcuts.categoryEdit',
    items: [
      { keys: ['Ctrl', 'Z'], descriptionKey: 'shortcuts.undo' },
      { keys: ['Ctrl', 'Y'], descriptionKey: 'shortcuts.redo' },
      { keys: ['Ctrl', 'D'], descriptionKey: 'shortcuts.copyNode' },
      { keys: ['Delete'], descriptionKey: 'shortcuts.deleteNode' },
      { keys: ['Shift'], descriptionKey: 'shortcuts.dragDetach' },
    ],
  },
  {
    titleKey: 'shortcuts.categorySelect',
    items: [
      { keys: ['Ctrl', 'A'], descriptionKey: 'shortcuts.selectAll' },
      { keys: ['Escape'], descriptionKey: 'shortcuts.deselect' },
    ],
  },
  {
    titleKey: 'shortcuts.categoryView',
    items: [
      { keys: ['Ctrl', '+'], descriptionKey: 'shortcuts.zoomIn' },
      { keys: ['Ctrl', '-'], descriptionKey: 'shortcuts.zoomOut' },
      { keys: ['Ctrl', '0'], descriptionKey: 'shortcuts.resetView' },
    ],
  },
  {
    titleKey: 'shortcuts.categoryCanvas',
    items: [
      { keys: ['Space'], descriptionKey: 'shortcuts.panMode' },
      { keys: ['V'], descriptionKey: 'shortcuts.selectMode' },
    ],
  },
];

export function ShortcutsDialog({ theme, onClose }: ShortcutsDialogProps): ReactElement {
  const { t } = useTranslation();

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
  // 分组间短虚线分隔
  const dividerStyle: CSSProperties = {
    height: 0,
    border: 'none',
    borderTop: `1px dashed ${theme.toolbar.border}`,
    margin: '18px 0',
  };
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
      width={560}
      destroyOnHidden
      styles={{
        mask: { background: 'transparent' },
        body: shortcutsBodyStyle,
        wrapper: {
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
      {SHORTCUTS.map((category, categoryIndex) => (
        <div key={category.titleKey}>
          {categoryIndex > 0 && <hr style={dividerStyle} />}
          <div style={categoryStyle}>
            <div style={categoryTitleStyle}>{t(category.titleKey)}</div>
            {category.items.map((item, index) => (
              <div key={index} style={shortcutRowStyle}>
                <span style={descriptionStyle}>{t(item.descriptionKey)}</span>
                <div style={shortcutKeysStyle}>
                  {item.keys.map((key, keyIndex) => (
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
    </Modal>
  );
}
