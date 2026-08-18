/**
 * ToolsDock - 选中节点/组的固定工具面板(聚合按钮方案)
 *
 * 位置:紧贴 LeftSideToolBar 右侧,竖向居中
 * 行为:
 * - 单选节点:显示该节点的全部工具 + 层级聚合
 * - 单选组:显示组工具(重命名/解组/背景色/圆角/删除等)+ 层级聚合
 * - 预览组:显示确认/取消工具(不显示聚合按钮)
 * - 多选(>=2):显示成组/排列/尺寸/层级聚合按钮
 * - 多选混合(节点+组):不显示层级聚合(语义冲突)
 *
 * 预览组特殊处理:预览触发时原选中节点仍保留在 selection 中,
 * selectedCount >= 2,但此时应优先显示 confirm/cancel 工具,
 * 因此 showNodeTools = hasNodeTools && (isPreview || !isMultiSelect)
 *
 * 聚合按钮点击后向右弹出菜单,菜单项隐藏不可用项(不显示禁用态)。
 * 无背景/无边框(透明浮层),工具按钮自带样式。
 *
 * 所有可见文本通过 i18n 获取,禁止硬编码。
 * 策略详情见同目录 STRATEGY.md
 */

import React, { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useGraph } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeRecord, NodeTypeExtension, ToolContext, ToolDefinition } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  Group, LayoutPanelLeft, LayoutGrid, Rows, Columns, GitBranch,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  MoveHorizontal, MoveVertical, Maximize2,
  Layers, ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, Scaling,
  MoreHorizontal,
} from 'lucide-react';

export interface ToolsDockProps {
  nodeId: string | null;
  store: ReactGraphStore;
  getExtension: (nodeId: string) => NodeTypeExtension | undefined;
  toolContext: ToolContext;
  getGroupTools?: (node: NodeRecord, ctx: ToolContext) => ToolDefinition[];
  selectedCount: number;
  selectedHasGroup: boolean;
  isPreview: boolean;
  isMixedSelection: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onArrangeGrid: () => void;
  onArrangeHorizontal: () => void;
  onArrangeVertical: () => void;
  onArrangeTree: () => void;
  onAlign: (type: string) => void;
  onDistribute: (type: string) => void;
  onUnifySizes: (type: string) => void;
  onSort: (type: string) => void;
  node?: NodeRecord;
  isMobile?: boolean;
  /** 移动端更多操作按钮回调(触发右键菜单) */
  onMoreActions?: () => void;
}

// ===== 节点工具 label i18n key 映射表(label 为空时使用) =====
const TOOL_LABEL_I18N_KEY: Record<string, string> = {
  confirm: 'groupTools.confirmLabel',
  cancel: 'common.cancel',
  rename: 'toolbar.rename',
  ungroup: 'toolbar.ungroup',
  style: 'groupTools.styleTitle',
  delete: 'toolbar.delete',
  copyPrompt: 'toolsDock.copyPrompt',
  duplicate: 'toolbar.duplicate',
  resize: 'toolsDock.resize',
  maskEdit: 'toolsDock.maskEdit',
  crop: 'toolsDock.crop',
  split: 'toolsDock.split',
  upscale: 'toolsDock.upscale',
  superResolve: 'toolsDock.superResolve',
  angle: 'toolsDock.angle',
  download: 'toolsDock.download',
  editImage: 'toolsDock.editImage',
  editText: 'toolsDock.editText',
  reversePrompt: 'toolsDock.reversePrompt',
  replace: 'toolsDock.replace',
  view: 'toolsDock.view',
  editConfig: 'toolsDock.editConfig',
  info: 'toolsDock.info',
  saveAsset: 'toolsDock.saveAsset',
  edit: 'toolsDock.edit',
  detail: 'toolsDock.detail',
};

// ===== 节点工具 title i18n key 映射表(title 为空时使用) =====
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
  confirm: 'groupTools.confirmTitle',
  cancel: 'groupTools.cancelTitle',
  rename: 'groupTools.renameTitle',
  ungroup: 'groupTools.ungroupTitle',
  style: 'groupTools.styleTitle',
};

// ===== 辅助函数 =====

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
  const resolved = typeof icon === 'function' ? icon(node, ctx) : icon;
  return resolved as React.ReactNode;
}

/** 统一 lucide-react 图标尺寸 */
function normalizeIcon(icon: React.ReactNode, size: number = 16): React.ReactNode {
  if (React.isValidElement(icon)) {
    return React.cloneElement(icon, { size } as Record<string, unknown>);
  }
  return icon;
}

/** 获取工具的显示文字: label 非空用 label,否则用 i18n 映射,最终回退 toolsDock.tool */
function getToolLabel(
  tool: ToolDefinition,
  node: NodeRecord,
  ctx: ToolContext,
  t: TFunction,
): string {
  const label = resolveText(tool.label, node, ctx);
  if (label) return label;
  // 问题4: resize 工具文案随 freeResize 状态切换(锁比例 ↔ 自由比例)
  if (tool.id === 'resize') {
    const data = node.data as { freeResize?: boolean } | null;
    return data?.freeResize ? t('toolsDock.resizeFree') : t('toolsDock.resize');
  }
  const i18nKey = TOOL_LABEL_I18N_KEY[tool.id];
  if (i18nKey) return t(i18nKey);
  return t('toolsDock.tool');
}

/** 获取工具的 tooltip: title 非空用 title,否则用 i18n 映射,最终回退空字符串 */
function getToolTitle(
  tool: ToolDefinition,
  node: NodeRecord,
  ctx: ToolContext,
  t: TFunction,
): string {
  const title = resolveText(tool.title, node, ctx);
  if (title) return title;
  // 问题4: resize tooltip 也随状态切换
  if (tool.id === 'resize') {
    const data = node.data as { freeResize?: boolean } | null;
    return data?.freeResize ? t('toolsDock.resizeFree') : t('toolsDock.resize');
  }
  const i18nKey = TOOL_TITLE_I18N_KEY[tool.id];
  if (i18nKey) return t(i18nKey);
  return '';
}

// ===== 聚合菜单项类型 =====

interface MenuItem {
  key: string;
  label?: string;
  icon?: React.ReactNode;
  divider?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

// ===== 组件 =====

function ToolsDockView({
  nodeId,
  store,
  getExtension,
  toolContext,
  getGroupTools,
  selectedCount,
  selectedHasGroup,
  isPreview,
  onGroup,
  onUngroup,
  onArrangeGrid,
  onArrangeHorizontal,
  onArrangeVertical,
  onArrangeTree,
  onAlign,
  onDistribute,
  onUnifySizes,
  onSort,
  node: nodeProp,
  isMobile,
  theme,
  onMoreActions,
}: ToolsDockProps & { theme: ThemeConfig }): React.ReactElement | null {
  const { t } = useTranslation();
  const graph = useGraph(store);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!openMenu) return;
    const onPointer = (e: PointerEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [openMenu]);

  const node = nodeProp ?? (nodeId ? graph.nodes.find((n) => n.id === nodeId) : null);
  const hasNodeTools = !!node;
  const isMultiSelect = selectedCount >= 2;

  if (!hasNodeTools && !isMultiSelect) return null;

  const ext = node ? getExtension(node.id) : undefined;
  const isGroupNode = node?.type === 'group';

  // 节点/组工具
  const tools = hasNodeTools
    ? (isGroupNode && getGroupTools
        ? getGroupTools(node!, toolContext)
        : ext?.getTools ? ext.getTools(node!, toolContext) : [])
    : [];
  const visibleTools = tools.filter((t_) => !t_.visible || t_.visible(node!, toolContext));

  // 显示条件
  // 预览组本质 = 多选节点,因此预览时也显示排列/尺寸/层级聚合(但不显示成组聚合,已有"打组"按钮)
  // 预览组态时强制显示节点工具(忽略 isMultiSelect),否则 confirm/cancel 不显示
  // 单选组时也显示排列/尺寸聚合:作用于组内成员(子组视为整体,仅移动到合适位置)
  const isSingleGroup = hasNodeTools && isGroupNode && !isMultiSelect && !isPreview;
  const showNodeTools = hasNodeTools && (isPreview || !isMultiSelect);
  const showGroupAgg = isMultiSelect && !isPreview;
  const showArrangeAgg = isMultiSelect || isSingleGroup;
  const showSizeAgg = isMultiSelect || isSingleGroup;
  // TODO: 层级操作面板暂时隐藏，待用户实际体验后在调查报告中投票决定是否加入
  const showLayerAgg = false;

  // 主题色
  const dangerColor = theme.toolbar.danger ?? '#ff6b6b';
  const nodeAccent = isGroupNode
    ? (theme.group.outlineSelectedColor ?? '#e94560')
    : (ext?.color ?? theme.toolbar.accent ?? '#e94560');
  const hoverBg = theme.mode === 'dark'
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.06)';
  const textColor = theme.toolbar.text ?? '#f5f5f4';
  const dividerBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
  const menuBg = theme.node.contentBackground ?? '#1c1917';
  const menuBorder = theme.toolbar.border ?? 'rgba(255,255,255,0.1)';

  // 统一使用桌面端竖向布局(左侧适配已足够,不再为移动端做横向适配)
  // 移动端:覆盖 left 到与 LeftSideToolBar 对齐(left:12px),容器垂直居中
  const wrapperStyle: CSSProperties = {
    ...dockWrapperStyleBase,
    ...(isMobile ? { left: 12 } : {}),
  };
  const containerStyle: CSSProperties = {
    ...dockContainerStyleBase,
    ...(isMobile ? { justifyContent: 'center' } : {}),
  };
  const colStyle: CSSProperties = columnStyleBase;
  const dividerStyle: CSSProperties = { height: 1, width: '100%', margin: '2px 0' };

  // 成组聚合菜单项(不可用项隐藏)
  const groupItems: MenuItem[] = [];
  groupItems.push({ key: 'group', label: t('toolbar.group'), icon: <Group size={16} />, onClick: onGroup });
  if (selectedHasGroup) {
    groupItems.push({ key: 'ungroup', label: t('toolbar.ungroup'), icon: <LayoutPanelLeft size={16} />, onClick: onUngroup });
  }

  // 排列聚合菜单项
  // canDistribute: 多选需 ≥3 选中; 单选组需 ≥3 个直接子节点
  const canDistribute = isSingleGroup
    ? (node?.childrenIds?.length ?? 0) >= 3
    : selectedCount >= 3;
  const arrangeItems: MenuItem[] = [
    { key: 'grid', label: t('toolsDock.grid'), icon: <LayoutGrid size={16} />, onClick: onArrangeGrid },
    { key: 'horizontal', label: t('toolsDock.horizontal'), icon: <Rows size={16} />, onClick: onArrangeHorizontal },
    { key: 'vertical', label: t('toolsDock.vertical'), icon: <Columns size={16} />, onClick: onArrangeVertical },
    { key: 'tree', label: t('toolsDock.tree'), icon: <GitBranch size={16} />, onClick: onArrangeTree },
    { key: 'div-a1', divider: true },
    { key: 'left', label: t('align.left'), icon: <AlignStartVertical size={16} />, onClick: () => onAlign('left') },
    { key: 'hCenter', label: t('align.hCenter'), icon: <AlignCenterVertical size={16} />, onClick: () => onAlign('hCenter') },
    { key: 'right', label: t('align.right'), icon: <AlignEndVertical size={16} />, onClick: () => onAlign('right') },
    { key: 'div-a2', divider: true },
    { key: 'top', label: t('align.top'), icon: <AlignStartHorizontal size={16} />, onClick: () => onAlign('top') },
    { key: 'vCenter', label: t('align.vCenter'), icon: <AlignCenterHorizontal size={16} />, onClick: () => onAlign('vCenter') },
    { key: 'bottom', label: t('align.bottom'), icon: <AlignEndHorizontal size={16} />, onClick: () => onAlign('bottom') },
  ];
  if (canDistribute) {
    arrangeItems.push(
      { key: 'div-a3', divider: true },
      { key: 'dist-h', label: t('distribute.horizontal'), icon: <MoveHorizontal size={16} />, onClick: () => onDistribute('horizontal') },
      { key: 'dist-v', label: t('distribute.vertical'), icon: <MoveVertical size={16} />, onClick: () => onDistribute('vertical') },
    );
  }

  // 尺寸聚合菜单项
  const sizeItems: MenuItem[] = [
    { key: 'unify-w', label: t('toolsDock.unifyWidth'), icon: <MoveHorizontal size={16} />, onClick: () => onUnifySizes('width') },
    { key: 'unify-h', label: t('toolsDock.unifyHeight'), icon: <MoveVertical size={16} />, onClick: () => onUnifySizes('height') },
    { key: 'unify-both', label: t('toolsDock.unifyBoth'), icon: <Maximize2 size={16} />, onClick: () => onUnifySizes('both') },
  ];

  // 层级聚合菜单项
  const layerItems: MenuItem[] = [
    { key: 'bringToFront', label: t('sort.bringToFront'), icon: <ArrowUpToLine size={16} />, onClick: () => onSort('bringToFront') },
    { key: 'sendToBack', label: t('sort.sendToBack'), icon: <ArrowDownToLine size={16} />, onClick: () => onSort('sendToBack') },
    { key: 'moveUp', label: t('sort.moveUp'), icon: <ChevronUp size={16} />, onClick: () => onSort('moveUp') },
    { key: 'moveDown', label: t('sort.moveDown'), icon: <ChevronDown size={16} />, onClick: () => onSort('moveDown') },
  ];

  // 渲染弹出菜单
  const renderMenu = (items: MenuItem[]): React.ReactElement => (
    <div style={menuStyle(menuBg, menuBorder)}>
      {items.map((item, i) =>
        item.divider ? (
          <div key={`div-${i}`} style={{ height: 1, margin: '4px 0', background: dividerBg }} />
        ) : (
          <div
            key={item.key}
            style={menuItemStyle(textColor)}
            onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            onClick={(e) => { e.stopPropagation(); item.onClick?.(); setOpenMenu(null); }}
          >
            {item.icon ? <span style={{ display: 'inline-flex', width: 16, height: 16 }}>{item.icon}</span> : null}
            <span>{item.label}</span>
          </div>
        ),
      )}
    </div>
  );

  // 渲染聚合按钮
  const renderAggButton = (
    id: string,
    icon: React.ReactNode,
    label: string,
  ): React.ReactElement => (
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
        <span>{label}</span>
      </button>
      {openMenu === id ? renderMenu(
        id === 'group' ? groupItems
        : id === 'arrange' ? arrangeItems
        : id === 'size' ? sizeItems
        : layerItems
      ) : null}
    </div>
  );

  return (
    <div
      ref={dockRef}
      style={wrapperStyle}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={containerStyle}>
        {/* 节点/组工具(单选或预览组时显示) */}
        {showNodeTools && (visibleTools.length > 0 || isMobile) ? (
          <div style={colStyle}>
            {visibleTools.map((tool, i) => {
              const isActive = tool.active?.(node!, toolContext) ?? false;
              const title = getToolTitle(tool, node!, toolContext, t);
              const icon = normalizeIcon(resolveIcon(tool.icon, node!, toolContext), 16);
              const label = getToolLabel(tool, node!, toolContext, t);
              const prevTool = visibleTools[i - 1];
              const showDivider = prevTool && prevTool.group !== tool.group;
              return (
                <React.Fragment key={tool.id}>
                  {showDivider && (
                    <div key={`div-${tool.id}`} style={{ ...dividerStyle, backgroundColor: dividerBg }} />
                  )}
                  <button
                    type="button"
                    title={title}
                    onClick={(e) => { e.stopPropagation(); tool.run(node!, toolContext); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={toolButtonStyle(isActive, !!tool.danger, nodeAccent, dangerColor, textColor)}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = hoverBg; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
                    <span>{label}</span>
                  </button>
                </React.Fragment>
              );
            })}
            {/* 移动端:更多操作按钮(触发右键菜单) */}
            {isMobile && onMoreActions && (
              <button
                type="button"
                title={t('toolsDock.moreActions')}
                onClick={(e) => { e.stopPropagation(); onMoreActions(); }}
                onPointerDown={(e) => e.stopPropagation()}
                style={toolButtonStyle(false, false, nodeAccent, dangerColor, textColor)}
                onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MoreHorizontal size={16} /></span>
                <span>{t('toolsDock.moreActions')}</span>
              </button>
            )}
          </div>
        ) : null}

        {/* 分隔线(节点工具和聚合按钮之间) */}
        {showNodeTools && (showGroupAgg || showLayerAgg) && visibleTools.length > 0 ? (
          <div style={{ ...dividerStyle, backgroundColor: dividerBg }} />
        ) : null}

        {/* 聚合按钮组 */}
        {showGroupAgg || showArrangeAgg || showSizeAgg || showLayerAgg ? (
          <div style={colStyle}>
            {showGroupAgg ? renderAggButton('group', <Group size={16} />, t('toolbar.group')) : null}
            {showArrangeAgg ? renderAggButton('arrange', <LayoutGrid size={16} />, t('toolbar.arrange')) : null}
            {showSizeAgg ? renderAggButton('size', <Scaling size={16} />, t('toolbar.unify')) : null}
            {showLayerAgg ? renderAggButton('layer', <Layers size={16} />, t('toolbar.layer')) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ToolsDock(props: ToolsDockProps): React.ReactElement | null {
  const { theme } = useTheme();
  return <ToolsDockView {...props} theme={theme} />;
}

// ===== 样式(基础,移动端在组件内覆盖) =====

const dockWrapperStyleBase: CSSProperties = {
  position: 'absolute',
  left: 68,
  top: 0,
  bottom: 0,
  zIndex: 49,
  display: 'flex',
  alignItems: 'center',
  pointerEvents: 'none',
};

const dockContainerStyleBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  pointerEvents: 'auto',
  userSelect: 'none',
  fontSize: 13,
};

const columnStyleBase: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '2px 4px',
};

function toolButtonStyle(
  isActive: boolean,
  isDanger: boolean,
  accent: string,
  dangerColor: string,
  textColor: string,
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: 32,
    padding: '0 8px',
    borderRadius: 6,
    border: 'none',
    background: isActive ? accent : 'transparent',
    color: isDanger ? dangerColor : isActive ? '#fff' : textColor,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: isActive ? 600 : 400,
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
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: 32,
    padding: '0 8px',
    borderRadius: 6,
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
    left: '100%',
    top: 0,
    marginLeft: 4,
    zIndex: 200,
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
