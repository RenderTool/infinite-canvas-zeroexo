/**
 * LayoutPlugin - 布局插件
 *
 * 提供 18 项布局操作(排列/对齐/分布/尺寸统一/层级排序)。
 * 通过 LayoutController 暴露方法,从 store 读取选中节点 → 调用纯函数 → BatchCommand 写回。
 * 所有操作支持 undo/redo(通过 commandQueue)。
 */

import type { Plugin, PluginContext } from '@zeroexo/core';
import type { Command, CommandContext } from '@zeroexo/core';
import type { GraphModel, NodeRecord } from '@zeroexo/core';
import { BatchCommand, MoveNodeCommand, ResizeNodeCommand } from '@zeroexo/core';
import type { RenderReactPlugin, ReactGraphStore } from '@zeroexo/plugin-render-react';
import type {
  AlignMode,
  ArrangeMode,
  DistributeMode,
  LayoutNode,
  SortDirection,
  UnifySizeMode,
} from './types.js';
import {
  alignNodes,
  arrangeNodes,
  distributeNodes,
  sortElements,
  unifyNodeSizes,
} from './algorithms/index.js';

// ===== 节点尺寸访问器返回类型 =====

/** 节点尺寸元信息(从扩展定义中获取) */
export interface NodeSizeMeta {
  width: number;
  height: number;
  defaultSize?: { width: number; height: number };
  lockAspectRatio?: boolean;
  resizable?: boolean;
}

// ===== ReorderNodesCommand(层级排序,自定义 Command) =====

/** 层级排序命令:按新顺序重排 nodes 数组(不改坐标,只改顺序) */
class ReorderNodesCommand implements Command {
  id = 'reorder-nodes';
  constructor(
    private oldOrder: string[],
    private newOrder: string[],
  ) {}

  private applyOrder(state: GraphModel, order: string[]): GraphModel {
    const orderMap = new Map(order.map((id, i) => [id, i]));
    const sorted = [...state.nodes].sort((a, b) => {
      const ia = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const ib = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });
    return { ...state, nodes: sorted };
  }

  execute(state: GraphModel, _context: CommandContext): GraphModel {
    return this.applyOrder(state, this.newOrder);
  }

  undo(state: GraphModel, _context: CommandContext): GraphModel {
    return this.applyOrder(state, this.oldOrder);
  }
}

// ===== LayoutController =====

export interface LayoutController {
  /** 排列选中节点(10 模式,需 ≥2 个节点) */
  arrangeSelection(mode: ArrangeMode): void;
  /** 排列指定节点(外部传入节点 ID 列表,用于 AI 生成后自动布局) */
  arrangeSelection(nodeIds: string[], mode: ArrangeMode): void;
  /** 对齐选中节点(6 模式,需 ≥2 个节点) */
  alignSelection(mode: AlignMode): void;
  /** 分布选中节点(2 模式,需 ≥3 个节点) */
  distributeSelection(mode: DistributeMode): void;
  /** 恢复选中节点到基准尺寸 */
  unifySelectionSizes(mode: UnifySizeMode): void;
  /** 恢复指定节点到基准尺寸(外部传入节点 ID 列表,用于右键菜单等定向操作) */
  unifySelectionSizes(nodeIds: string[], mode: UnifySizeMode): void;
  /** 层级排序选中节点(4 方向) */
  sortSelection(direction: SortDirection): void;
  /** 注入节点尺寸解析器(返回尺寸 + 元信息,用于基准尺寸恢复) */
  setNodeSizeAccessor(resolver: (node: NodeRecord) => NodeSizeMeta): void;
  /** 注入特化外观类型判定器(特化节点豁免尺寸统一等全局操作) */
  setSpecialTypeAccessor(accessor: (type: string) => boolean): void;
}

class LayoutControllerImpl implements LayoutController {
  private getNodeSize?: (node: NodeRecord) => NodeSizeMeta;
  private isSpecialType?: (type: string) => boolean;

  constructor(
    private store: ReactGraphStore,
    private commandQueue: { execute: (cmd: Command) => void },
  ) {}

  setNodeSizeAccessor(resolver: (node: NodeRecord) => NodeSizeMeta): void {
    this.getNodeSize = resolver;
  }

  setSpecialTypeAccessor(accessor: (type: string) => boolean): void {
    this.isSpecialType = accessor;
  }

  /** 与渲染层一致的节点尺寸获取:始终获取完整元信息,用当前实际尺寸覆盖宽高 */
  private resolveNodeMeta(node: NodeRecord): NodeSizeMeta {
    // 始终从注入的 resolver 获取扩展元信息(defaultSize/lockAspectRatio/resizable)
    const meta: NodeSizeMeta = this.getNodeSize
      ? (this.getNodeSize(node) ?? { width: 200, height: 100 })
      : { width: 200, height: 100 };

    // 用节点当前实际尺寸覆盖宽高(已 resize 的用实际大小,否则用 defaultSize)
    if (node.size) {
      meta.width = node.size.width;
      meta.height = node.size.height;
    } else if (node.bounds) {
      meta.width = node.bounds.width;
      meta.height = node.bounds.height;
    }
    return meta;
  }

  /** 使用正确尺寸转换为 LayoutNode(含类型元信息) */
  private toLayoutNodeWithSize(node: NodeRecord): LayoutNode {
    const meta = this.resolveNodeMeta(node);
    return {
      id: node.id,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      width: Math.max(1, Math.ceil(meta.width)),
      height: Math.max(1, Math.ceil(meta.height)),
      type: node.type,
      defaultSize: meta.defaultSize,
      lockAspectRatio: meta.lockAspectRatio,
      resizable: meta.resizable,
    };
  }

  private getSelectedNodes(): NodeRecord[] {
    const sel = this.store.getSelection();
    const nodes = this.store.getGraph().nodes;
    const selected = nodes.filter((n) => sel.selectedNodeIds.has(n.id));
    return this.promoteGroupSelection(selected);
  }

  /** 从指定 ID 列表获取节点(用于外部传入,如 AI 自动布局) */
  private getNodesByIds(nodeIds: string[]): NodeRecord[] {
    const nodes = this.store.getGraph().nodes;
    const selected = nodes.filter((n) => nodeIds.includes(n.id));
    return this.promoteGroupSelection(selected);
  }

  /**
   * 组归一化: 如果选中节点中包含组, 排除组内子节点(组作为原子单元参与布局)
   * 多个组选定时, 只保留最外层组, 内部成员保持相对位置不变
   */
  private promoteGroupSelection(selected: NodeRecord[]): NodeRecord[] {
    // 找所有选中的组
    const selectedGroups = selected.filter((n) => n.type === 'group');
    // 如果有选中的组, 排除组内成员
    if (selectedGroups.length > 0) {
      const groupIds = new Set(selectedGroups.map((g) => g.id));
      // 排除 parentId 在选中组内的节点
      return selected.filter((n) => {
        if (n.type === 'group') return true;
        // 如果节点的 parentId 指向某个选中组, 排除
        if (n.parentId && groupIds.has(n.parentId)) return false;
        return true;
      });
    }
    return selected;
  }

  private applyPositions(
    nodes: NodeRecord[],
    positions: Map<string, { x: number; y: number }>,
    batchId: string,
  ): void {
    const allNodes = this.store.getGraph().nodes;
    const cmds: Command[] = [];
    const movedDeltas = new Map<string, { x: number; y: number }>();

    for (const n of nodes) {
      if (!positions.has(n.id)) continue;
      const newPos = positions.get(n.id)!;
      const delta = { x: newPos.x - n.position.x, y: newPos.y - n.position.y };
      cmds.push(new MoveNodeCommand(n.id, delta));
      movedDeltas.set(n.id, delta);
    }

    // 组移动: 组内子节点跟随移动(相同 delta)
    for (const [groupId, delta] of movedDeltas) {
      const group = allNodes.find((n) => n.id === groupId);
      if (group?.type === 'group') {
        for (const child of allNodes) {
          if (child.parentId === groupId && !movedDeltas.has(child.id)) {
            cmds.push(new MoveNodeCommand(child.id, delta));
          }
        }
      }
    }

    if (cmds.length > 0) {
      this.commandQueue.execute(new BatchCommand(cmds, batchId));
    }
  }

  arrangeSelection(modeOrIds: ArrangeMode | string[], mode?: ArrangeMode): void {
    // 重载: arrangeSelection(nodeIds, mode) — 外部传入节点 ID
    if (Array.isArray(modeOrIds) && mode) {
      const nodes = this.getNodesByIds(modeOrIds);
      this.doArrange(nodes, mode);
      return;
    }
    // 重载: arrangeSelection(mode) — 从选中状态取节点
    const nodes = this.getSelectedNodes();
    this.doArrange(nodes, modeOrIds as ArrangeMode);
  }

  private doArrange(nodes: NodeRecord[], mode: ArrangeMode): void {
    if (nodes.length < 2) return;
    const layoutNodes = nodes.map((n) => this.toLayoutNodeWithSize(n));
    const layoutNodeIds = new Set(layoutNodes.map((n) => n.id));

    // 需要边信息的模式
    const needsEdges: ArrangeMode[] = ['tree', 'dagre', 'smart', 'force', 'radial', 'auto'];
    let edges: { source: string; target: string }[] | undefined;
    let groups: Map<string, string[]> | undefined;

    if (needsEdges.includes(mode)) {
      const graph = this.store.getGraph();
      // 构建子节点→父组映射
      const childToParent = new Map<string, string>();
      const parentToChildren = new Map<string, string[]>();
      for (const node of graph.nodes) {
        if (node.type === 'group' && layoutNodeIds.has(node.id)) {
          parentToChildren.set(node.id, []);
          for (const child of graph.nodes) {
            if (child.parentId === node.id) {
              childToParent.set(child.id, node.id);
              parentToChildren.get(node.id)!.push(child.id);
            }
          }
        }
      }
      if (parentToChildren.size > 0) {
        groups = parentToChildren;
      }
      edges = graph.edges
        .map((e) => ({ source: e.source.nodeId, target: e.target.nodeId }))
        .map((e) => {
          const source = layoutNodeIds.has(e.source) ? e.source : (childToParent.get(e.source) ?? e.source);
          const target = layoutNodeIds.has(e.target) ? e.target : (childToParent.get(e.target) ?? e.target);
          return { source, target };
        })
        .filter((e) => e.source !== e.target);
    }

    const positions = arrangeNodes(layoutNodes, mode, edges, { groups });
    this.applyPositions(nodes, positions, 'layout-arrange');
  }

  alignSelection(mode: AlignMode): void {
    const nodes = this.getSelectedNodes();
    if (nodes.length < 2) return;
    const layoutNodes = nodes.map((n) => this.toLayoutNodeWithSize(n));
    const positions = alignNodes(layoutNodes, mode);
    this.applyPositions(nodes, positions, 'layout-align');
  }

  distributeSelection(mode: DistributeMode): void {
    const nodes = this.getSelectedNodes();
    if (nodes.length < 3) return;
    const layoutNodes = nodes.map((n) => this.toLayoutNodeWithSize(n));
    const positions = distributeNodes(layoutNodes, mode);
    this.applyPositions(nodes, positions, 'layout-distribute');
  }

  unifySelectionSizes(modeOrIds: UnifySizeMode | string[], mode?: UnifySizeMode): void {
    // 重载: unifySelectionSizes(nodeIds, mode) — 外部传入节点 ID
    if (Array.isArray(modeOrIds) && mode) {
      this.doUnifySizes(this.getNodesByIds(modeOrIds), mode);
      return;
    }
    // 重载: unifySelectionSizes(mode) — 从选中状态取节点
    this.doUnifySizes(this.getSelectedNodes(), modeOrIds as UnifySizeMode);
  }

  private doUnifySizes(allNodes: NodeRecord[], mode: UnifySizeMode): void {
    if (allNodes.length === 0) return;
    // 特化外观节点(气泡音频/资源浏览器)不参与尺寸统一
    const nodes = this.isSpecialType
      ? allNodes.filter((n) => !this.isSpecialType!(n.type))
      : allNodes;
    if (nodes.length === 0) return;
    const layoutNodes = nodes.map((n) => this.toLayoutNodeWithSize(n));
    const sizes = unifyNodeSizes(layoutNodes, mode);
    if (sizes.size === 0) return;
    const cmds = nodes
      .filter((n) => sizes.has(n.id))
      .map((n) => {
        const newSize = sizes.get(n.id)!;
        const oldMeta = this.resolveNodeMeta(n);
        return new ResizeNodeCommand(
          n.id,
          { x: n.position.x, y: n.position.y, width: oldMeta.width, height: oldMeta.height },
          { x: newSize.x, y: newSize.y, width: newSize.width, height: newSize.height },
        );
      });
    if (cmds.length > 0) {
      this.commandQueue.execute(new BatchCommand(cmds, 'layout-unify-size'));
    }
  }

  sortSelection(direction: SortDirection): void {
    const nodes = this.getSelectedNodes();
    if (nodes.length === 0) return;
    const targetIds = nodes.map((n) => n.id);
    const allNodes = this.store.getGraph().nodes;
    const result = sortElements(allNodes, targetIds, direction);
    if (!result) return;
    const oldOrder = allNodes.map((n) => n.id);
    const newOrder = result.map((n) => n.id);
    this.commandQueue.execute(new ReorderNodesCommand(oldOrder, newOrder));
  }
}

// ===== LayoutPlugin =====

export class LayoutPlugin implements Plugin {
  id = 'layout';
  dependencies = ['render-react'];

  private controller?: LayoutController;

  install(context: PluginContext): void {
    const renderPlugin = context.getPlugin<RenderReactPlugin>('render-react');
    const store = renderPlugin?.getStore();
    if (!store) {
      throw new Error('LayoutPlugin requires RenderReactPlugin to be installed first');
    }
    this.controller = new LayoutControllerImpl(store, context.commandQueue);
  }

  getController(): LayoutController {
    if (!this.controller) {
      throw new Error('LayoutPlugin not installed');
    }
    return this.controller;
  }
}
