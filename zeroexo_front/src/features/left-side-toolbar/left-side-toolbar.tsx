/**
 * LeftSideToolBar - 画布工具栏(征集 #87 验收轮:默认统一底部横向布局)
 *
 * 布局(默认 'bottom',桌面/移动端一致 —— 移动端行为即默认行为):
 * - 底部居中悬浮条,与右下角缩放组件(ZoomToolbar)同款底色(半透明黑 + 毛玻璃)
 * - 按钮顺序(征集 #92:缩放百分比回归底部条,复刻 v1.1.0 原版形态):
 *   [小地图 / 缩放%] ┃ [层级资产(#91 自顶栏迁入) / 模式切换 / 清空画布] ┃ [加号(最右,单独隔开)]
 * - 加号创建菜单向上弹出(对齐按钮右缘)
 * - 缩放控件已移除(由画布右下角 ZoomToolbar 承担,征集 #87 验收轮)
 *
 * 预留接口:layout='left' 恢复改造前的竖向布局(桌面左缘垂直居中 / 移动端底部横向),
 * 当前不再使用,仅保留切回能力。
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
import { useReadOnly } from '@/shared/readonly-context.js';
import {
  Map,
  PackageOpen,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Hand,
  MousePointer2,
  Plus,
} from 'lucide-react';

export interface LeftSideToolBarProps {
  /** 缩放值(征集 #87 验收轮:缩放控件已移除,仅为旧调用方保留接口) */
  scale: number;
  onScaleChange: (scale: number) => void;
  isMiniMapOpen: boolean;
  onToggleMiniMap: () => void;
  /** 层级/资产抽屉开关(征集 #91:自顶栏 LOGO 侧迁入底部条;缺省不渲染按钮) */
  isHierarchyOpen?: boolean;
  onToggleHierarchy?: () => void;
  /** 征集 #96:清空画布按钮已移除,接口保留供旧调用方透传(不再消费) */
  onClear?: () => void;
  interactionMode: 'select' | 'pan';
  onToggleInteractionMode: () => void;
  isMobile?: boolean;
  /** 添加节点回调(点击加号菜单项时触发) */
  onAddNode: (type: AddNodeType) => void;
  /** 布局:bottom = 底部横向悬浮条(默认,双端一致);left = 旧版竖向布局(预留切回,当前不使用) */
  layout?: 'bottom' | 'left';
}

interface LeftSideToolBarViewProps extends LeftSideToolBarProps {
  theme: ThemeConfig;
}

/** 缩放边界(v1.1.0 原版契约) */
const MAX_SCALE = 5;
const MIN_SCALE = 0.05;

/** 底部悬浮条按钮文字色(与 ZoomToolbar 同款) */
const BAR_TEXT = 'rgba(255,255,255,0.85)';
/** 底部悬浮条底色(与画布右下角缩放组件同款:半透明黑 + 毛玻璃) */
const bottomBarStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 2,
  padding: '4px 6px',
  borderRadius: 12,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
  pointerEvents: 'auto',
};

function LeftSideToolBarView({
  scale,
  onScaleChange,
  isMiniMapOpen,
  onToggleMiniMap,
  isHierarchyOpen,
  onToggleHierarchy,
  interactionMode,
  onToggleInteractionMode,
  isMobile,
  onAddNode,
  theme,
  layout = 'bottom',
}: LeftSideToolBarViewProps): React.ReactElement {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const [zoomOpen, setZoomOpen] = useState(false);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [addNodePos, setAddNodePos] = useState<{ x: number; y: number }>({ x: 56, y: 72 });
  const plusButtonRef = useRef<HTMLElement>(null);
  const percent = Math.round(scale * 100);
  const isPan = interactionMode === 'pan';

  const isBottom = layout === 'bottom';

  // 底部条内的竖向分隔线
  const dividerStyle: CSSProperties = {
    width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.15)', flexShrink: 0, margin: '0 2px',
  };

  // 底部条按钮样式(32×32,与顶栏按钮组同尺寸)
  const barBtnStyle = (active = false): CSSProperties => ({
    width: 32, height: 32, padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: active ? theme.toolbar.accent : BAR_TEXT,
    background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
    borderRadius: 8,
  });

  // ===== 缩放百分比下拉(v1.1.0 原版形态复刻,征集 #92) =====
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
    { key: '50', label: '50%', onClick: () => onScaleChange(0.5) },
    { key: '100', label: '100%', onClick: () => onScaleChange(1) },
    { key: '500', label: '500%', onClick: () => onScaleChange(5) },
    { type: 'divider' },
    {
      key: 'fit',
      label: t('canvasControls.fitScreen'),
      icon: <Maximize2 size={14} />,
      onClick: () => onScaleChange(1),
    },
  ];

  // 缩放下拉触发器(无下拉箭头,点击弹出菜单;黑底白字体系用 BAR_TEXT)
  const zoomTrigger = (
    <div
      className="zx-toolbar-btn"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 48,
        height: 32,
        padding: '0 6px',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
        color: BAR_TEXT,
        background: 'transparent',
        border: 'none',
        userSelect: 'none',
      }}
    >
      <span>{percent}%</span>
    </div>
  );

  // 加号按钮(只读隐藏:创建节点是核心编辑入口)
  // 菜单位置:底部布局统一向上弹出,右缘对齐按钮(加号在条最右,防菜单溢出屏幕)
  const plusButton = readOnly ? null : (
    <Tooltip title={t('toolbar.addNode')} theme={theme}>
      <Button
        ref={plusButtonRef as React.Ref<HTMLButtonElement>}
        type="text"
        onClick={() => {
          const el = plusButtonRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            if (isBottom) {
              setAddNodePos({ x: rect.right - 200, y: rect.top - 8 });
            } else if (isMobile) {
              // 旧版布局移动端:菜单在按钮上方弹出
              setAddNodePos({ x: rect.left, y: rect.top - 8 });
            } else {
              // 旧版布局桌面端:菜单顶部对齐按钮顶部,左侧紧贴按钮右侧
              setAddNodePos({ x: rect.right + 4, y: rect.top });
            }
          }
          setAddNodeOpen((v) => !v);
        }}
        aria-label={t('toolbar.more')}
        style={barBtnStyle()}
      >
        <Plus size={18} />
      </Button>
    </Tooltip>
  );

  // 加号菜单:使用通用 NodeCreateMenu 组件(底部布局显式向上弹出)
  const addNodePanel = addNodeOpen ? (
    <NodeCreateMenu
      position={addNodePos}
      onSelect={onAddNode}
      onClose={() => setAddNodeOpen(false)}
      theme={theme}
      alignUp={isBottom ? true : undefined}
    />
  ) : null;

  // ===== 底部布局(默认):双端一致的悬浮条 =====
  if (isBottom) {
    return (<>
      {/* zx-toolbar-btn hover 缩放动效(v1.1.0 原版同款,缩放触发器使用) */}
      <style>{`
        .zx-toolbar-btn { transition: transform 0.15s ease; }
        .zx-toolbar-btn:hover { transform: scale(1.1); }
      `}</style>
      <div style={bottomWrapperStyle}>
        <div style={bottomBarStyle} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {/* 小地图开关 */}
          <Tooltip title={isMiniMapOpen ? t('canvasControls.miniMapOpen') : t('canvasControls.miniMapClosed')} theme={theme}>
            <Button
              type="text"
              onClick={onToggleMiniMap}
              aria-label={isMiniMapOpen ? t('canvasControls.miniMapOpen') : t('canvasControls.miniMapClosed')}
              style={barBtnStyle(isMiniMapOpen)}
            >
              <Map size={18} />
            </Button>
          </Tooltip>
          {/* 缩放百分比下拉(征集 #92:v1.1.0 原版形态回归,紧邻小地图) */}
          <Dropdown
            open={zoomOpen}
            onOpenChange={setZoomOpen}
            menu={{ items: zoomItems }}
            placement="top"
          >
            {zoomTrigger}
          </Dropdown>
          {/* 分割线:缩放组与右侧功能组隔开(征集 #92 用户拍板) */}
          <div style={dividerStyle} />
          {/* 层级/资产开关(征集 #91:自顶栏 LOGO 侧迁入;激活态 = 抽屉开,accent 高亮) */}
          {onToggleHierarchy && (
            <Tooltip title={t(isHierarchyOpen ? 'canvasControls.hierarchyOpen' : 'canvasControls.hierarchyClosed')} theme={theme}>
              <Button
                type="text"
                onClick={onToggleHierarchy}
                aria-label={t(isHierarchyOpen ? 'canvasControls.hierarchyOpen' : 'canvasControls.hierarchyClosed')}
                style={barBtnStyle(!!isHierarchyOpen)}
              >
                {/* 征集 #96:图标改 lucide package-open(资产库语义) */}
                <PackageOpen size={18} />
              </Button>
            </Tooltip>
          )}
          {/* 模式切换(select/pan) */}
          <Tooltip title={isPan ? t('toolbar.pan') : t('toolbar.select')} theme={theme}>
            <Button
              type="text"
              onClick={onToggleInteractionMode}
              aria-label={isPan ? t('toolbar.pan') : t('toolbar.select')}
              style={barBtnStyle(isPan)}
            >
              {isPan ? <Hand size={18} /> : <MousePointer2 size={18} />}
            </Button>
          </Tooltip>
          {/* 征集 #96(Plan#49 T29):清空画布按钮移除(底部悬浮条只留 小地图/缩放/资产库/模式/加号) */}
          {/* 征集 #87 验收轮:加号移到最右,与清空画布单独隔开 */}
          {plusButton && (
            <>
              <div style={dividerStyle} />
              {plusButton}
            </>
          )}
        </div>
      </div>
      {/* 征集 #87 验收轮三(修复"无法正确上弹"根因):菜单必须渲染在带 transform 的 wrapper 之外——
          wrapper 的 translateX(-50%) 会使其内部 position:fixed 退化为相对 wrapper 定位(坐标基准漂移)
          并继承 pointerEvents:none(菜单点不动);移到外层兄弟节点后 fixed 正确参照视口 */}
      {addNodePanel}
    </>);
  }

  // ===== 旧版竖向布局(预留切回接口,当前不使用) =====
  const legacyWrapperStyle: CSSProperties = isMobile ? legacyMobileWrapperStyle : legacyDesktopWrapperStyle;
  const legacyDividerStyle: CSSProperties = isMobile
    ? { width: 1, height: 20, backgroundColor: 'rgba(128,128,128,0.2)', flexShrink: 0 }
    : { width: 20, height: 1, backgroundColor: 'rgba(128,128,128,0.2)' };
  const legacyGroupStyle: CSSProperties = isMobile
    ? { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }
    : { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 };

  return (<>
    <div
      style={legacyWrapperStyle}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={isMobile
        ? { display: 'flex', alignItems: 'center', minWidth: 0 }
        : { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, minHeight: 0 }}>
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          gap: 4,
          padding: 8,
          pointerEvents: 'auto',
        }}>
          {plusButton}
          <div style={legacyDividerStyle} />
          <div style={legacyGroupStyle}>
            <Tooltip title={isMiniMapOpen ? t('canvasControls.miniMapOpen') : t('canvasControls.miniMapClosed')} theme={theme}>
              <Button
                type="text"
                onClick={onToggleMiniMap}
                aria-label={isMiniMapOpen ? t('canvasControls.miniMapOpen') : t('canvasControls.miniMapClosed')}
                style={{ width: 32, height: 32, padding: 0, background: isMiniMapOpen ? 'rgba(255,255,255,0.1)' : undefined }}
              >
                <Map size={18} />
              </Button>
            </Tooltip>
          </div>
          <div style={legacyDividerStyle} />
          <div style={legacyGroupStyle}>
            <Tooltip title={isPan ? t('toolbar.pan') : t('toolbar.select')} theme={theme}>
              <Button type="text" onClick={onToggleInteractionMode} aria-label={isPan ? t('toolbar.pan') : t('toolbar.select')} style={{ width: 32, height: 32, padding: 0, background: isPan ? 'rgba(255,255,255,0.1)' : undefined }}>
                {isPan ? <Hand size={18} /> : <MousePointer2 size={18} />}
              </Button>
            </Tooltip>
            {/* 征集 #96:清空画布按钮移除(双端一致;legacy 布局同步清理) */}
          </div>
        </div>
      </div>
    </div>
    {/* 同底部布局:菜单渲染在带 transform 的旧版 wrapper 之外,避免 fixed 退化 */}
    {addNodePanel}
  </>);
}

export function LeftSideToolBar(props: LeftSideToolBarProps): React.ReactElement {
  const { theme } = useTheme();
  return <LeftSideToolBarView {...props} theme={theme} />;
}

// ===== 定位样式 =====

// 底部悬浮条:底部居中(双端一致;移动端留 Apple 安全区域)
// zIndex 200,确保向上弹出的创建菜单不被遮挡
const bottomWrapperStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: 'max(12px, env(safe-area-inset-bottom))',
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  pointerEvents: 'none',
};

// 旧版(预留):桌面端左缘垂直居中,从顶栏下方开始
const legacyDesktopWrapperStyle: CSSProperties = {
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

// 旧版(预留):移动端底部横向居中
const legacyMobileWrapperStyle: CSSProperties = {
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
