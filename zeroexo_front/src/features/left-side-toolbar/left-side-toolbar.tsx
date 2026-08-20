/**
 * LeftSideToolBar - 画布左侧工具栏(竖向布局)
 *
 * 布局结构(桌面端,从上到下):
 * - LOGO slot(始终在顶部,由父组件传入)
 * - 工具区(垂直居中于 100vh - header):
 *   - 加号按钮(最上方,透明按钮样式,点击弹出 ConnectionDropMenu 同款创建面板)
 *   - 分隔线
 *   - 上半部分:模式切换 / 撤销 / 重做 / 清空画布 / 我的素材
 *   - 分隔线
 *   - 缩放百分比(点击弹出下拉菜单,无下拉箭头) / 重置视图
 *   - 分隔线
 *   - 小地图开关 / 画布结构开关
 *
 * 移动端:LOGO slot 不渲染,工具栏底部横向居中。
 *
 * 受控模式:所有状态和回调由父组件管理;主题由 useTheme() 注入。
 */

import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTheme } from '@zeroexo/plugin-theme';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { Tooltip, NodeCreateMenu } from '@/shared/components/index.js';
import type { AddNodeType } from '@/shared/components/index.js';
import {
  Map,
  FolderTree,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eraser,
  TentTree,
  Hand,
  MousePointer2,
  Plus,
} from 'lucide-react';

export interface LeftSideToolBarProps {
  scale: number;
  onScaleChange: (scale: number) => void;
  isMiniMapOpen: boolean;
  onToggleMiniMap: () => void;
  isHierarchyOpen: boolean;
  onToggleHierarchy: () => void;
  onClear: () => void;
  onOpenMyAssets: () => void;
  interactionMode: 'select' | 'pan';
  onToggleInteractionMode: () => void;
  isMobile?: boolean;
  /** 添加节点回调(点击加号菜单项时触发) */
  onAddNode: (type: AddNodeType) => void;
}

interface LeftSideToolBarViewProps extends LeftSideToolBarProps {
  theme: ThemeConfig;
}

const MAX_SCALE = 5;
const MIN_SCALE = 0.05;

function LeftSideToolBarView({
  scale,
  onScaleChange,
  isMiniMapOpen,
  onToggleMiniMap,
  isHierarchyOpen,
  onToggleHierarchy,
  onClear,
  onOpenMyAssets,
  interactionMode,
  onToggleInteractionMode,
  isMobile,
  onAddNode,
  theme,
}: LeftSideToolBarViewProps): React.ReactElement {
  const { t } = useTranslation();
  const [zoomOpen, setZoomOpen] = useState(false);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [addNodePos, setAddNodePos] = useState<{ x: number; y: number }>({ x: 56, y: 72 });
  const plusButtonRef = useRef<HTMLElement>(null);
  const percent = Math.round(scale * 100);
  const isPan = interactionMode === 'pan';
  const dividerBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  // 移动端:竖向分隔线;桌面端:横向分隔线
  const dividerStyle: CSSProperties = isMobile
    ? { width: 1, height: 20, backgroundColor: dividerBg, flexShrink: 0 }
    : { width: 20, height: 1, backgroundColor: dividerBg };

  const wrapperStyle: CSSProperties = isMobile ? mobileWrapperStyle : desktopWrapperStyle;
  const toolsWrapStyle: CSSProperties = isMobile
    ? { display: 'flex', alignItems: 'center', minWidth: 0 }
    : { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, minHeight: 0 };
  const innerDockStyle: CSSProperties = isMobile
    ? { ...dockStyle, flexDirection: 'row', flexWrap: 'nowrap', overflow: 'visible', maxWidth: '100%' }
    : dockStyle;

  // 桌面端工具区布局样式:每组垂直排列
  const sectionGroupStyle: CSSProperties = isMobile
    ? { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }
    : { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 };

  // 缩放下拉菜单 items
  const zoomItems: MenuProps['items'] = [
    {
      key: 'zoomIn',
      label: t('canvasControls.zoomIn'),
      icon: <ZoomIn size={14} />,
      onClick: () => onScaleChange(Math.min(scale * 1.25, MAX_SCALE)),
    },
    {
      key: 'zoomOut',
      label: t('canvasControls.zoomOut'),
      icon: <ZoomOut size={14} />,
      onClick: () => onScaleChange(Math.max(scale / 1.25, MIN_SCALE)),
    },
    { type: 'divider' },
    {
      key: '50',
      label: '50%',
      onClick: () => onScaleChange(0.5),
    },
    {
      key: '100',
      label: '100%',
      onClick: () => onScaleChange(1),
    },
    {
      key: '500',
      label: '500%',
      onClick: () => onScaleChange(5),
    },
    { type: 'divider' },
    {
      key: 'fit',
      label: t('canvasControls.fitScreen'),
      icon: <Maximize2 size={14} />,
      onClick: () => onScaleChange(1),
    },
  ];

  // 缩放下拉菜单触发器(无下拉箭头,点击弹出菜单)
  const zoomTrigger = (
    <div
      className="zx-toolbar-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 52,
        height: 36,
        padding: '0 8px',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
        color: theme.toolbar.text,
        background: 'transparent',
        border: 'none',
        userSelect: 'none',
      }}
    >
      <span>{percent}%</span>
    </div>
  );

  // 加号按钮(透明,和其他按钮一样样式)
  const plusButton = (
    <Tooltip title={t('toolbar.more')} theme={theme}>
      <Button
        ref={plusButtonRef as React.Ref<HTMLButtonElement>}
        type="text"
        onClick={() => {
          const el = plusButtonRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            if (isMobile) {
              // 移动端:菜单在按钮上方弹出
              setAddNodePos({ x: rect.left, y: rect.top - 8 });
            } else {
              // 桌面端:菜单顶部对齐按钮顶部,左侧紧贴按钮右侧
              setAddNodePos({ x: rect.right + 4, y: rect.top });
            }
          }
          setAddNodeOpen((v) => !v);
        }}
        aria-label={t('toolbar.more')}
        style={{ width: 32, height: 32, padding: 0, color: theme.toolbar.text }}
        className="zx-toolbar-btn"
      >
        <Plus size={18} />
      </Button>
    </Tooltip>
  );

  // 加号菜单:使用通用 NodeCreateMenu 组件,顶部对齐加号按钮向右下弹出
  const addNodePanel = addNodeOpen ? (
    <NodeCreateMenu
      position={addNodePos}
      onSelect={onAddNode}
      onClose={() => setAddNodeOpen(false)}
      theme={theme}
    />
  ) : null;

  return (<>
      <style>{`
        .zx-toolbar-btn { transition: transform 0.15s ease; }
        .zx-toolbar-btn:hover { transform: scale(1.1); }
      `}</style>
      <div
        style={wrapperStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
      {/* 工具区:桌面端垂直居中(TopBar 下方到底部),移动端横向排列 */}
      <div style={toolsWrapStyle}>
        <div style={innerDockStyle}>
          {/* ===== 加号按钮(最上方,透明按钮样式) ===== */}
          {plusButton}
          {addNodePanel}

          <div style={dividerStyle} />

          {/* ===== 组1: 我的资产 + 画布层级 ===== */}
          <div style={sectionGroupStyle}>
            {/* 我的资产(主页同款 TentTree 图标，征集#14) */}
            <Tooltip title={t('toolbar.myAssets')} theme={theme}>
              <Button type="text" onClick={onOpenMyAssets} aria-label={t('toolbar.myAssets')} className="zx-toolbar-btn" style={{ width: 32, height: 32, padding: 0 }}>
                <TentTree size={18} />
              </Button>
            </Tooltip>
            {/* 画布结构开关 */}
            <Tooltip title={isHierarchyOpen ? t('canvasControls.hierarchyOpen') : t('canvasControls.hierarchyClosed')} theme={theme}>
              <Button
                type="text"
                onClick={onToggleHierarchy}
                aria-label={isHierarchyOpen ? t('canvasControls.hierarchyOpen') : t('canvasControls.hierarchyClosed')}
                className="zx-toolbar-btn"
                style={{ width: 32, height: 32, padding: 0, background: isHierarchyOpen ? 'rgba(255,255,255,0.1)' : undefined }}
              >
                <FolderTree size={18} />
              </Button>
            </Tooltip>
          </div>

          <div style={dividerStyle} />

          {/* ===== 组2: 小地图 + 缩放百分比 ===== */}
          <div style={sectionGroupStyle}>
            {/* 小地图开关 */}
            <Tooltip title={isMiniMapOpen ? t('canvasControls.miniMapOpen') : t('canvasControls.miniMapClosed')} theme={theme}>
              <Button
                type="text"
                onClick={onToggleMiniMap}
                aria-label={isMiniMapOpen ? t('canvasControls.miniMapOpen') : t('canvasControls.miniMapClosed')}
                className="zx-toolbar-btn"
                style={{ width: 32, height: 32, padding: 0, background: isMiniMapOpen ? 'rgba(255,255,255,0.1)' : undefined }}
              >
                <Map size={18} />
              </Button>
            </Tooltip>
            {/* 缩放下拉菜单 */}
            <Dropdown
              open={zoomOpen}
              onOpenChange={setZoomOpen}
              menu={{ items: zoomItems }}
              placement={isMobile ? 'top' : 'right'}
            >
              {zoomTrigger}
            </Dropdown>
          </div>

          <div style={dividerStyle} />

          {/* ===== 组3: 其他(模式切换 + 清空) ===== */}
          <div style={sectionGroupStyle}>
            {/* 模式切换(select/pan) */}
            <Tooltip title={isPan ? t('toolbar.pan') : t('toolbar.select')} theme={theme}>
              <Button type="text" onClick={onToggleInteractionMode} aria-label={isPan ? t('toolbar.pan') : t('toolbar.select')} className="zx-toolbar-btn" style={{ width: 32, height: 32, padding: 0, background: isPan ? 'rgba(255,255,255,0.1)' : undefined }}>
                {isPan ? <Hand size={18} /> : <MousePointer2 size={18} />}
              </Button>
            </Tooltip>
            {/* 清空画布 */}
            <Tooltip title={t('toolbar.clear')} theme={theme}>
              <Button type="text" onClick={onClear} aria-label={t('toolbar.clear')} className="zx-toolbar-btn" style={{ width: 32, height: 32, padding: 0 }}>
                <Eraser size={18} />
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

export function LeftSideToolBar(props: LeftSideToolBarProps): React.ReactElement {
  const { theme } = useTheme();
  return <LeftSideToolBarView {...props} theme={theme} />;
}

// 桌面端:从 TopBar 下方开始(64px),竖向列,工具垂直居中
// pointerEvents:'none' 让空白区域不遮挡小地图,dock 内部恢复 'auto'
const desktopWrapperStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  top: 64,
  bottom: 0,
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
};

// 移动端:底部横向居中(留 Apple 安全区域)
// zIndex 提高到 200,确保下拉菜单(dropUp)不被 TopBar 等元素遮挡
const mobileWrapperStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  right: 'auto',
  top: 'auto',
  bottom: 'max(12px, env(safe-area-inset-bottom))',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  pointerEvents: 'none',
};

// dock 本身恢复 pointerEvents:'auto'(wrapper 设为 none 不遮挡小地图)
// gap 收紧到 4 以容纳更多节点快捷按钮
const dockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 8,
  background: 'transparent',
  border: 'none',
  boxShadow: 'none',
  pointerEvents: 'auto',
};