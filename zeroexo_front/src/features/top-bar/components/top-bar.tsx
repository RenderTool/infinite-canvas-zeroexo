/**
 * TopBar - 顶部工具栏容器(画布编辑器专用)
 *
 * 左侧:可编辑标题(CanvasMenu 已移至 CanvasControls 的 menuSlot);
 * 右侧:画布外观(Palette 浮层)+ 文档 + 语言切换 + 设置 + Agent 按钮。
 * 主题由 useTheme() 注入;外观浮层开关内部管理;设置弹窗由父组件控制(通过 onOpenSettings)。
 * 左侧 padding 预留 CanvasControls(左上角竖向控件)的宽度,避免重叠。
 *
 * 移动端仅渲染标题 + 撤销/重做 + 同步徽标(精简视图);
 * 移动端导航抽屉(MobileNavDrawer)改由 EditorPage 注入,统一与主页/创作/画布列表保持一致。
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Bot, BookOpen, Settings2, Undo2, Redo2, Keyboard, LogOut, Users, MessageSquare, History, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Button as AntdButton, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { AppearanceDialog, ShortcutsDialog } from '@/shared/components/index.js';
import type { GridStyle } from '@/shared/components/index.js';
import { useAuth } from '../../auth/auth-store.js';
import { TitleEditor } from './title-editor.js';
import { LanguageSwitcher } from '@/shared/components/language-switcher.js';
import { AiModelPicker } from './ai-model-picker.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';

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
  /** 切换协作聊天/成员面板(Dock) */
  onOpenCollaborationDock?: () => void;
  /** 打开保存版本弹窗 */
  onSaveVersion?: () => void;
  /** 打开版本历史面板 */
  onOpenVersionHistory?: () => void;
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
}: TopBarProps): React.ReactElement {
  const { theme, mode } = useTheme();
  const { t } = useTranslation();
  const isMobileAuto = useIsMobile();
  const mobile = isMobile ?? isMobileAuto;
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

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

  const dividerStyle: CSSProperties = {
    width: 1,
    height: 24,
    background: theme.toolbar.border,
  };

  /** 移动端导航按钮(已移除,改用统一浮动按钮,由 EditorPage 注入) */
  const mobileNavBtn = null;

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

  return (
    <div style={barStyle}>
      <div style={leftStyle}>
        {/* 移动端导航按钮(在 Nav 中,非浮动) */}
        {mobileNavBtn}
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
        <AntdButton
          type="text"
          icon={<Undo2 size={16} />}
          disabled={!canUndo}
          onClick={onUndo}
          title={t('topbar.undo')}
          style={undoRedoBtnStyle(canUndo)}
        />
        <AntdButton
          type="text"
          icon={<Redo2 size={16} />}
          disabled={!canRedo}
          onClick={onRedo}
          title={t('topbar.redo')}
          style={undoRedoBtnStyle(canRedo)}
        />
        {/* 保存状态指示器(标题旁,与创作页统一) */}
        {syncBadge}
      </div>
      <div style={rightStyle}>
        {/* 桌面端:画布外观 + 文档 + 快捷键 + 语言切换 + 设置 + Agent + 用户头像 */}
        {!mobile && (
          <>
            {/* 画布外观 */}
            <AntdButton
              type="text"
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v2"/>
                  <path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/>
                  <path d="M16 12a4 4 0 0 0-4-4"/>
                  <path d="m19 5-1.256 1.256"/>
                  <path d="M20 12h2"/>
                </svg>
              }
              onClick={() => setAppearanceOpen(true)}
              title={t('topbar.appearance')}
              style={iconBtnInHeader}
            />

            {/* 文档 */}
            <AntdButton
              type="text"
              icon={<BookOpen size={16} />}
              href="#"
              title={t('topbar.docsComingSoon')}
              style={iconBtnInHeader}
            />

            {/* 快捷键 */}
            <AntdButton
              type="text"
              icon={<Keyboard size={16} />}
              onClick={() => setShortcutsOpen(true)}
              title={t('menu.shortcuts')}
              style={iconBtnInHeader}
            />

            {/* 语言切换 */}
            <LanguageSwitcher theme={theme} />
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

        {/* 设置 + Agent + 用户头像(桌面端) */}
        {!mobile && (
          <>
            <AntdButton
              type="text"
              icon={<Settings2 size={16} />}
              onClick={() => onOpenSettings()}
              title={t('settings.title')}
              style={iconBtnInHeader}
            />
            {/* 版本快照:保存版本 + 版本历史 */}
            <AntdButton
              type="text"
              icon={<Save size={16} />}
              onClick={() => onSaveVersion?.()}
              title={t('topbar.saveVersion')}
              style={iconBtnInHeader}
            />
            <AntdButton
              type="text"
              icon={<History size={16} />}
              onClick={() => onOpenVersionHistory?.()}
              title={t('topbar.versionHistory')}
              style={iconBtnInHeader}
            />
            {/* 协作(仅登录用户;未登录时点击引导登录) */}
            <AntdButton
              type="text"
              icon={<Users size={16} />}
              onClick={() => onOpenCollaboration?.()}
              title={t('topbar.collaboration')}
              style={iconBtnInHeader}
            />
            {/* 协作聊天/成员面板(Dock) */}
            <AntdButton
              type="text"
              icon={<MessageSquare size={16} />}
              onClick={() => onOpenCollaborationDock?.()}
              title={t('topbar.collaborationChat')}
              style={iconBtnInHeader}
            />
            <span style={dividerStyle} />
            <AiModelPicker />
            <AntdButton
              type="text"
              icon={<Bot size={16} />}
              onClick={onToggleAgent}
              title={t('topbar.toggleAgent')}
              style={{
                ...iconBtnInHeader,
                color: agentOpen ? theme.toolbar.accent : theme.toolbar.text,
              }}
            />
            <span style={dividerStyle} />
            <UserAvatarSection theme={theme} userMenuOpen={userMenuOpen} setUserMenuOpen={setUserMenuOpen} />
          </>
        )}
      </div>

      {/* 快捷键对话框 */}
      {shortcutsOpen ? (
        <ShortcutsDialog
          theme={theme}
          onClose={() => setShortcutsOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ── 用户头像 + 退出登录 ──

function UserAvatarSection({
  theme,
  userMenuOpen,
  setUserMenuOpen,
}: {
  theme: ReturnType<typeof useTheme>['theme'];
  userMenuOpen: boolean;
  setUserMenuOpen: (open: boolean) => void;
}): React.ReactElement | null {
  const { user, isAuthenticated, logout } = useAuth();
  const { t } = useTranslation();

  if (!isAuthenticated || !user) return null;

  const userItems: MenuProps['items'] = [
    { key: 'logout', label: t('auth.logout'), icon: <LogOut size={14} />, danger: true, onClick: () => { setUserMenuOpen(false); logout(); } },
  ];

  return (
    <Dropdown
      open={userMenuOpen}
      onOpenChange={setUserMenuOpen}
      menu={{ items: userItems }}
    >
      <AntdButton
        type="text"
        style={{
          height: 32,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 4px',
          cursor: 'pointer',
        }}
      >
        <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.text, flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path key="body" d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
            <circle key="head" cx="12" cy="7" r="4"/>
          </svg>
        </span>
      </AntdButton>
    </Dropdown>
  );
}
