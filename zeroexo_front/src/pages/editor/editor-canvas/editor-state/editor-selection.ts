/**
 * editor-selection - 选中节点计算 + 状态派生
 *
 * 处理 onChanged 回调(选中态变化/推送 graph 变更)。
 * 闭包变量(isInitialized / suppressNextSync)通过 syncState 对象桥接。
 */

import type { NodeRecord } from '@zeroexo/core';
import { onProjectUpdated, markProjectDirty } from '@/services/sync/sync-service.js';
import type { CanvasGraphPayload } from '@/shared/hooks/use-doc-sync.js';
import type { SyncState } from './editor-sync.js';
import type { EditorNodeType } from '../use-editor-state.js';

export interface SelectionDeps {
  store: {
    getGraph: () => { nodes: NodeRecord[]; edges: any[] };
    getSelection: () => { selectedNodeIds: Set<string>; selectedEdgeIds: Set<string> };
    setSelection: (sel: { selectedNodeIds: Set<string>; selectedEdgeIds: Set<string> }) => void;
    clearSelection: () => void;
  };
  history: { canUndo: () => boolean; canRedo: () => boolean };
  pushGraph: (payload: CanvasGraphPayload) => void;
  canvasId: string;
  syncState: SyncState;
  setCanUndo: (v: boolean) => void;
  setCanRedo: (v: boolean) => void;
  setSelectedCount: (v: number) => void;
  setSelectedNodeId: (v: string | null) => void;
  setSelectedNodeType: (v: EditorNodeType | null) => void;
  setSelectedHasGroup: (v: boolean) => void;
  setIsMixedSelection: (v: boolean) => void;
  setSelectedNodeData: (v: Record<string, unknown> | null) => void;
}

export function setupSelection(deps: SelectionDeps): () => void {
  const {
    store,
    history,
    pushGraph,
    canvasId,
    syncState,
    setCanUndo,
    setCanRedo,
    setSelectedCount,
    setSelectedNodeId,
    setSelectedNodeType,
    setSelectedHasGroup,
    setIsMixedSelection,
    setSelectedNodeData,
  } = deps;

  let prevSelectedNodeId: string | null = null;

  const onChanged = () => {
    setCanUndo(history.canUndo());
    setCanRedo(history.canRedo());
    const graph = store.getGraph();
    const selection = store.getSelection();

    // 过滤掉已被删除的选中 ID
    let validIds = selection.selectedNodeIds;
    if (selection.selectedNodeIds.size > 0) {
      const nodeIds = new Set<string>();
      for (const id of selection.selectedNodeIds) {
        if (graph.nodes.find((n) => n.id === id)) {
          nodeIds.add(id);
        }
      }
      if (nodeIds.size !== selection.selectedNodeIds.size) {
        validIds = nodeIds;
        store.setSelection({ selectedNodeIds: nodeIds, selectedEdgeIds: new Set() });
      }
      if (nodeIds.size === 0 && selection.selectedNodeIds.size > 0) {
        store.clearSelection();
        validIds = new Set<string>();
      }
    }

    setSelectedCount(validIds.size);
    // 选中集中是否含组节点 / 是否混合
    let hasGroup = false;
    let hasNonGroup = false;
    if (validIds.size > 0) {
      for (const id of validIds) {
        const node = graph.nodes.find((n: NodeRecord) => n.id === id);
        if (node?.type === 'group') {
          hasGroup = true;
        } else {
          hasNonGroup = true;
        }
      }
    }
    setSelectedHasGroup(hasGroup);
    setIsMixedSelection(hasGroup && hasNonGroup);

    if (validIds.size === 1) {
      const id = validIds.values().next().value;
      if (id) {
        const node = graph.nodes.find((n: NodeRecord) => n.id === id);
        setSelectedNodeId(id);
        setSelectedNodeType(
          node?.type === 'text'
            ? 'text'
            : node?.type === 'image'
              ? 'image'
              : node?.type === 'video'
                ? 'video'
                : node?.type === 'audio'
                  ? 'audio'
                  : node?.type === 'generator'
                    ? 'generator'
                    : node?.type === 'script'
                      ? 'script'
                      : node?.type === 'storyboard'
                        ? 'storyboard'
                        : node?.type === 'workbench'
                          ? 'workbench'
                          : null,
        );
        const data = node?.data;
        setSelectedNodeData(data && typeof data === 'object' ? (data as Record<string, unknown>) : null);
        prevSelectedNodeId = id;
      }
    } else {
      setSelectedNodeId(null);
      setSelectedNodeType(null);
      if (prevSelectedNodeId !== null) {
        setSelectedNodeData(null);
        prevSelectedNodeId = null;
      }
    }

    // graph 变化时触发云同步推送
    if (syncState.isInitialized && !syncState.suppressNextSync) {
      pushGraph({ nodes: graph.nodes, edges: graph.edges });
      onProjectUpdated(canvasId);
      markProjectDirty(canvasId);
    }
    syncState.suppressNextSync = false;
  };

  const unsubGraph = (store as any).subscribeGraph(onChanged as any);
  const unsubSelection = (store as any).subscribeSelection(onChanged as any);
  onChanged();

  return () => {
    unsubGraph();
    unsubSelection();
  };
}