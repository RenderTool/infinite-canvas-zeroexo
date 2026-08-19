/**
 * NodeHoverToolbar - 节点/组悬浮工具栏(统一聚合组件)
 *
 * 设计模式: 注册表 + 策略 + 依赖注入
 * - 注册表: 通过 NodeTypeExtension.getTools() 或 getGroupTools() 获取工具集
 * - 策略: 每个 ToolDefinition.run 是独立策略,通过 ToolContext 访问业务能力
 * - DI: ToolContext 由外部注入,工具定义不持有业务逻辑
 *
 * 渲染机制:
 * - 绝对定位在节点上方(屏幕坐标,不受 viewport 变换影响,固定大小)
 * - 通过 useGraph/useViewport 订阅状态,node 位置/视口变化时自动更新
 * - visible 返回 false 的工具不渲染
 * - active 返回 true 的工具高亮显示
 *
 * 聚合架构(Phase 8):
 * - 工具按钮(ext.getTools / getGroupTools) — 节点/组基础操作
 * - renderExtra — 额外内容(排列下拉菜单等,由 app 注入)
 * - "更多"按钮 — 打开设置页(onOpenSettings)
 * - 样式跟随节点颜色(ext.color 作为 accent)
 *
 * 用法:
 * ```tsx
 * <NodeHoverToolbar
 *   nodeId={selectedNodeId}
 *   store={store}
 *   getExtension={(id) => extensions.get(getNode(id)?.type)}
 *   toolContext={{ commandQueue, eventBus, getSelectedNodeIds }}
 *   getGroupTools={getGroupTools}
 *   renderExtra={(node) => <ArrangeDropdown ... />}
 *   onOpenSettings={() => setSettingsOpen(true)}
 *   theme={theme}
 * />
 * ```
 */

import React from 'react';
import type { NodeRecord, NodeTypeExtension, ToolContext, ToolDefinition } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import { useGraph, useViewport } from '../store.js';
import type { ReactGraphStore } from '../store.js';

export interface NodeHoverToolbarProps {
  /** 当前绑定的节点 id(null 时不渲染) */
  nodeId: string | null;
  /** 状态存储(获取 graph + viewport) */
  store: ReactGraphStore;
  /** 节点类型扩展访问器(返回 undefined 或无 getTools 则不渲染工具栏) */
  getExtension: (nodeId: string) => NodeTypeExtension | undefined;
  /** 工具上下文(注入业务能力给工具) */
  toolContext: ToolContext;
  /**
   * 组节点专用工具访问器(node.type === 'group' 时优先调用,替代 ext.getTools)。
   * 用于在悬浮栏中渲染组操作(预览/确认/解组/重命名/外观等)。
   */
  getGroupTools?: (node: NodeRecord, ctx: ToolContext) => ToolDefinition[];
  /**
   * 额外内容渲染器(在工具按钮和"更多"按钮之间渲染)。
   * 典型用途:排列下拉菜单(选中 ≥2 时显示)、组操作扩展等。
   * 由 app 注入,保持 render-react 包不依赖具体业务组件。
   */
  renderExtra?: (node: NodeRecord, ctx: ToolContext) => React.ReactNode;
  /** "更多"按钮点击回调(打开设置页);不传则不显示"更多"按钮 */
  onOpenSettings?: () => void;
  /** "更多"按钮文案(默认 '更多',由宿主注入 i18n 文案) */
  moreButtonLabel?: string;
  /** "更多"按钮 title 提示(默认 '更多设置',由宿主注入 i18n 文案) */
  moreButtonTitle?: string;
  /**
   * 显式传入节点(优先于 store 查找)。
   * 用于预览组等不在 graph 中的虚拟节点。
   */
  node?: NodeRecord;
  /**
   * 覆盖工具栏屏幕位置(用于预览组等虚拟节点,其位置不在 graph 中)。
   * 传入 { x, y, width } 后工具栏在该 bounds 上方居中显示。
   */
  overrideBounds?: { x: number; y: number; width: number };
  /** 工具栏距节点顶部的屏幕偏移(默认 8px) */
  gap?: number;
  /** 主题配置(可选,未提供时使用暗色回退) */
  theme?: ThemeConfig;
  /** 自定义容器样式(合并到工具栏外层) */
  style?: React.CSSProperties;
  /** 是否显示工具按钮文字标签(默认 true) */
  showLabels?: boolean;
  /** 工具栏换行布局:autoWrap=true 且 maxLines>1 时使用 grid 多行布局 */
  toolbarLayout?: { autoWrap: boolean; maxLines: number };
  /**
   * 仅渲染这些 ID 的工具(用于图片节点自定义工具栏);不传则渲染全部。
   * 配合 imageToolbarConfig.ids 使用:宿主读取用户配置后传入此集合,
   * NodeHoverToolbar 在 visible 校验前先按 ID 过滤,实现"勾选工具"功能。
   */
  visibleToolIds?: ReadonlySet<string>;
  /**
   * 组节点 bounds 访问器(优先于 overrideBounds;在每次重渲染时调用,保证跟随组移动)。
   * 用于解决分组工具栏不跟随组移动的问题:组节点位置在 graph 中可能滞后,
   * 通过此访问器实时获取最新 bounds(由 editor-page 注入,读取 scene-graph 实时状态)。
   * 返回 null 时回退到 overrideBounds 或 node.position。
   */
  getGroupBounds?: (
    nodeId: string,
  ) => { x: number; y: number; width: number; height: number } | null;
}

/** 解析 string | ((node, ctx) => string) 类型字段 */
function resolveText(
  value: string | ((node: NodeRecord, ctx: ToolContext) => string),
  node: NodeRecord,
  ctx: ToolContext,
): string {
  return typeof value === 'function' ? value(node, ctx) : value;
}

/** 解析 unknown | ((node, ctx) => unknown) 类型 icon 为 ReactNode */
function resolveIcon(
  icon: unknown | ((node: NodeRecord, ctx: ToolContext) => unknown),
  node: NodeRecord,
  ctx: ToolContext,
): React.ReactNode {
  const resolved = typeof icon === 'function' ? icon(node, ctx) : icon;
  return resolved as React.ReactNode;
}

/**
 * 隐藏滚动条的 CSS。
 * 用于单行模式(nowrap + overflowX: auto)下隐藏水平滚动条,保持视觉整洁。
 * 通过 <style> 标签注入 DOM,作用域为 .zeroexo-toolbar-hide-scrollbar。
 */
const HIDE_SCROLLBAR_CSS = `
.zeroexo-toolbar-hide-scrollbar {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
}
.zeroexo-toolbar-hide-scrollbar::-webkit-scrollbar {
  display: none; /* Chrome/Safari/Opera */
}
`;

export function NodeHoverToolbar({
  nodeId,
  store,
  getExtension,
  toolContext,
  getGroupTools,
  renderExtra,
  onOpenSettings,
  moreButtonLabel,
  moreButtonTitle,
  node: nodeProp,
  overrideBounds,
  gap = 8,
  theme,
  style,
  showLabels = true,
  toolbarLayout,
  visibleToolIds,
  getGroupBounds,
}: NodeHoverToolbarProps): React.ReactElement | null {
  const graph = useGraph(store);
  const viewport = useViewport(store);

  // "更多"按钮文案:由宿主通过 props 注入 i18n 文案,默认回退中文
  const moreLabel = moreButtonLabel ?? '更多';
  const moreTitle = moreButtonTitle ?? '更多设置';

  if (!nodeId) return null;
  // 显式传入的 node 优先(用于预览组等虚拟节点),否则从 store 查找
  const node = nodeProp ?? graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const ext = getExtension(node.id);
  const isGroupNode = node.type === 'group';

  // 组节点优先用 getGroupTools;否则用 ext.getTools(无 getTools 则不渲染)
  const tools = isGroupNode && getGroupTools
    ? getGroupTools(node, toolContext)
    : ext?.getTools ? ext.getTools(node, toolContext) : [];
  // 先按 visibleToolIds 过滤(用于图片节点自定义工具栏勾选配置),再按 visible 过滤
  const filteredTools = visibleToolIds
    ? tools.filter((t) => visibleToolIds.has(t.id))
    : tools;
  const visibleTools = filteredTools.filter((t) => !t.visible || t.visible(node, toolContext));

  // 额外内容(排列下拉等)
  const extraContent = renderExtra ? renderExtra(node, toolContext) : null;

  // 无工具且无额外内容且无"更多"按钮时不渲染
  if (visibleTools.length === 0 && !extraContent && !onOpenSettings) return null;

  // 主题色:使用 theme.toolbar.panel 作为背景(与 Modal 预览样式一致)
  const panelBg = theme?.toolbar.panel ?? '#1c1917';
  const textColor = theme?.toolbar.text ?? '#f5f5f4';
  const borderColor = theme?.toolbar.border ?? 'rgba(255,255,255,0.1)';
  const dangerColor = theme?.toolbar.danger ?? '#ff6b6b';
  // 选中态 accent 统一走主题选中色系(不用 ext.color 类型色)——视频节点 ext.color
  // 为蓝色 #3b82f6,会在选中/悬停工具栏出现蓝色样式(用户要求选中态零蓝色)
  const nodeAccent = isGroupNode
    ? (theme?.group.outlineSelectedColor ?? '#e94560')
    : (theme?.toolbar.accent ?? '#e94560');
  // hover 背景
  const hoverBg = theme?.mode === 'dark'
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.06)';

  // 换行布局:autoWrap && maxLines > 1 时使用 grid 多行(参考 Modal 预览)
  const wrapMode = toolbarLayout?.autoWrap === true && (toolbarLayout.maxLines ?? 1) > 1;
  const maxLines = toolbarLayout?.maxLines ?? 1;

  // 计算屏幕位置
  // 优先级:getGroupBounds(实时组 bounds,跟随组移动)> overrideBounds(预览组)> node 位置 + size
  const size = node.size ?? ext?.defaultSize ?? { width: 200, height: 80 };
  const liveGroupBounds = isGroupNode && getGroupBounds ? getGroupBounds(node.id) : null;
  const boundsX = liveGroupBounds?.x ?? overrideBounds?.x ?? node.position.x;
  const boundsY = liveGroupBounds?.y ?? overrideBounds?.y ?? node.position.y;
  const boundsW = liveGroupBounds?.width ?? overrideBounds?.width ?? size.width;
  const nodeCenterScreenX = boundsX * viewport.k + viewport.x + (boundsW * viewport.k) / 2;
  const nodeTopScreenY = boundsY * viewport.k + viewport.y;

  // 容器布局样式:flex 单行 或 grid 多行
  const layoutStyle: React.CSSProperties = wrapMode
    ? {
        display: 'grid',
        gridTemplateRows: `repeat(${maxLines}, auto)`,
        gridAutoFlow: 'column',
        gap: '2px 4px',
        alignItems: 'center',
      }
    : {
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: 2,
        overflowX: 'auto',
      };

  return (
    <div
      data-node-hover-toolbar={nodeId}
      className="zeroexo-toolbar-hide-scrollbar"
      style={{
        position: 'absolute',
        left: nodeCenterScreenX,
        top: nodeTopScreenY - gap,
        transform: 'translate(-50%, -100%)',
        padding: '4px 6px',
        background: panelBg,
        border: `1px solid ${borderColor}`,
        borderRadius: 18,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        zIndex: 1000,
        pointerEvents: 'auto',
        userSelect: 'none',
        fontSize: 13,
        color: textColor,
        ...layoutStyle,
        ...style,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: HIDE_SCROLLBAR_CSS }} />
      {visibleTools.map((tool) => {
        const isActive = tool.active?.(node, toolContext) ?? false;
        const label = resolveText(tool.label, node, toolContext);
        const title = resolveText(tool.title, node, toolContext);
        const icon = resolveIcon(tool.icon, node, toolContext);
        return (
          <div
            key={tool.id}
            title={title}
            style={{
              display: 'flex',
              height: 48,
              flexShrink: 0,
              alignItems: 'center',
              padding: '0 6px',
              color: tool.danger ? dangerColor : undefined,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                tool.run(node, toolContext);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                height: 36,
                alignItems: 'center',
                borderRadius: 8,
                padding: '0 8px',
                gap: showLabels ? 8 : 0,
                justifyContent: showLabels ? 'flex-start' : 'center',
                minWidth: showLabels ? undefined : 36,
                border: 'none',
                background: isActive ? nodeAccent : 'transparent',
                color: tool.danger
                  ? dangerColor
                  : isActive
                    ? '#fff'
                    : textColor,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = hoverBg;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {icon}
              {showLabels && label ? (
                <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
              ) : null}
            </button>
          </div>
        );
      })}

      {/* 额外内容(排列下拉菜单等,由 app 注入) */}
      {extraContent}

      {/* "更多"按钮 — 打开设置页(样式与工具按钮一致) */}
      {onOpenSettings ? (
        <div
          title={moreTitle}
          style={{
            display: 'flex',
            height: 48,
            flexShrink: 0,
            alignItems: 'center',
            padding: '0 6px',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              height: 36,
              alignItems: 'center',
              borderRadius: 8,
              padding: '0 8px',
              gap: showLabels ? 8 : 0,
              justifyContent: showLabels ? 'flex-start' : 'center',
              minWidth: showLabels ? undefined : 36,
              border: 'none',
              background: 'transparent',
              color: textColor,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 400,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1, letterSpacing: '1px' }}>{'…'}</span>
            {showLabels ? <span style={{ whiteSpace: 'nowrap' }}>{moreLabel}</span> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}
