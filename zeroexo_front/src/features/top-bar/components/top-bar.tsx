/**
 * TopBar - 顶部工具栏容器(画布编辑器专用)
 *
 * 左侧:可编辑标题(CanvasMenu 已移至 CanvasControls 的 menuSlot);
 * 右侧:外观设置(与主页换肤为同一组件变体,文案一致)+ 独立按钮(文档/快捷键/语言/配置)
 *      + 版本快照(保存版本/版本历史)+ 协作 + Agent。
 * 账号信息与退出登录已移入左上角 CanvasMenu。
 * 主题由 useTheme() 注入;外观浮层开关内部管理;设置弹窗由父组件控制(通过 onOpenSettings)。
 * 左侧 padding 预留 CanvasControls(左上角竖向控件)的宽度,避免重叠。
 *
 * 移动端仅渲染标题 + 撤销/重做 + 同步徽标(精简视图);
 * 移动端导航抽屉(MobileNavDrawer)改由 EditorPage 注入,统一与主页/创作/画布列表保持一致。
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Bot, BookOpen, Undo2, Redo2, Keyboard, Users,
  MessageSquareMore, History, Save, SquareMousePointer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Button as AntdButton, Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { AppearanceDialog, ShortcutsDialog, LanguageSwitcher } from '@/shared/components/index.js';
import type { GridStyle } from '@/shared/components/index.js';
import { TitleEditor } from './title-editor.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import type { ShortcutEntry } from '@zeroexo/plugin-keyboard';

/** 换肤图标(sun-moon),与主页 AppTopBar 保持同一图标,体现"同一组件变体" */
function SunMoonIcon(): React.ReactElement {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v2" />
      <path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715" />
      <path d="M16 12a4 4 0 0 0-4-4" />
      <path d="m19 5-1.256 1.256" />
      <path d="M20 12h2" />
    </svg>
  );
}

export interface TopBarProps {
  title: string;
  titleDraft: string;
  isTitleEditing: boolean;
  onTitleDraftChange: (v: string) => void;
  onStartTitleEditing: () => void;
  onFinishTitleEditing: () => void;
  onCancelTitleEditing: () => void;
  agentOpen: boolean;
  onToggleAgent: () => void;
  /** 网格样式(由 AppearancePanel 控制,透传给 CanvasView) */
  gridStyle: GridStyle;
  onGridStyleChange: (style: GridStyle) => void;
  /** 打开设置弹窗 */
  onOpenSettings: () => void;
  isMobile?: boolean;
  /** 云同步状态徽章(渲染在标题右侧,垂直居中对齐) */
  syncBadge?: React.ReactNode;
  /** Bug3: 撤销/重做(移到 topbar,云同步旁) */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** LOGO下拉菜单(画布编辑器左上角,桌面端显示) */
  canvasMenu?: React.ReactNode;
  /** 移动端导航按钮打开 */
  onMobileNavOpen?: () => void;
  /** 打开协作弹窗 */
  onOpenCollaboration?: () => void;
  /** 打开协作聊天面板 */
  onOpenCollaborationDock?: () => void;
  /** 打开保存版本弹窗 */
  onSaveVersion?: () => void;
  /** 打开版本历史面板 */
  onOpenVersionHistory?: () => void;
  /** 快捷键注册表(键盘插件实例;透传给快捷键弹窗自动映射) */
  keyboardShortcuts?: readonly ShortcutEntry[];
}

export function TopBar({
  title,
  titleDraft,
  isTitleEditing,
  onTitleDraftChange,
  onStartTitleEditing,
  onFinishTitleEditing,
  onCancelTitleEditing,
  agentOpen,
  onToggleAgent,
  gridStyle,
  onGridStyleChange,
  onOpenSettings,
  isMobile,
  syncBadge,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canvasMenu,
  onOpenCollaboration,
  onOpenCollaborationDock,
  onSaveVersion,
  onOpenVersionHistory,
  keyboardShortcuts,
}: TopBarProps): React.ReactElement {
  const { theme, mode } = useTheme();
  const { t } = useTranslation();
  const isMobileAuto = useIsMobile();
  const mobile = isMobile ?? isMobileAuto;
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 54,
    padding: mobile ? '0 12px' : '0 16px',
    background: 'transparent',
    borderBottom: 'none',
  };

  const leftStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: mobile ? 8 : 12,
    minWidth: 0,
  };

  const rightStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  };

  /** 与主页导航一致的图标按钮样式(32x32) */
  const iconBtnInHeader: CSSProperties = {
    width: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    fontSize: 16,
    color: theme.toolbar.text,
  };

  const undoRedoBtnStyle = (enabled: boolean): CSSProperties => ({
    ...iconBtnInHeader,
    opacity: enabled ? 0.6 : 0.25,
    cursor: enabled ? 'pointer' : 'default',
  });

  /** 文档按钮:文档即将上线,先占位 */
  const handleOpenDocs = (): void => {
    // 文档即将上线,先占位(入口保留,便于后续接入文档站点)
  };

  /** 版本快照下拉:保存版本 + 版本历史 */
  const versionItems: MenuProps['items'] = [
    { key: 'save', icon: <Save size={14} />, label: t('topbar.saveVersion') },
    { key: 'history', icon: <History size={14} />, label: t('topbar.versionHistory') },
  ];
  const onVersionMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'save') onSaveVersion?.();
    else if (key === 'history') onOpenVersionHistory?.();
  };

  return (
    <div style={barStyle}>
      <div style={leftStyle}>
        {!mobile && canvasMenu}
        <TitleEditor
          theme={theme}
          title={title}
          titleDraft={titleDraft}
          isTitleEditing={isTitleEditing}
          onTitleDraftChange={onTitleDraftChange}
          onStartTitleEditing={onStartTitleEditing}
          onFinishTitleEditing={onFinishTitleEditing}
          onCancelTitleEditing={onCancelTitleEditing}
        />
        {/* 撤销/重做 */}
        <Tooltip title={t('topbar.undo')}>
          <AntdButton
            type="text"
            icon={<Undo2 size={16} />}
            disabled={!canUndo}
            onClick={onUndo}
            style={undoRedoBtnStyle(canUndo)}
          />
        </Tooltip>
        <Tooltip title={t('topbar.redo')}>
          <AntdButton
            type="text"
            icon={<Redo2 size={16} />}
            disabled={!canRedo}
            onClick={onRedo}
            style={undoRedoBtnStyle(canRedo)}
          />
        </Tooltip>
        {/* 保存状态指示器(标题旁,与创作页统一) */}
        {syncBadge}
      </div>
      <div style={rightStyle}>
        {/* 桌面端:外观设置 + 文档/快捷键/语言/配置 + 版本快照 */}
        {!mobile && (
          <>
            {/* 外观设置(与主页换肤为同一组件变体,文案一致) */}
            <Tooltip title={t('topbar.appearance')}>
              <AntdButton
                type="text"
                icon={<SunMoonIcon />}
                onClick={() => setAppearanceOpen(true)}
                style={iconBtnInHeader}
              />
            </Tooltip>

            {/* 文档(即将上线,先占位) */}
            <Tooltip title={t('topbar.docsComingSoon')}>
              <AntdButton
                type="text"
                icon={<BookOpen size={16} />}
                onClick={handleOpenDocs}
                style={iconBtnInHeader}
              />
            </Tooltip>

            {/* 快捷键 */}
            <Tooltip title={t('menu.shortcuts')}>
              <AntdButton
                type="text"
                icon={<Keyboard size={16} />}
                onClick={() => setShortcutsOpen(true)}
                style={iconBtnInHeader}
              />
            </Tooltip>

            {/* 中英文切换(与主页同款 LanguageSwitcher:Globe 图标 + 语言弹窗) */}
            <LanguageSwitcher theme={theme} />

            {/* 配置(图标 square-mouse-pointer) */}
            <Tooltip title={t('settings.title')}>
              <AntdButton
                type="text"
                icon={<SquareMousePointer size={16} />}
                onClick={onOpenSettings}
                style={iconBtnInHeader}
              />
            </Tooltip>

            {/* 版本快照:保存版本 + 版本历史(合并下拉) */}
            <Dropdown menu={{ items: versionItems, onClick: onVersionMenuClick }} placement="bottomRight" trigger={['click']}>
              <Tooltip title={t('topbar.versionHistory')}>
                <AntdButton
                  type="text"
                  icon={<History size={16} />}
                  style={iconBtnInHeader}
                />
              </Tooltip>
            </Dropdown>
          </>
        )}

        {/* 换肤居中弹窗(桌面端) */}
        {appearanceOpen ? (
          <AppearanceDialog
            theme={theme}
            currentMode={mode}
            gridStyle={gridStyle}
            onGridStyleChange={onGridStyleChange}
            onClose={() => setAppearanceOpen(false)}
          />
        ) : null}

        {/* 协作 + Agent(桌面端;账号/退出已移入左上角 CanvasMenu) */}
        {!mobile && (
          <>
            {/* 协作(仅登录用户;未登录时点击引导登录) */}
            <Tooltip title={t('topbar.collaboration')}>
              <AntdButton
                type="text"
                icon={<Users size={16} />}
                onClick={() => onOpenCollaboration?.()}
                style={iconBtnInHeader}
              />
            </Tooltip>
            {/* 协作聊天面板 */}
            <Tooltip title={t('topbar.collaborationChat')}>
              <AntdButton
                type="text"
                icon={<MessageSquareMore size={16} />}
                onClick={() => onOpenCollaborationDock?.()}
                style={iconBtnInHeader}
              />
            </Tooltip>
            {/* Agent 面板开关 */}
            <Tooltip title={t('topbar.toggleAgent')}>
              <AntdButton
                type="text"
                icon={<Bot size={16} />}
                onClick={onToggleAgent}
                style={{
                  ...iconBtnInHeader,
                  color: agentOpen ? theme.toolbar.accent : theme.toolbar.text,
                }}
              />
            </Tooltip>
          </>
        )}
      </div>

      {/* 快捷键对话框 */}
      {shortcutsOpen ? (
        <ShortcutsDialog
          theme={theme}
          onClose={() => setShortcutsOpen(false)}
          shortcuts={keyboardShortcuts}
        />
      ) : null}
    </div>
  );
}
