/**
 * 标准快捷键注册(copy/paste/delete/duplicate/undo/redo/selectAll/escape)
 *
 * 从 demo/create-default-editor.ts 迁移,保持逻辑一致。
 * Delete handler 安全兜底:选中集中含组节点时走 groupCtrl.deleteNodes(解组保留子节点);
 * 非组节点直接 RemoveNodeCommand。
 * Escape handler 在无选中时返回 false(不消费),让 group:escape-preview 处理预览取消。
 */

import {
  AddNodeCommand,
  AddEdgeCommand,
  RemoveNodeCommand,
  RemoveEdgeCommand,
  BatchCommand,
} from '@zeroexo/core';
import type { NodeRecord, EdgeRecord, Command, CommandQueue, GraphModel } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { HistoryPlugin } from '@zeroexo/plugin-history';
import type { KeyboardPlugin } from '@zeroexo/plugin-keyboard';
import type { GroupController } from '@zeroexo/plugin-group';

// 剪贴板:模块级状态,std:copy/std:duplicate 写入;右键菜单(空白粘贴)通过
// pasteClipboard/hasClipboardContent 复用。每次 registerStandardShortcuts 重置,保证实例隔离语义。
let clipboard: { nodes: NodeRecord[]; edges: EdgeRecord[] } = { nodes: [], edges: [] };

// ===== 剪贴板复用 API(供右键菜单等 UI 入口调用,与快捷键同源) =====

/** 是否有可粘贴内容(右键菜单显示「粘贴」项的判据) */
export function hasClipboardContent(): boolean {
  return clipboard.nodes.length > 0;
}

/** 粘贴当前剪贴板(与 Ctrl+V 同逻辑):重建 id 映射 + 选中新节点;无内容返回 false */
export function pasteClipboard(store: ReactGraphStore, commandQueue: CommandQueue): boolean {
  if (clipboard.nodes.length === 0) return false;
  const newIds = pasteFromClipboard(clipboard, commandQueue);
  const topIds = filterTopLevelIds(newIds, commandQueue);
  if (topIds.length > 0) store.selectNodes(topIds, false);
  return true;
}

/** 复制指定节点子树(与 Ctrl+D 同逻辑):收集子树+关联连线 → 粘贴 → 选中新节点 */
export function duplicateSubtree(store: ReactGraphStore, commandQueue: CommandQueue, nodeIds: Set<string>): void {
  if (nodeIds.size === 0) return;
  const graph = commandQueue.getState();
  const collected = collectSubtreeIds(graph.nodes, nodeIds);
  const localClip = {
    nodes: graph.nodes
      .filter((n) => collected.has(n.id))
      .map((n) => structuredClone(n)),
    edges: graph.edges
      .filter((edge) => collected.has(edge.source.nodeId) && collected.has(edge.target.nodeId))
      .map((e) => structuredClone(e)),
  };
  const newIds = pasteFromClipboard(localClip, commandQueue);
  const topIds = filterTopLevelIds(newIds, commandQueue);
  if (topIds.length > 0) store.selectNodes(topIds, false);
}

export function registerStandardShortcuts(
  keyboard: KeyboardPlugin,
  deps: {
    store: ReactGraphStore;
    commandQueue: CommandQueue;
    history: HistoryPlugin;
    /** 组控制器(可选):提供组节点安全兜底删除逻辑) */
    groupCtrl?: GroupController;
  },
): () => void {
  const { store, commandQueue, history, groupCtrl } = deps;
  // 每次注册重置剪贴板,保证实例隔离语义(模块级 clipboard 由 std:copy/std:duplicate 写入)
  clipboard = { nodes: [], edges: [] };

  return keyboard.registerShortcuts([
    // Ctrl/Cmd+Z:撤销(Shift 时重做)
    {
      id: 'std:undo',
      meta: { category: 'edit', descriptionKey: 'shortcuts.undo' },
      key: 'z',
      ctrlKey: true,
      handler: (e) => {
        if (e.shiftKey) history.redo();
        else history.undo();
        return true;
      },
    },
    // Ctrl/Cmd+Y:重做
    {
      id: 'std:redo-y',
      meta: { category: 'edit', descriptionKey: 'shortcuts.redo' },
      key: 'y',
      ctrlKey: true,
      handler: () => {
        history.redo();
        return true;
      },
    },
    // Ctrl/Cmd+A:全选
    {
      id: 'std:select-all',
      meta: { category: 'select', descriptionKey: 'shortcuts.selectAll' },
      key: 'a',
      ctrlKey: true,
      handler: (e) => {
        const allIds = store.getGraph().nodes.map((n) => n.id);
        store.selectNodes(allIds, false);
        e.preventDefault();
        return true;
      },
    },
    // Ctrl/Cmd+C:复制(保留组层级,收集选中 + 子组所有子孙 + 关联连线)
    {
      id: 'std:copy',
      meta: { category: 'edit', descriptionKey: 'shortcuts.copy', education: true },
      key: 'c',
      ctrlKey: true,
      handler: (e) => {
        const nodeIds = store.getSelection().selectedNodeIds;
        if (nodeIds.size === 0) return false;
        const graph = commandQueue.getState();
        const collected = collectSubtreeIds(graph.nodes, nodeIds);
        const copiedNodes = graph.nodes
          .filter((n) => collected.has(n.id))
          .map((n) => structuredClone(n));
        // 收集两端都在复制集合内的边
        const copiedEdges = graph.edges
          .filter((edge) => collected.has(edge.source.nodeId) && collected.has(edge.target.nodeId))
          .map((e) => structuredClone(e));
        clipboard = { nodes: copiedNodes, edges: copiedEdges };
        e.preventDefault();
        return true;
      },
    },
    // Ctrl/Cmd+V:粘贴(与右键菜单共用 pasteClipboard 单一事实源)
    {
      id: 'std:paste',
      meta: { category: 'edit', descriptionKey: 'shortcuts.paste', education: true },
      key: 'v',
      ctrlKey: true,
      handler: (e) => {
        if (!pasteClipboard(store, commandQueue)) return false;
        e.preventDefault();
        return true;
      },
    },
    // Ctrl/Cmd+D:原位复制(与右键菜单共用 duplicateSubtree 单一事实源,偏移 20,20,保留组结构 + 连线)
    {
      id: 'std:duplicate',
      meta: { category: 'edit', descriptionKey: 'shortcuts.duplicate', education: true },
      key: 'd',
      ctrlKey: true,
      handler: (e) => {
        const nodeIds = store.getSelection().selectedNodeIds;
        if (nodeIds.size === 0) return false;
        duplicateSubtree(store, commandQueue, nodeIds);
        e.preventDefault();
        return true;
      },
    },
    // Delete/Backspace:删除选中节点(包括组)和边,所有操作打包为 BatchCommand 一次撤销
    // 安全兜底:如果选中集中含组节点,走 groupCtrl.deleteNodes(解组保留子节点)
    {
      id: 'std:delete',
      meta: { category: 'edit', descriptionKey: 'shortcuts.deleteNode' },
      key: ['Delete', 'Backspace'],
      handler: (e) => {
        const { selectedNodeIds, selectedEdgeIds } = store.getSelection();
        if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return false;

        // 检查组节点:有组节点时走 groupCtrl.deleteNodes(解组保留子节点)
        if (groupCtrl && selectedNodeIds.size > 0) {
          const graph = commandQueue.getState();
          const hasGroup = [...selectedNodeIds].some((id) =>
            graph.nodes.find((n) => n.id === id)?.type === 'group',
          );
          if (hasGroup) {
            e.preventDefault();
            groupCtrl.deleteNodes(selectedNodeIds);
            return true;
          }
        }

        const commands: { execute: (state: GraphModel) => GraphModel; undo: (state: GraphModel) => GraphModel }[] = [];

        for (const nodeId of selectedNodeIds) {
          commands.push(new RemoveNodeCommand(nodeId));
        }
        for (const edgeId of selectedEdgeIds) {
          commands.push(new RemoveEdgeCommand(edgeId));
        }

        commandQueue.execute(new BatchCommand(commands as unknown as import('@zeroexo/core').Command[]));
        store.clearSelection();
        e.preventDefault();
        return true;
      },
    },
    // Escape:清空选中(无选中时返回 false,让 group:escape-preview 处理预览取消)
    {
      id: 'std:escape',
      meta: { category: 'select', descriptionKey: 'shortcuts.deselect' },
      key: 'Escape',
      handler: (e) => {
        const { selectedNodeIds, selectedEdgeIds } = store.getSelection();
        if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return false;
        store.clearSelection();
        e.preventDefault();
        return true;
      },
    },
    // Ctrl/Cmd+=:放大
    {
      id: 'std:zoom-in',
      meta: { category: 'view', descriptionKey: 'shortcuts.zoomIn' },
      key: '=',
      ctrlKey: true,
      handler: (e) => {
        const vp = store.getViewport();
        const newK = Math.min(vp.k * 1.2, 5);
        store.setViewport({ ...vp, k: newK });
        e.preventDefault();
        return true;
      },
    },
    // Ctrl/Cmd+-:缩小
    {
      id: 'std:zoom-out',
      meta: { category: 'view', descriptionKey: 'shortcuts.zoomOut' },
      key: '-',
      ctrlKey: true,
      handler: (e) => {
        const vp = store.getViewport();
        const newK = Math.max(vp.k / 1.2, 0.05);
        store.setViewport({ ...vp, k: newK });
        e.preventDefault();
        return true;
      },
    },
    // Ctrl/Cmd+0:重置缩放
    {
      id: 'std:zoom-reset',
      meta: { category: 'view', descriptionKey: 'shortcuts.resetView' },
      key: '0',
      ctrlKey: true,
      handler: (e) => {
        const vp = store.getViewport();
        store.setViewport({ ...vp, k: 1 });
        e.preventDefault();
        return true;
      },
    },
  ]);
}

// ===== 快捷键辅助函数 =====

export function pasteFromClipboard(clipboard: { nodes: NodeRecord[]; edges: EdgeRecord[] }, commandQueue: CommandQueue): string[] {
  const idMap = new Map<string, string>();
  for (const node of clipboard.nodes) {
    idMap.set(node.id, generateId('node'));
  }
  const newIds: string[] = [];
  const commands: Command[] = [];
  // 预计算当前 graph 中已有的组数量，用于粘贴组时自动递增序列
  const currentGraph = commandQueue.getState();
  const existingGroupCount = currentGraph.nodes.filter((n) => n.type === 'group').length;
  let pasteGroupCount = 0;
  for (const node of clipboard.nodes) {
    const newId = idMap.get(node.id)!;
    const isGroup = node.type === 'group';
    // 组节点粘贴时自动递增标题序列
    let title = node.title;
    if (isGroup && title) {
      pasteGroupCount++;
      // 使用 defaultGroupTitle 风格：保留原标题前缀，递增序号
      const label = title.replace(/\s+\d+$/, '');
      title = `${label} ${existingGroupCount + pasteGroupCount}`;
    }
    const cloned: NodeRecord = {
      ...node,
      id: newId,
      title,
      position: isGroup
        ? { x: 0, y: 0 }
        : { x: node.position.x + 20, y: node.position.y + 20 },
      data: structuredClone(node.data),
      parentId: node.parentId ? idMap.get(node.parentId) : undefined,
      childrenIds: node.childrenIds
        ?.map((cid) => idMap.get(cid))
        .filter((v): v is string => v !== undefined),
      bounds: node.bounds
        ? { ...node.bounds, x: node.bounds.x + 20, y: node.bounds.y + 20 }
        : undefined,
      boundsDirty: isGroup ? true : undefined,
    };
    commands.push(new AddNodeCommand(cloned));
    newIds.push(newId);
  }
  // 重建边:更新 source/target 的 nodeId 为新 id
  for (const edge of clipboard.edges) {
    const sourceNodeId = idMap.get(edge.source.nodeId);
    const targetNodeId = idMap.get(edge.target.nodeId);
    if (!sourceNodeId || !targetNodeId) continue;
    const newEdge: EdgeRecord = {
      ...edge,
      id: generateId('edge'),
      source: { ...edge.source, nodeId: sourceNodeId },
      target: { ...edge.target, nodeId: targetNodeId },
    };
    commands.push(new AddEdgeCommand(newEdge));
  }
  if (commands.length === 1) {
    commandQueue.execute(commands[0]!);
  } else if (commands.length > 1) {
    commandQueue.execute(new BatchCommand(commands));
  }
  return newIds;
}

export function filterTopLevelIds(ids: string[], commandQueue: CommandQueue): string[] {
  const graph = commandQueue.getState();
  return ids.filter((id) => {
    const node = graph.nodes.find((n) => n.id === id);
    return !!(node && !node.parentId);
  });
}

export function collectSubtreeIds(nodes: NodeRecord[], selectedIds: Set<string>): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const result = new Set<string>();
  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) continue;
    result.add(id);
    const stack = [...(node.childrenIds ?? [])];
    while (stack.length > 0) {
      const cid = stack.pop()!;
      if (result.has(cid)) continue;
      const child = byId.get(cid);
      if (!child) continue;
      result.add(cid);
      stack.push(...(child.childrenIds ?? []));
    }
  }
  return result;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
