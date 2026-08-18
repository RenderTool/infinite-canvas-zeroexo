/**
 * NodeDetailPanel - 节点详情面板(参考 UE5 Details / Figma 右侧栏)
 *
 * 作为 NodeHoverToolbar 的互补组件:
 * - NodeHoverToolbar(轻量): 节点上方浮动,仅显示 2-3 个高频快捷操作
 * - NodeDetailPanel(完整): 右侧 sidebar 内垂直面板,显示节点信息 + 全部工具
 *
 * 复用同样的注册表分发架构:
 * - 通过 NodeTypeExtension.getTools() 获取工具集
 * - ToolContext 注入业务能力
 * - 工具按 group 字段分组渲染(无 group 的归入"操作"组)
 *
 * 用法:
 * ```tsx
 * <NodeDetailPanel
 *   nodeId={selectedNodeId}
 *   store={store}
 *   getExtension={(id) => extensions.get(getNode(id)?.type)}
 *   toolContext={{ commandQueue, eventBus, getSelectedNodeIds }}
 *   theme={theme}
 * />
 * ```
 */

import React from 'react';
import type { NodeRecord, NodeTypeExtension, ToolContext, ToolDefinition } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import { useGraph } from '../store.js';
import type { ReactGraphStore } from '../store.js';

export interface NodeDetailPanelProps {
  /** 当前绑定的节点 id(null 时不渲染) */
  nodeId: string | null;
  /** 状态存储(获取 graph) */
  store: ReactGraphStore;
  /** 节点类型扩展访问器 */
  getExtension: (nodeId: string) => NodeTypeExtension | undefined;
  /** 工具上下文(注入业务能力给工具) */
  toolContext: ToolContext;
  /**
   * 组节点专用工具访问器(node.type === 'group' 时优先调用,替代 ext.getTools)。
   * 用于在 Detail 面板中渲染组操作(预览/确认/解组/重命名/外观等),
   * 与节点工具共用同样的 ToolDefinition + ToolRow 渲染(一致的 toolbar 模块)。
   */
  getGroupTools?: (node: NodeRecord, ctx: ToolContext) => ToolDefinition[];
  /**
   * 显式传入节点(优先于 store 查找)。
   * 用于预览组等不在 graph 中的虚拟节点(预览组是 controller 内部状态,非 scene 节点)。
   */
  node?: NodeRecord;
  /** 主题配置(可选,未提供时使用暗色回退) */
  theme?: ThemeConfig;
  /** 自定义容器样式 */
  style?: React.CSSProperties;
}

// ===== 主题派生 =====

interface PanelTheme {
  bg: string;
  headerBg: string;
  border: string;
  text: string;
  textMuted: string;
  hover: string;
  danger: string;
  sectionTitle: string;
  borderRadius: number;
}

function derivePanelTheme(theme?: ThemeConfig): PanelTheme {
  if (!theme) {
    return {
      bg: '#1c1917',
      headerBg: '#1c1917',
      border: '#44403c',
      text: '#f5f5f4',
      textMuted: '#a8a29e',
      hover: 'rgba(255,255,255,0.06)',
      danger: '#ff6b6b',
      sectionTitle: '#a8a29e',
      borderRadius: 8,
    };
  }
  return {
    bg: theme.node.contentBackground,
    headerBg: theme.toolbar.background,
    border: theme.toolbar.border,
    text: theme.toolbar.text,
    textMuted: theme.toolbar.textMuted,
    hover: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    danger: theme.toolbar.danger,
    sectionTitle: theme.toolbar.textMuted,
    borderRadius: 8,
  };
}

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

/** 按 group 字段分组工具(无 group 的归入默认组) */
function groupTools(tools: ToolDefinition[]): { group: string; tools: ToolDefinition[] }[] {
  const map = new Map<string, ToolDefinition[]>();
  for (const tool of tools) {
    const g = tool.group ?? '操作';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(tool);
  }
  return Array.from(map.entries()).map(([group, tools]) => ({ group, tools }));
}

// ===== 主组件 =====

export function NodeDetailPanel({
  nodeId,
  store,
  getExtension,
  toolContext,
  getGroupTools,
  node: nodeProp,
  theme,
  style,
}: NodeDetailPanelProps): React.ReactElement | null {
  const graph = useGraph(store);
  const pt = derivePanelTheme(theme);

  if (!nodeId) return null;
  // 显式传入的 node 优先(用于预览组等虚拟节点),否则从 store 查找
  const node = nodeProp ?? graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const ext = getExtension(node.id);
  const isGroupNode = node.type === 'group';

  // 获取工具列表:组节点优先用 getGroupTools,否则用 ext.getTools
  const allTools = isGroupNode && getGroupTools
    ? getGroupTools(node, toolContext)
    : ext?.getTools?.(node, toolContext) ?? [];
  const visibleTools = allTools.filter((t) => !t.visible || t.visible(node, toolContext));
  const grouped = groupTools(visibleTools);

  // 节点信息
  const size = node.size ?? ext?.defaultSize ?? { width: 0, height: 0 };
  const typeName = isGroupNode
    ? ((node.data as { title?: string } | undefined)?.title ?? '组')
    : (ext?.displayName ?? node.type);
  const typeColor = ext?.color ?? '#6b7280';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: pt.bg,
        borderLeft: `1px solid ${pt.border}`,
        color: pt.text,
        fontSize: 13,
        fontFamily: 'inherit',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* 头部:节点类型 + 色点 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: `1px solid ${pt.border}`,
          background: pt.headerBg,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 3,
            background: typeColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{typeName}</span>
      </div>

      {/* 可滚动内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {/* 节点信息区 */}
        <div style={{ padding: '0 14px 8px' }}>
          <InfoRow label="ID" value={node.id} muted={pt.textMuted} text={pt.text} />
          <InfoRow label="类型" value={node.type} muted={pt.textMuted} text={pt.text} />
          {!isGroupNode && (
            <InfoRow label="尺寸" value={`${Math.round(size.width)} × ${Math.round(size.height)}`} muted={pt.textMuted} text={pt.text} />
          )}
          <InfoRow
            label="位置"
            value={`(${Math.round(node.position.x)}, ${Math.round(node.position.y)})`}
            muted={pt.textMuted}
            text={pt.text}
          />
        </div>

        {/* 工具分组区 */}
        {grouped.map(({ group, tools }) => (
          <div key={group}>
            <div
              style={{
                padding: '8px 14px 4px',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase' as const,
                letterSpacing: 0.5,
                color: pt.sectionTitle,
              }}
            >
              {group}
            </div>
            {tools.map((tool) => {
              const isActive = tool.active?.(node, toolContext) ?? false;
              const label = resolveText(tool.label, node, toolContext);
              const title = resolveText(tool.title, node, toolContext);
              const icon = resolveIcon(tool.icon, node, toolContext);
              return (
                <ToolRow
                  key={tool.id}
                  label={label}
                  title={title}
                  icon={icon}
                  danger={tool.danger}
                  active={isActive}
                  pt={pt}
                  onClick={() => tool.run(node, toolContext)}
                />
              );
            })}
          </div>
        ))}

        {/* 无工具时显示提示 */}
        {visibleTools.length === 0 ? (
          <div style={{ padding: '12px 14px', color: pt.textMuted, fontSize: 12 }}>
            该节点类型未注册工具
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ===== 子组件 =====

function InfoRow({ label, value, muted, text }: { label: string; value: string; muted: string; text: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
      <span style={{ color: muted }}>{label}</span>
      <span style={{ color: text, fontVariantNumeric: 'tabular-nums', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  );
}

function ToolRow({
  label,
  title,
  icon,
  danger,
  active,
  pt,
  onClick,
}: {
  label: string;
  title: string;
  icon: React.ReactNode;
  danger?: boolean;
  active: boolean;
  pt: PanelTheme;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 14px',
        border: 'none',
        background: 'transparent',
        color: danger ? pt.danger : active ? pt.danger : pt.text,
        fontSize: 13,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = pt.hover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon && <span style={{ display: 'inline-flex', width: 16, justifyContent: 'center', flexShrink: 0, opacity: danger ? 1 : 0.8 }}>{icon}</span>}
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}
