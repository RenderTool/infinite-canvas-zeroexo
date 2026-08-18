/**
 * HierarchyPanel - 层级面板(C 混合解耦方案)
 *
 * 架构:
 * - HierarchyPanel: 纯展示组件(仅 props + callbacks,不依赖 store/controller)
 * - useHierarchyPanelProps(store, controller): hook 自动订阅 store + 构造回调
 *
 * 解耦原则(C 方案):
 * - 组件本体可独立测试(传入 mock props 即可)
 * - hook 承担"数据订阅 + 回调构造",组件不关心数据来源
 * - 应用层可选择:用 hook(自动订阅)或手动构造 props(自定义数据源)
 *
 * 功能:
 * - 树形 DFS 渲染(深度缩进),折叠/展开
 * - 点击选中(Shift 追加),双击重命名
 * - 拖拽 reparent(HTML5 DnD,拖到节点 = 挂为子节点,拖到空白 = 提升到根)
 * - 可见性/锁定/删除快捷操作
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, Eye, EyeOff, FolderOpen, Lock, Trash2, Unlock,
} from 'lucide-react';
import type { SceneNode } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useGraph, useSelection } from '@zeroexo/plugin-render-react';
import type { GroupController } from './controller.js';
import { getRoots, getChildren } from './scene-graph.js';

// ===== Bug7: 节点类型 → i18n 标题 key 映射 =====
const NODE_TYPE_TITLE_KEY: Record<string, string> = {
  text: 'nodes.textTitle',
  'image': 'nodes.imageTitle',
  'video': 'nodes.videoTitle',
  'audio': 'nodes.audioTitle',
};

/** Bug7/Bug8: 获取节点显示名称(优先 node.title,其次 data.title,再次类型默认名,最后回退 id) */
function getNodeDisplayName(node: SceneNode, t: (key: string) => string): string {
  const title = node.title?.trim();
  if (title) return title;
  // Bug8: 部分节点 title 存储在 data.title 中(素材节点/旧数据)
  const dataTitle = (node.data as Record<string, unknown> | undefined)?.title;
  if (typeof dataTitle === 'string' && dataTitle.trim()) return dataTitle.trim();
  const key = NODE_TYPE_TITLE_KEY[node.type];
  if (key) return t(key);
  return node.id;
}

// ===== 类型 =====

/** 扁平化树节点(DFS 遍历结果,含深度) */
export interface HierarchyTreeNode {
  node: SceneNode;
  depth: number;
  hasChildren: boolean;
}

/** 层级过滤条件(内置封装,方便外部调用) */
export interface HierarchyFilter {
  /** 关键字搜索(匹配 title 或 id,大小写不敏感;空字符串=不过滤) */
  search: string;
  /** 类型过滤:'all'=全部, 'group'=仅组, 'node'=仅普通节点 */
  typeFilter: 'all' | 'group' | 'node';
  /** 是否显示 hidden 节点(默认 true) */
  showHidden: boolean;
  /** 是否显示 locked 节点(默认 true) */
  showLocked: boolean;
}

/** 默认过滤条件(不过滤,显示全部) */
export const DEFAULT_HIERARCHY_FILTER: HierarchyFilter = {
  search: '',
  typeFilter: 'all',
  showHidden: true,
  showLocked: true,
};

/**
 * 内置过滤算法:判断节点是否通过过滤条件。
 * 纯函数,可被外部直接调用(如 minimap 过滤、导出筛选等)。
 *
 * @param node 场景节点
 * @param filter 过滤条件
 * @returns true=通过(显示), false=过滤掉
 */
export function matchHierarchyFilter(node: SceneNode, filter: HierarchyFilter): boolean {
  // hidden 过滤
  if (!filter.showHidden && node.hidden) return false;
  // locked 过滤
  if (!filter.showLocked && node.locked) return false;
  // 类型过滤
  if (filter.typeFilter === 'group' && node.type !== 'group') return false;
  if (filter.typeFilter === 'node' && node.type === 'group') return false;
  // 关键字搜索(匹配 title 或 id)
  if (filter.search) {
    const kw = filter.search.toLowerCase();
    const title = (node.title ?? node.id).toLowerCase();
    if (!title.includes(kw) && !node.id.toLowerCase().includes(kw)) return false;
  }
  return true;
}

/**
 * 批量过滤:对场景节点数组应用过滤,返回通过过滤的节点数组。
 * 组节点过滤时,其子节点不自动包含(调用方自行决定是否展开子树)。
 */
export function filterSceneNodes(
  scene: SceneNode[],
  filter: HierarchyFilter,
): SceneNode[] {
  return scene.filter((n) => matchHierarchyFilter(n, filter));
}

/** 纯展示组件 props(不依赖 store/controller) */
export interface HierarchyPanelProps {
  tree: HierarchyTreeNode[];
  selectedIds: Set<string>;
  collapsedIds: Set<string>;
  renamingId: string | null;
  renamingValue: string;
  /** 过滤条件(由 hook 管理,传入纯展示组件) */
  filter: HierarchyFilter;
  onSelect: (id: string, additive: boolean) => void;
  onToggleCollapse: (id: string) => void;
  onStartRename: (id: string) => void;
  onRenameChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onReparent: (nodeId: string, newParentId: string | null) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  /** 过滤条件变更回调 */
  onFilterChange: (patch: Partial<HierarchyFilter>) => void;
}

// ===== 纯展示组件 =====

export const HierarchyPanel = React.memo(function HierarchyPanel({
  tree,
  selectedIds,
  collapsedIds,
  renamingId,
  renamingValue,
  filter,
  onSelect,
  onToggleCollapse,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onReparent,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onFilterChange,
}: HierarchyPanelProps): React.ReactElement {
  const dragIdRef = useRef<string | null>(null);
  const { t } = useTranslation();

  return (
    <div
      data-hierarchy-panel
      style={{ fontSize: 12, userSelect: 'none', minHeight: 40, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {/* 过滤工具栏(搜索 + 类型筛选) */}
      <div style={{ padding: '4px 8px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="搜索节点..."
          value={filter.search}
          onChange={(e) => onFilterChange({ search: e.target.value })}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '4px 8px',
            fontSize: 11,
            background: 'rgba(15,22,41,0.8)',
            border: '1px solid #1a2640',
            borderRadius: 4,
            color: '#e0e6ed',
            outline: 'none',
            marginBottom: 4,
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'group', 'node'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => onFilterChange({ typeFilter: tf })}
              style={{
                flex: 1,
                padding: '2px 4px',
                fontSize: 10,
                border: '1px solid #1a2640',
                borderRadius: 3,
                cursor: 'pointer',
                background: filter.typeFilter === tf ? '#1a2640' : 'transparent',
                color: filter.typeFilter === tf ? '#e0e6ed' : '#6272a4',
              }}
            >
              {tf === 'all' ? '全部' : tf === 'group' ? '组' : '节点'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6272a4', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filter.showHidden}
              onChange={(e) => onFilterChange({ showHidden: e.target.checked })}
              style={{ width: 10, height: 10 }}
            />
            隐藏项
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#6272a4', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filter.showLocked}
              onChange={(e) => onFilterChange({ showLocked: e.target.checked })}
              style={{ width: 10, height: 10 }}
            />
            锁定项
          </label>
        </div>
      </div>
      {/* 树形列表(可滚动,拖到空白=提升到根级) */}
      <div
        style={{ flex: 1, overflowY: 'auto' }}
        onDragOver={(e) => {
          if (dragIdRef.current) e.preventDefault();
        }}
        onDrop={() => {
          if (dragIdRef.current) {
            onReparent(dragIdRef.current, null);
            dragIdRef.current = null;
          }
        }}
      >
      {tree.length === 0 ? (
        <div style={{ padding: '8px 12px', color: '#6272a4', fontStyle: 'italic' }}>
          画布无节点
        </div>
      ) : (
        tree.map(({ node, depth, hasChildren }) => {
          const isSelected = selectedIds.has(node.id);
          const isCollapsed = collapsedIds.has(node.id);
          const isRenaming = renamingId === node.id;
          const group = node.type === 'group';
          const hidden = node.hidden ?? false;
          const locked = node.locked ?? false;
          return (
            <div
              key={node.id}
              data-hierarchy-id={node.id}
              draggable={!isRenaming}
              onDragStart={(e) => {
                dragIdRef.current = node.id;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                // 只有组节点可接收子节点(普通节点是最小单元,不接收子类)
                // 不允许拖到自己或自己的后代(后代检测在 controller 的 reparentNode 循环引用检测)
                if (group && dragIdRef.current && dragIdRef.current !== node.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                // 普通节点不接收 drop
                if (!group) return;
                e.preventDefault();
                e.stopPropagation();
                if (dragIdRef.current && dragIdRef.current !== node.id) {
                  onReparent(dragIdRef.current, node.id);
                }
                dragIdRef.current = null;
              }}
              onClick={(e) => onSelect(node.id, e.shiftKey)}
              onDoubleClick={() => onStartRename(node.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                paddingLeft: 8 + depth * 16,
                paddingRight: 8,
                height: 24,
                cursor: 'pointer',
                backgroundColor: isSelected ? 'rgba(233, 69, 96, 0.2)' : 'transparent',
                borderLeft: isSelected ? '2px solid #e94560' : '2px solid transparent',
                color: hidden ? '#6272a4' : '#e0e6ed',
                opacity: hidden ? 0.5 : 1,
              }}
            >
              {/* 折叠箭头 */}
              {hasChildren ? (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(node.id);
                  }}
                  style={{ width: 14, textAlign: 'center', color: '#8b9bb4', flexShrink: 0 }}
                >
                  {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                </span>
              ) : (
                <span style={{ width: 14, flexShrink: 0 }} />
              )}
              {/* 类型图标 */}
              <span style={{ width: 14, textAlign: 'center', flexShrink: 0 }}>
                {group ? <FolderOpen size={12} /> : null}
              </span>
              {/* 标题 / 重命名输入 */}
              {isRenaming ? (
                <input
                  autoFocus
                  value={renamingValue}
                  onChange={(e) => onRenameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onCommitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      onCancelRename();
                    }
                  }}
                  onBlur={() => onCommitRename()}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    background: '#0f1729',
                    border: '1px solid #50fa7b',
                    borderRadius: 3,
                    color: '#e0e6ed',
                    padding: '0 4px',
                    outline: 'none',
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {group
                    ? (node.title?.trim() ? node.title : t('groupTools.defaultGroupName'))
                    : getNodeDisplayName(node, t)}
                </span>
              )}
              {/* 快捷操作:可见性 / 锁定 / 删除 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(node.id);
                }}
                title={hidden ? '显示' : '隐藏'}
                style={iconBtn}
              >
                {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLock(node.id);
                }}
                title={locked ? '解锁' : '锁定'}
                style={iconBtn}
              >
                {locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node.id);
                }}
                title="删除"
                style={{ ...iconBtn, color: '#e94560' }}
             >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })
      )}
      </div>
    </div>
  );
});

// ===== Hook:自动订阅 + 构造回调(C 方案的"粘合层") =====

/**
 * 自动订阅 store + 构造 HierarchyPanel 所需 props。
 * 应用层调用:`<HierarchyPanel {...useHierarchyPanelProps(store, controller)} />`
 *
 * 本地状态:折叠集合、重命名 id/值
 * 数据来源:store(graph + selection)
 * 回调:调用 GroupController 方法(支持撤销)
 */
export function useHierarchyPanelProps(
  store: ReactGraphStore,
  controller: GroupController,
): HierarchyPanelProps {
  const graph = useGraph(store);
  const selection = useSelection(store);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [filter, setFilter] = useState<HierarchyFilter>(DEFAULT_HIERARCHY_FILTER);

  // 构建 flattened tree(DFS,跳过折叠子树,应用过滤)
  // useMemo 避免每次渲染重建整棵树 —— 动画期间如果 store 未变,直接复用缓存
  const tree = useMemo<HierarchyTreeNode[]>(() => {
    const result: HierarchyTreeNode[] = [];
    const scene = graph.nodes;
    const roots = getRoots(scene);
    const dfs = (nodes: SceneNode[], depth: number): void => {
      for (const node of nodes) {
        const matches = matchHierarchyFilter(node, filter);
        const children = getChildren(scene, node.id);
        const hasChildren = children.length > 0;
        if (matches) {
          result.push({ node, depth, hasChildren });
        }
        const shouldRecurse = hasChildren && (filter.search !== '' || !collapsedIds.has(node.id));
        if (shouldRecurse) {
          dfs(children, depth + 1);
        }
      }
    };
    dfs(roots, 0);
    return result;
  }, [graph.nodes, filter, collapsedIds]);

  // 过滤条件变更回调(稳定化)
  const onFilterChange = useCallback((patch: Partial<HierarchyFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
  }, []);

  // ===== 回调(稳定化,避免 HierarchyPanel memo 失效) =====
  const onSelect = useCallback(
    (id: string, additive: boolean) => {
      store.selectNodes([id], additive);
    },
    [store],
  );

  const onToggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onStartRename = useCallback(
    (id: string) => {
      const node = store.getGraph().nodes.find((n) => n.id === id);
      // Bug7: 统一使用 node.title 作为重命名初始值(空标题时初始值为空字符串)
      const title = node ? (node.title ?? '') : '';
      setRenamingId(id);
      setRenamingValue(title);
    },
    [store],
  );

  const onRenameChange = useCallback((value: string) => {
    setRenamingValue(value);
  }, []);

  const onCommitRename = useCallback(() => {
    if (renamingId) {
      const node = store.getGraph().nodes.find((n) => n.id === renamingId);
      if (node && node.type === 'group') {
        // 组节点:允许空标题(空字符串,不用 trim 后的值,保留用户输入的原样)
        controller.renameGroup(renamingId, renamingValue);
      } else if (node) {
        // 普通节点:使用 renameNode 同时更新 node.title 和 node.data.title
        store.renameNode(renamingId, renamingValue.trim());
      }
    }
    setRenamingId(null);
    setRenamingValue('');
  }, [controller, store, renamingId, renamingValue]);

  const onCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenamingValue('');
  }, []);

  const onReparent = useCallback(
    (nodeId: string, newParentId: string | null) => {
      controller.reparentNode(nodeId, newParentId);
    },
    [controller],
  );

  const onToggleVisibility = useCallback(
    (id: string) => {
      const node = store.getGraph().nodes.find((n) => n.id === id);
      if (!node) return;
      controller.setNodeHidden(id, !(node.hidden ?? false));
    },
    [controller, store],
  );

  const onToggleLock = useCallback(
    (id: string) => {
      const node = store.getGraph().nodes.find((n) => n.id === id);
      if (!node) return;
      controller.setNodeLocked(id, !(node.locked ?? false));
    },
    [controller, store],
  );

  const onDelete = useCallback(
    (id: string) => {
      // 组节点:解组(ungroup 保留子节点)
      // 普通节点:删除节点及其子树(deleteSceneNode 移除整个子树)
      const node = store.getGraph().nodes.find((n) => n.id === id);
      if (!node) return;
      if (node.type === 'group') {
        controller.ungroup([id]);
      } else {
        controller.deleteSceneNode(id);
      }
    },
    [controller, store],
  );

  return {
    tree,
    selectedIds: selection.selectedNodeIds,
    collapsedIds,
    renamingId,
    renamingValue,
    filter,
    onSelect,
    onToggleCollapse,
    onStartRename,
    onRenameChange,
    onCommitRename,
    onCancelRename,
    onReparent,
    onToggleVisibility,
    onToggleLock,
    onDelete,
    onFilterChange,
  };
}

// ===== 样式 =====

const iconBtn: React.CSSProperties = {
  padding: 0,
  width: 18,
  height: 18,
  fontSize: 11,
  lineHeight: '18px',
  textAlign: 'center',
  background: 'transparent',
  border: 'none',
  color: '#8b9bb4',
  cursor: 'pointer',
  flexShrink: 0,
};
