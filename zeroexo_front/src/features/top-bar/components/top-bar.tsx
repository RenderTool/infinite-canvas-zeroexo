/**
 * TopBar - 顶部工具栏容器(画布编辑器专用)
 *
 * 左侧:LOGO 下拉(征集 #91:层级/资产按钮迁至底部工具栏小地图旁,LOGO 旁分割线删除);
 * 右侧:可编辑标题(compact 13px 右对齐)+ 外观设置 + 语言/配置 + 版本快照 + 协作 + Agent。
 * 账号信息与退出登录已移入左上角 CanvasMenu。
 * 主题由 useTheme() 注入;外观浮层开关内部管理;设置弹窗由父组件控制(通过 onOpenSettings)。
 * 左侧 padding 预留 CanvasControls(左上角竖向控件)的宽度,避免重叠。
 *
 * 移动端仅渲染层级按钮 + 标题 + 同步徽标(精简视图);
 * 移动端导航抽屉(MobileNavDrawer)改由 EditorPage 注入,统一与主页/创作/画布列表保持一致。
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Bot, Users, Package, PackageOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Badge, Button as AntdButton, Tooltip } from 'antd';
import { useCollaborationStore } from '@/features/collaboration/use-collaboration-store.js';
import { useCanvasAgentStore } from '@/features/canvas-agent/ui/store.js';
import { useReadOnly } from '@/shared/readonly-context.js';
import type { GridStyle } from '@/shared/components/index.js';
import { AppearanceDialog } from '@/shared/components/index.js';
import { TitleEditor } from './title-editor.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { CanvasTabBar } from '@/features/canvas-tabs/canvas-tab-bar.js';

export interface TopBarProps {
  title: string;
  titleDraft: string;
  isTitleEditing: boolean;
  /** 标题是否可编辑(参与者只读,默认 true) */
  titleEditable?: boolean;
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
  /** LOGO下拉菜单(画布编辑器左上角,桌面端显示) */
  canvasMenu?: React.ReactNode;
  /** 移动端导航按钮打开 */
  onMobileNavOpen?: () => void;
  /** 打开协作(版本历史+协作 管理抽屉,默认协作 Tab) */
  onOpenCollaboration?: () => void;
  /** 层级/资产抽屉(资产任何时刻可打开,2026-08-29 迁至标题旁) */
  isHierarchyOpen?: boolean;
  onToggleHierarchy?: () => void;
}

export function TopBar({
  title,
  titleDraft,
  isTitleEditing,
  titleEditable = true,
  onTitleDraftChange,
  onStartTitleEditing,
  onFinishTitleEditing,
  onCancelTitleEditing,
  agentOpen,
  onToggleAgent,
  isMobile,
  syncBadge,
  canvasMenu,
  gridStyle,
  onGridStyleChange,
  onOpenCollaboration,
  isHierarchyOpen,
  onToggleHierarchy,
}: TopBarProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const isMobileAuto = useIsMobile();
  const mobile = isMobile ?? isMobileAuto;
  // 未读提醒红点：协作按钮=待审申请数+新成员加入数（房主）；Agent 按钮=协作未读+对话未读总数（dock 关闭时也能看到）
  const pendingApprovals = useCollaborationStore((s) => s.pendingApprovals);
  const newMemberCount = useCollaborationStore((s) => s.newMemberCount);
  const unreadMessages = useCollaborationStore((s) => s.unreadMessages);
  const agentUnread = useCanvasAgentStore((s) => s.agentUnread);
  // 外观设置弹窗(高频操作,自 LOGO 下拉移回顶栏:2026-08-29 用户拍板)
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 45,
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

  /** 可编辑标题(compact 13px;桌面端右侧组,移动端居中容器) */
  const titleEditor = (
    <TitleEditor
      compact
      theme={theme}
      title={title}
      titleDraft={titleDraft}
      isTitleEditing={isTitleEditing}
      editable={titleEditable}
      onTitleDraftChange={onTitleDraftChange}
      onStartTitleEditing={onStartTitleEditing}
      onFinishTitleEditing={onFinishTitleEditing}
      onCancelTitleEditing={onCancelTitleEditing}
    />
  );

  return (
    <>
    <div style={barStyle}>
      <div style={leftStyle}>
        {!mobile && canvasMenu}
        {/* 征集 #92 T26 验收修正二(用户拍板):标题放 LOGO 旁(左侧),保存状态条(syncBadge,含「已保存」)放标题旁边 */}
        {!mobile && (
          <>
            {titleEditor}
            {/* 资产(任何时刻可打开,2026-08-29 迁至标题旁) */}
            {onToggleHierarchy && (
              <Tooltip title={t(isHierarchyOpen ? 'canvasControls.hierarchyOpen' : 'canvasControls.hierarchyClosed')}>
                <AntdButton
                  type="text"
                  icon={isHierarchyOpen ? <PackageOpen size={16} /> : <Package size={16} />}
                  onClick={onToggleHierarchy}
                  style={{
                    ...iconBtnInHeader,
                    color: isHierarchyOpen ? theme.toolbar.accent : theme.toolbar.text,
                  }}
                />
              </Tooltip>
            )}
            {syncBadge}
          </>
        )}
        {/* Plan#50 修正(用户拍板):页签条放标题旁边同一行(占中间剩余空间),不是 NAV 下方独立行 */}
        {/* 2026-08-29 修复:仅桌面端渲染——移动端下方分支已单独渲染 CanvasTabBar,此处无条件渲染会双重页签 */}
        {!mobile && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <CanvasTabBar />
          </div>
        )}
      </div>
      {/* 移动端:标题 + 同步徽标居中(征集 #87 验收轮十八);页签条同行(标题旁,占剩余空间) */}
      {mobile && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
          {titleEditor}
          {onToggleHierarchy && (
            <Tooltip title={t(isHierarchyOpen ? 'canvasControls.hierarchyOpen' : 'canvasControls.hierarchyClosed')}>
              <AntdButton
                type="text"
                icon={isHierarchyOpen ? <PackageOpen size={16} /> : <Package size={16} />}
                onClick={onToggleHierarchy}
                style={{
                  ...iconBtnInHeader,
                  color: isHierarchyOpen ? theme.toolbar.accent : theme.toolbar.text,
                }}
              />
            </Tooltip>
          )}
          {syncBadge}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <CanvasTabBar />
          </div>
        </div>
      )}
      <div style={rightStyle}>
        {/* 协作 + Agent(桌面端;账号/退出已移入左上角 CanvasMenu) */}
        {!mobile && (
          <>
            {/* 外观(高频操作,2026-08-29 移回顶栏协作按钮旁;图标与主页 TopNav 换肤按钮同款) */}
            <Tooltip title={t('topbar.appearance')}>
              <AntdButton
                type="text"
                icon={
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2"/><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715"/><path d="M16 12a4 4 0 0 0-4-4"/><path d="m19 5-1.256 1.256"/><path d="M20 12h2"/></svg>
                }
                onClick={() => setAppearanceOpen(true)}
                style={iconBtnInHeader}
              />
            </Tooltip>
            {/* 协作(版本历史+协作 管理抽屉入口;待审申请+新成员加入红点：抽屉同步真实列表后覆盖，批准/拒绝/查看成员后自动移除) */}
            <Tooltip title={t('topbar.collaboration')}>
              <Badge count={pendingApprovals + newMemberCount} size="small" overflowCount={99} offset={[2, -2]}>
                <AntdButton
                  type="text"
                  icon={<Users size={16} />}
                  onClick={() => onOpenCollaboration?.()}
                  style={iconBtnInHeader}
                />
              </Badge>
            </Tooltip>
            {/* R2-8: 协作聊天面板入口已移除（并入 AgentDock 页签，避免 Nav 双入口） */}
            {/* Agent 面板开关；未读红点=协作聊天未读+对话未读（dock 关闭时也可感知新消息；切到对应页签后归零）
                只读隐藏（2026-08-25 系统性只读防护）：Agent 唯一用途是执行画布写操作，viewer 不可用 */}
            {!readOnly && (
              <Tooltip title={t('topbar.toggleAgent')}>
                <Badge count={unreadMessages + agentUnread} size="small" overflowCount={99} offset={[2, -2]}>
                  <AntdButton
                    type="text"
                    icon={<Bot size={16} />}
                    onClick={onToggleAgent}
                    style={{
                      ...iconBtnInHeader,
                      color: agentOpen ? theme.toolbar.accent : theme.toolbar.text,
                    }}
                  />
                </Badge>
              </Tooltip>
            )}
          </>
        )}
      </div>

    </div>

    {/* 外观设置弹窗(高频操作,2026-08-29 移回顶栏) */}
    {appearanceOpen ? (
      <AppearanceDialog
        theme={theme}
        currentMode={theme.mode}
        gridStyle={gridStyle}
        onGridStyleChange={onGridStyleChange}
        onClose={() => setAppearanceOpen(false)}
      />
    ) : null}
    </>
  );
}
