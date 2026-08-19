/**
 * NodeCapsuleToolbar - 跟随节点的磁贴工具栏(通用组件)
 *
 * 取代左侧 ToolsDock：选中节点/组/多选时，在节点下方渲染一个主题自适应的
 * 扁平磁贴(浅色 mode 白底深字 / 深色 mode 黑底浅字，无圆角)，随节点移动/视口缩放平移
 * 自动跟随。所有节点类型(图片/视频/剧本/文本/配置等)的工具都注册到磁贴上。
 *
 * 展示内容：
 * - 单选节点/组：该节点全部工具(ext.getTools / getGroupTools) + 层级聚合按钮
 * - 多选：成组/排列/尺寸聚合按钮(层级聚合暂隐藏)
 * - 预览组：确认/取消工具
 *
 * 位置计算：通过 useGraph/useViewport 订阅状态，锚点由宿主注入的 getAnchorBounds
 * 提供(处理组/预览组/多选包围盒)，未提供时回退到节点自身 position+size。
 *
 * 所有可见文本通过 i18n 获取，禁止硬编码。
 */

import React, { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useGraph, useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeRecord, NodeTypeExtension, ToolContext, ToolDefinition } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  Group, LayoutPanelLeft, LayoutGrid, Rows, Columns, GitBranch,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  Maximize2,
  Layers, ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, Scaling,
  Compass,
  LogOut,
  } from 'lucide-react';
import { NodeJoystickNav } from './node-joystick-nav.js';

export interface NodeCapsuleToolbarProps {
  nodeId: string | null;
  store: ReactGraphStore;
  getExtension: (nodeId: string) => NodeTypeExtension | undefined;
  toolContext: ToolContext;
  getGroupTools?: (node: NodeRecord, ctx: ToolContext) => ToolDefinition[];
  selectedCount: number;
  selectedHasGroup: boolean;
  /** 单选且有父组 → 显示"移出组"直达按钮 */
  showMoveOut?: boolean;
  onMoveOutGroup?: () => void;
  isPreview: boolean;
  isMixedSelection: boolean;
  /** 锚点包围盒(屏幕坐标计算用世界坐标)；处理组/预览组/多选包围盒 */
  getAnchorBounds?: () => { x: number; y: number; width: number; height: number } | null;
  node?: NodeRecord;
  onGroup: () => void;
  onUngroup: () => void;
  onArrangeGrid: () => void;
  onArrangeHorizontal: () => void;
  onArrangeVertical: () => void;
  onArrangeAuto: () => void;
  onAlign: (type: string) => void;
  onUnifySizes: (type: string) => void;
  onSort: (type: string) => void;
  isMobile?: boolean;
  /**
   * 纯图标模式开关
   * - true（默认）: 仅显示 icon，隐藏文本标签（语义保留在 title 悬浮提示）
   * - false: icon + 文本标签
   * 胶囊工具栏已全量统一为纯 icon（含分组工具），如需回退文案模式传 false。
   */
  usePureIcon?: boolean;
}

// ===== 工具 title i18n key 映射 =====
const TOOL_TITLE_I18N_KEY: Record<string, string> = {
  duplicate: 'toolTitles.duplicate',
  delete: 'toolTitles.delete',
  download: 'toolTitles.download',
  editText: 'toolTitles.editText',
  copyPrompt: 'toolTitles.copyPrompt',
  reversePrompt: 'toolTitles.reversePrompt',
  replace: 'toolTitles.replace',
  resize: 'toolTitles.resize',
  maskEdit: 'toolTitles.maskEdit',
  crop: 'toolTitles.crop',
  split: 'toolTitles.split',
  upscale: 'toolTitles.upscale',
  superResolve: 'toolTitles.superResolve',
  angle: 'toolTitles.angle',
  view: 'toolTitles.view',
  editImage: 'toolTitles.editImage',
  editConfig: 'toolTitles.editConfig',
  info: 'toolTitles.info',
  saveAsset: 'toolTitles.saveAsset',
  edit: 'toolTitles.edit',
  detail: 'toolTitles.detail',
  convertToStack: 'toolTitles.convertToStack',
  createStackNode: 'toolTitles.createStackNode',
  confirm: 'groupTools.confirmTitle',
  cancel: 'groupTools.cancelTitle',
  rename: 'groupTools.renameTitle',
  ungroup: 'groupTools.ungroupTitle',
  style: 'groupTools.styleTitle',
};

function resolveText(
  value: string | ((node: NodeRecord, ctx: ToolContext) => string),
  node: NodeRecord,
  ctx: ToolContext,
): string {
  return typeof value === 'function' ? value(node, ctx) : value;
}

function resolveIcon(
  icon: unknown | ((node: NodeRecord, ctx: ToolContext) => unknown),
  node: NodeRecord,
  ctx: ToolContext,
): React.ReactNode {
  return (typeof icon === 'function' ? icon(node, ctx) : icon) as React.ReactNode;
}

function normalizeIcon(icon: React.ReactNode, size: number = 16): React.ReactNode {
  if (React.isValidElement(icon)) {
    return React.cloneElement(icon, { size } as Record<string, unknown>);
  }
  return icon;
}

function getToolLabel(tool: ToolDefinition, node: NodeRecord, ctx: ToolContext, _t: TFunction): string {
  const label = resolveText(tool.label, node, ctx);
  if (label) return label;
  // 显式空 label 或未指定 label 且 id 为编辑类工具 → 纯图标按钮
  return '';
}

function getToolTitle(tool: ToolDefinition, node: NodeRecord, ctx: ToolContext, t: TFunction): string {
  const title = resolveText(tool.title, node, ctx);
  if (title) return title;
  if (tool.id === 'resize') {
    const data = node.data as { freeResize?: boolean } | null;
    return data?.freeResize ? t('toolsDock.resizeFree') : t('toolsDock.resize');
  }
  const i18nKey = TOOL_TITLE_I18N_KEY[tool.id];
  if (i18nKey) return t(i18nKey);
  return '';
}

interface MenuItem {
  key: string;
  label?: string;
  icon?: React.ReactNode;
  divider?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function NodeCapsuleToolbar({
  nodeId,
  store,
  getExtension,
  toolContext,
  getGroupTools,
  selectedCount,
  selectedHasGroup,
  showMoveOut,
  onMoveOutGroup,
  isPreview,
  isMixedSelection,
  getAnchorBounds,
  node: nodeProp,
  onGroup,
  onUngroup,
  onArrangeGrid,
  onArrangeHorizontal,
  onArrangeVertical,
  onArrangeAuto,
  onAlign,
  onUnifySizes,
  onSort,
  usePureIcon = true,
}: NodeCapsuleToolbarProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const graph = useGraph(store);
  const viewport = useViewport(store);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [joystickOpen, setJoystickOpen] = useState(false);
  const navBtnRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // 拖拽期间跟随节点:拖动走 P0-2 瞬态通道(node.position 不更新,仅 dragOffsets 变化),
  // 必须订阅偏移表强制重算锚点,否则胶囊工具栏在节点移动时停留在原地
  const [, setDragTick] = useState(0);
  useEffect(() => {
    if (!store.subscribeDragOffsets) return;
    return store.subscribeDragOffsets(() => setDragTick((v) => v + 1));
  }, [store]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!openMenu) return;
    const onPointer = (e: PointerEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [openMenu]);

  // 必须在 early return 之前声明所有 hooks

  const node = nodeProp ?? (nodeId ? graph.nodes.find((n) => n.id === nodeId) : null);
  const hasNodeTools = !!node;
  const isMultiSelect = selectedCount >= 2;

  if (!hasNodeTools && !isMultiSelect) return null;

  // 胶囊工具栏全量纯图标模式(含分组/聚合按钮):label 隐藏,语义保留在 title 悬浮提示。
  // 保留 usePureIcon prop 作为回退开关(传 false 可恢复 icon+文案)。
  const effectivePureIcon = usePureIcon;

  const ext = node ? getExtension(node.id) : undefined;
  const isGroupNode = node?.type === 'group';

  const tools = hasNodeTools
    ? (isGroupNode && getGroupTools
        ? getGroupTools(node!, toolContext)
        : ext?.getTools ? ext.getTools(node!, toolContext) : [])
    : [];
  const resolveToolNode = (tool: ToolDefinition): NodeRecord => tool.targetNode?.(node!, toolContext) ?? node!;
  const visibleTools = tools.filter((tool) => {
    const targetNode = resolveToolNode(tool);
    return !tool.visible || tool.visible(targetNode, toolContext);
  });

  // 显示条件与 ToolsDock 一致
  const isSingleGroup = hasNodeTools && isGroupNode && !isMultiSelect && !isPreview;
  const showNodeTools = hasNodeTools && (isPreview || !isMultiSelect);
  const showGroupAgg = isMultiSelect && !isPreview;
  const showArrangeAgg = isMultiSelect || isSingleGroup;
  const showAlignAgg = isMultiSelect || isSingleGroup;
  const showSizeAgg = isMultiSelect || isSingleGroup;
  const showLayerAgg = false;
  // 摇杆导航按钮: 仅单选非组非预览节点时显示
  const showNavButton = hasNodeTools && !isGroupNode && !isMultiSelect && !isPreview;

  // 主题色(主题自适应胶囊)
  const panelBg = theme.toolbar.panel ?? '#fafaf7';
  const borderColor = theme.toolbar.border ?? 'rgba(0,0,0,0.1)';
  const textColor = theme.toolbar.text ?? '#292524';
  const dangerColor = theme.toolbar.danger ?? '#dc2626';
  const nodeAccent = isGroupNode
    ? (theme.group.outlineSelectedColor ?? '#e94560')
    : (ext?.color ?? theme.toolbar.accent ?? '#e94560');
  const themeAccent = theme.toolbar.accent ?? '#e94560';
  const hoverBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const dividerBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';

  // 计算锚点(世界坐标) → 屏幕坐标
  const liveBounds = getAnchorBounds ? getAnchorBounds() : null;
  const size = node?.size ?? ext?.defaultSize ?? { width: 200, height: 80 };
  const boundsX = liveBounds?.x ?? node?.position.x ?? 0;
  const boundsY = liveBounds?.y ?? node?.position.y ?? 0;
  const boundsW = liveBounds?.width ?? size.width;
  const nodeCenterScreenX = boundsX * viewport.k + viewport.x + (boundsW * viewport.k) / 2;
  // 磁贴工具栏：悬浮在节点上方
  const nodeTopScreenY = boundsY * viewport.k + viewport.y;

  const hasAny = showNodeTools && visibleTools.length > 0;
  const hasAgg = showGroupAgg || showArrangeAgg || showAlignAgg || showSizeAgg || showLayerAgg || !!showMoveOut;
  if (!hasAny && !hasAgg && !showNavButton) return null;

  // 聚合菜单项
  const groupItems: MenuItem[] = [
    { key: 'group', label: t('toolbar.group'), icon: <Group size={16} />, onClick: onGroup },
    ...(selectedHasGroup
      ? [{ key: 'ungroup', label: t('toolbar.ungroup'), icon: <LayoutPanelLeft size={16} />, onClick: onUngroup }]
      : []),
  ];
  // 排列: 仅包含排列模式
  const arrangeItems: MenuItem[] = [
    { key: 'grid', label: t('toolsDock.grid'), icon: <LayoutGrid size={16} />, onClick: onArrangeGrid },
    { key: 'horizontal', label: t('toolsDock.horizontal'), icon: <Rows size={16} />, onClick: onArrangeHorizontal },
    { key: 'vertical', label: t('toolsDock.vertical'), icon: <Columns size={16} />, onClick: onArrangeVertical },
    { key: 'auto', label: t('toolsDock.auto'), icon: <GitBranch size={16} />, onClick: onArrangeAuto },
  ];
  // 对齐: 仅包含对齐模式
  // 文案与图标朝向一致:竖线图标(AlignCenterVertical)=沿竖线排列=垂直居中;
  // 横线图标(AlignCenterHorizontal)=沿横线排列=水平居中(历史上 label 与 key 错位,此处以图标/行为为准对调文案)
  const alignItems: MenuItem[] = [
    { key: 'left', label: t('align.left'), icon: <AlignStartVertical size={16} />, onClick: () => onAlign('left') },
    { key: 'hCenter', label: t('align.vCenter'), icon: <AlignCenterVertical size={16} />, onClick: () => onAlign('hCenter') },
    { key: 'right', label: t('align.right'), icon: <AlignEndVertical size={16} />, onClick: () => onAlign('right') },
    { key: 'div-a1', divider: true },
    { key: 'top', label: t('align.top'), icon: <AlignStartHorizontal size={16} />, onClick: () => onAlign('top') },
    { key: 'vCenter', label: t('align.hCenter'), icon: <AlignCenterHorizontal size={16} />, onClick: () => onAlign('vCenter') },
    { key: 'bottom', label: t('align.bottom'), icon: <AlignEndHorizontal size={16} />, onClick: () => onAlign('bottom') },
  ];
  const sizeItems: MenuItem[] = [
    { key: 'unify-baseline', label: t('toolsDock.restoreBaseline'), icon: <Maximize2 size={16} />, onClick: () => onUnifySizes('baseline') },
  ];
  const layerItems: MenuItem[] = [
    { key: 'bringToFront', label: t('sort.bringToFront'), icon: <ArrowUpToLine size={16} />, onClick: () => onSort('bringToFront') },
    { key: 'sendToBack', label: t('sort.sendToBack'), icon: <ArrowDownToLine size={16} />, onClick: () => onSort('sendToBack') },
    { key: 'moveUp', label: t('sort.moveUp'), icon: <ChevronUp size={16} />, onClick: () => onSort('moveUp') },
    { key: 'moveDown', label: t('sort.moveDown'), icon: <ChevronDown size={16} />, onClick: () => onSort('moveDown') },
  ];

  const renderMenu = (items: MenuItem[]): React.ReactElement => (
    <div style={menuStyle(panelBg, borderColor)} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((item, i) =>
        item.divider ? (
          <div key={`div-${i}`} style={{ height: 1, margin: '4px 0', background: dividerBg }} />
        ) : (
          <div
            key={item.key}
            style={menuItemStyle(textColor)}
            onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); item.onClick?.(); setOpenMenu(null); }}
          >
            {item.icon ? <span style={{ display: 'inline-flex', width: 16, height: 16 }}>{item.icon}</span> : null}
            <span>{item.label}</span>
          </div>
        ),
      )}
    </div>
  );

  const renderAggButton = (id: string, icon: React.ReactNode, label: string): React.ReactElement => (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        title={label}
        onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === id ? null : id); }}
        onPointerDown={(e) => e.stopPropagation()}
        style={aggButtonStyle(openMenu === id, nodeAccent, textColor, hoverBg)}
        onMouseEnter={(e) => { if (openMenu !== id) e.currentTarget.style.background = hoverBg; }}
        onMouseLeave={(e) => { if (openMenu !== id) e.currentTarget.style.background = 'transparent'; }}
      >
        {icon}
        {!effectivePureIcon && label ? <span>{label}</span> : null}
      </button>
      {openMenu === id ? renderMenu(
        id === 'group' ? groupItems
        : id === 'arrange' ? arrangeItems
        : id === 'align' ? alignItems
        : id === 'size' ? sizeItems
        : layerItems,
      ) : null}
    </div>
  );

  return (
    <>
    <div
      ref={dockRef}
      data-capsule-toolbar
      style={{
        position: 'absolute',
        left: nodeCenterScreenX,
        top: nodeTopScreenY - 22,
        transform: 'translate(-50%, -100%)',
        zIndex: 49,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'nowrap',
        padding: '2px 4px',
        background: panelBg,
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        pointerEvents: 'auto',
        userSelect: 'none',
        fontSize: 13,
        color: textColor,
        overflow: 'visible',
        maxWidth: 'min(92vw, 640px)',
      }}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 节点/组工具 */}
      {showNodeTools &&
        visibleTools.map((tool, i) => {
          const toolNode = resolveToolNode(tool);
          const isActive = tool.active?.(toolNode, toolContext) ?? false;
          const title = getToolTitle(tool, toolNode, toolContext, t);
          const icon = normalizeIcon(resolveIcon(tool.icon, toolNode, toolContext), 16);
          const label = getToolLabel(tool, toolNode, toolContext, t);
          const prevTool = visibleTools[i - 1];
          const showDivider = prevTool && prevTool.group !== tool.group;
          const hasMenu = !!tool.menu;

          // 带菜单的工具:渲染为下拉按钮
          if (hasMenu) {
            const menuItems = tool.menu!(toolNode, toolContext);
            return (
              <React.Fragment key={tool.id}>
                {showDivider && <div style={{ width: 1, height: 20, margin: '0 2px', background: dividerBg }} />}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    title={title}
                    onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === tool.id ? null : tool.id); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={aggButtonStyle(openMenu === tool.id, nodeAccent, textColor, hoverBg)}
                    onMouseEnter={(e) => { if (openMenu !== tool.id) e.currentTarget.style.background = hoverBg; }}
                    onMouseLeave={(e) => { if (openMenu !== tool.id) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
                    {!effectivePureIcon && label ? <span style={{ whiteSpace: 'nowrap' }}>{label}</span> : null}
                  </button>
                  {openMenu === tool.id ? (
                    <div style={menuStyle(panelBg, borderColor)}>
                      {menuItems.map((mi, miIdx) =>
                        mi.divider ? (
                          <div key={`div-${miIdx}`} style={{ height: 1, margin: '4px 0', background: dividerBg }} />
                        ) : (
                          <div
                            key={mi.key}
                            style={menuItemStyle(textColor)}
                            onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              mi.run?.(toolNode, toolContext);
                              setOpenMenu(null);
                            }}
                          >
                            {mi.icon ? <span style={{ display: 'inline-flex', width: 16, height: 16 }}>{normalizeIcon(mi.icon as React.ReactNode, 16)}</span> : null}
                            <span>{mi.label}</span>
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={tool.id}>
              {showDivider && <div style={{ width: 1, height: 20, margin: '0 2px', background: dividerBg }} />}
              <button
                type="button"
                title={title}
                onClick={(e) => { e.stopPropagation(); tool.run(toolNode, toolContext); }}
                onPointerDown={(e) => e.stopPropagation()}
                style={toolButtonStyle(isActive, !!tool.danger, !!tool.primary, tool.primary ? themeAccent : nodeAccent, dangerColor, textColor, hoverBg)}
                onMouseEnter={(e) => { if (!isActive && !tool.primary) e.currentTarget.style.background = hoverBg; }}
                onMouseLeave={(e) => { if (!isActive && !tool.primary) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
                {!effectivePureIcon && label ? <span style={{ whiteSpace: 'nowrap' }}>{label}</span> : null}
              </button>
            </React.Fragment>
          );
        })}

      {/* 分隔线 */}
      {showNodeTools && (showGroupAgg || showArrangeAgg || showAlignAgg || showSizeAgg || showLayerAgg) && visibleTools.length > 0 ? (
        <div style={{ width: 1, height: 20, margin: '0 2px', background: dividerBg }} />
      ) : null}

      {/* 聚合按钮组 */}
      {showGroupAgg ? renderAggButton('group', <Group size={16} />, t('toolbar.group')) : null}
      {showArrangeAgg ? renderAggButton('arrange', <LayoutGrid size={16} />, t('toolbar.arrange')) : null}
      {showAlignAgg ? renderAggButton('align', <AlignCenterVertical size={16} />, t('toolbar.align')) : null}
      {showSizeAgg ? renderAggButton('size', <Scaling size={16} />, t('toolbar.unify')) : null}
      {showLayerAgg ? renderAggButton('layer', <Layers size={16} />, t('toolbar.layer')) : null}
      {/* 移出组:统一为纯图标动作按钮，避免与节点工具出现两套交互 */}
      {showMoveOut ? (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            title={t('toolbar.moveOutGroup')}
            onClick={(e) => { e.stopPropagation(); onMoveOutGroup?.(); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={aggButtonStyle(false, nodeAccent, textColor, hoverBg)}
            onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <LogOut size={16} />
          </button>
        </div>
      ) : null}
      {isMixedSelection && showArrangeAgg ? null : null}

      {/* 导航按钮 — 摇杆触发 */}
      {showNavButton ? (
        <>
          <div style={{ width: 1, height: 20, margin: '0 2px', background: dividerBg }} />
          <button
            ref={navBtnRef}
            type="button"
            title={t('joystickNav.title')}
            onPointerDown={(e) => { e.stopPropagation(); setJoystickOpen(true); }}
            style={toolButtonStyle(false, false, false, nodeAccent, dangerColor, textColor, hoverBg)}
            onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Compass size={16} />
            </span>
          </button>
        </>
      ) : null}

      </div>

      {/* 摇杆 overlay */}
      {joystickOpen && showNavButton && node && navBtnRef.current ? (
        <NodeJoystickNav
          anchorX={navBtnRef.current.getBoundingClientRect().left + navBtnRef.current.offsetWidth / 2}
          anchorY={navBtnRef.current.getBoundingClientRect().top + navBtnRef.current.offsetHeight / 2}
          store={store}
          nodeId={node.id}
          onClose={() => setJoystickOpen(false)}
        />
      ) : null}
    </>
  );
}

// ===== 样式 =====

function toolButtonStyle(
  isActive: boolean,
  isDanger: boolean,
  isPrimary: boolean,
  accent: string,
  dangerColor: string,
  textColor: string,
  _hoverBg: string,
): CSSProperties {
  const filled = isActive || isPrimary;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 10px',
    borderRadius: 4,
    border: 'none',
    background: filled ? accent : 'transparent',
    color: isDanger && !filled ? dangerColor : filled ? '#fff' : textColor,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: filled ? 600 : 400,
    whiteSpace: 'nowrap',
    transition: 'background 0.15s',
  };
}

function aggButtonStyle(
  isOpen: boolean,
  accent: string,
  textColor: string,
  _hoverBg: string,
): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 34,
    padding: '0 10px',
    borderRadius: 4,
    border: 'none',
    background: isOpen ? accent : 'transparent',
    color: isOpen ? '#fff' : textColor,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: isOpen ? 600 : 400,
    whiteSpace: 'nowrap',
    transition: 'background 0.15s',
  };
}

function menuStyle(bg: string, border: string): CSSProperties {
  return {
    position: 'absolute',
    left: '50%',
    top: '100%',
    transform: 'translateX(-50%)',
    marginTop: 4,
    zIndex: 1000,
    minWidth: 160,
    padding: 4,
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
  };
}

function menuItemStyle(textColor: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    height: 36,
    borderRadius: 6,
    cursor: 'pointer',
    color: textColor,
    fontSize: 13,
    transition: 'background 0.12s',
    whiteSpace: 'nowrap',
  };
}
