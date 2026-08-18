/**
 * Group Service - 基于 Scene Graph 的 Group 操作纯函数。
 *
 * 所有操作均基于 SceneNode[](NodeRecord[]),不再区分节点/组类型。
 * Parent 修改入口严格收口,仅以下 7 个操作可改 parentId:
 * - confirmGroupFromPreview(创建组)
 * - addGroupToHierarchy(插入组到层级)
 * - ungroupByIds(解组)
 * - dragIntoGroup(显式拖入命令)
 * - dragOutOfGroup(显式拖出命令)
 * - reparentNode(层级面板 reparent)
 * - renameGroup(重命名,group 操作入口)
 *
 * 移动 Group / 移动 Node 永不修改 parentId。
 * 不存在自动吸附和隐式层级变化。
 */

import type { SceneNode, Rect } from '@zeroexo/core';
import {
  buildById,
  computeNewLogicalIndex,
  computePromotedBounds,
  createGroupNode,
  defaultGroupTitle,
  detectCircularReference,
  getAncestorIds,
  getDescendantIds,
  getGroupBounds,
  getLeafDescendants,
  getVersionFolderData,
  isDescendantOf,
  markAncestorBoundsDirty,
  promoteSelectionToOutermost,
  type PromotedSelection,
} from './scene-graph.js';

/**
 * 创建新组并插入 Scene Graph。
 * 返回 { scene, group } 或 null(创建失败)。
 */
export function confirmGroupFromPreview(
  scene: SceneNode[],
  selectedNodeIds: Set<string>,
  bounds: Rect,
  groupLabel?: string,
): { scene: SceneNode[]; group: SceneNode } | null {
  if (selectedNodeIds.size < 2) return null;

  const promoted = promoteSelectionToOutermost(scene, selectedNodeIds);
  const promotedGroupIds = promoted.groups.map((g) => g.id);
  const promotedNodeIds = promoted.nodes.map((n) => n.id);

  if (promotedGroupIds.length === 0 && promotedNodeIds.length < 2) return null;

  // 祖先冲突检测:避免把祖先+后代一起当兄弟
  const allAncestors = new Set<string>();
  for (const gid of promotedGroupIds) {
    getAncestorIds(scene, gid).forEach((a) => allAncestors.add(a));
  }
  for (const gid of promotedGroupIds) {
    if (allAncestors.has(gid)) return null;
  }

  // 计算 bestParentId
  let bestParentId: string | null = null;
  const allPromotedIds = [...promotedGroupIds, ...promotedNodeIds];
  const parentIds = new Set<string | null>();

  for (const id of allPromotedIds) {
    const node = buildById(scene).get(id);
    if (node && node.parentId) {
      parentIds.add(node.parentId);
    } else if (node && promotedGroupIds.includes(node.id)) {
      parentIds.add(node.parentId ?? null);
    } else {
      parentIds.add(null);
    }
  }

  if (parentIds.size === 1) {
    bestParentId = parentIds.values().next().value ?? null;
  } else if (promotedGroupIds.length > 0) {
    // 有 promotedGroup 时,强制取第一个 promotedGroup 的原 parentId
    const firstPromoted = scene.find((n) => n.id === promotedGroupIds[0]);
    bestParentId = firstPromoted?.parentId ?? null;
  } else {
    bestParentId = null;
  }

  // 计算 logicalIndex
  const logicalIndex = computeNewLogicalIndex(scene, promoted, bestParentId);

  // 创建新组
  const newGroup = createGroupNode({
    title: defaultGroupTitle(scene.filter((n) => n.type === 'group').length, groupLabel),
    parentId: bestParentId,
    logicalIndex,
    childrenIds: [...promotedNodeIds, ...promotedGroupIds],
    bounds,
  });

  // 循环引用检测
  if (detectCircularReference(scene, newGroup.id, bestParentId)) return null;

  // 插入树并调整父子关系
  const newScene = addGroupToHierarchy(scene, newGroup, promoted);
  return { scene: newScene, group: newGroup };
}

/**
 * 创建 Version Folder 组(版本文件夹)
 * 当前仅支持图片类型节点(image)聚合,选中节点必须为 image 类型。
 * 返回 { scene, group, excludedIds } 或 null(创建失败,如选中 <2 节点或非图片节点)。
 */
export function createVersionFolder(
  scene: SceneNode[],
  selectedNodeIds: Set<string>,
): { scene: SceneNode[]; group: SceneNode; excludedIds: string[] } | null {
  if (selectedNodeIds.size < 2) return null;

  // 1. 仅筛选 image 类型节点
  const matchingIds: string[] = [];
  const excludedIds: string[] = [];
  for (const id of selectedNodeIds) {
    const node = scene.find((n) => n.id === id);
    if (!node) continue;
    if (node.type === 'image') {
      matchingIds.push(id);
    } else {
      excludedIds.push(id);
    }
  }
  if (matchingIds.length < 2) return null;

  // 2. 计算 bounds(包含所有匹配节点)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of matchingIds) {
    const n = scene.find((nn) => nn.id === id);
    if (!n) continue;
    const w = n.size?.width ?? 200;
    const h = n.size?.height ?? 150;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  const bounds: Rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  // 3. 创建 StackedCardsNode(叠卡版本组),设置 versionFolder 数据
  const newGroup = createGroupNode({
    title: '图片版本组',
    parentId: null,
    logicalIndex: 0,
    childrenIds: matchingIds,
    bounds,
    data: {
      versionFolder: true,
      previewMode: 'stacked',
      activeVersionId: matchingIds[0],
      memberType: 'image',
      createdAt: Date.now(),
    },
  });

  // 5. 插入组并调整父子关系
  const promoted = promoteSelectionToOutermost(scene, new Set(matchingIds));
  const newScene = addGroupToHierarchy(scene, newGroup, promoted);

  return { scene: newScene, group: newGroup, excludedIds };
}

/**
 * 把新 Group 插入 Scene Graph,调整父子关系:
 * - 新组的 children 从原父组移除(childrenIds)
 * - 新组追加到 bestParentId 的 childrenIds
 * - 子组的 parentId 改为新组 id
 */
export function addGroupToHierarchy(
  scene: SceneNode[],
  newGroup: SceneNode,
  promoted: PromotedSelection,
): SceneNode[] {
  const promotedNodeIds = new Set(promoted.nodes.map((n) => n.id));
  const promotedGroupIds = new Set(promoted.groups.map((g) => g.id));
  const newChildrenIds = newGroup.childrenIds ?? [];
  const newChildSet = new Set(newChildrenIds);

  let next = [...scene, newGroup];

  // 1. 若新组有 parentId:从父组 childrenIds 中移除新组的直接子节点,追加新组
  if (newGroup.parentId) {
    next = next.map((n) => {
      if (n.id !== newGroup.parentId) return n;
      const existing = n.childrenIds ?? [];
      const filteredChildren = existing.filter((cid) => !newChildSet.has(cid));
      return {
        ...n,
        childrenIds: [...filteredChildren, newGroup.id],
        boundsDirty: true,
      };
    });
  }

  // 2. 从所有原父组中移除被提升的子组和子节点(它们的 parentId 将改为新组)
  next = next.map((n) => {
    if (n.type !== 'group') return n;
    if (n.id === newGroup.id) return n;
    const existing = n.childrenIds ?? [];
    const filteredChildren = existing.filter(
      (cid) => !promotedGroupIds.has(cid) && !promotedNodeIds.has(cid),
    );
    if (filteredChildren.length !== existing.length) {
      return { ...n, childrenIds: filteredChildren, boundsDirty: true };
    }
    return n;
  });

  // 3. 子组和子节点的 parentId 改为新组 id
  next = next.map((n) => {
    if (promotedGroupIds.has(n.id) || promotedNodeIds.has(n.id)) {
      return { ...n, parentId: newGroup.id };
    }
    return n;
  });

  // 4. 设置新组孩子的 siblingOrder(保持原顺序)
  next = next.map((n) => {
    if (!newChildSet.has(n.id)) return n;
    const idx = newChildrenIds.indexOf(n.id);
    return { ...n, siblingOrder: idx >= 0 ? idx : (n.siblingOrder ?? 0) };
  });

  return next;
}

/**
 * 移除所有空组(无子节点的组壳)。
 * 嵌套场景:内层空组移除后可能导致外层变空,循环直至稳定。
 * 返回清理后的 scene;无空组时原样返回(引用不变,供调用方判空跳过)。
 */
export function removeEmptyGroups(scene: SceneNode[]): SceneNode[] {
  let current = scene;
  for (;;) {
    const emptyIds = new Set(
      current
        .filter((n) => n.type === 'group' && !(n.childrenIds?.length))
        .map((n) => n.id),
    );
    if (emptyIds.size === 0) return current;
    // 空组壳直接移除(无子节点,无需提升);同步从父组 childrenIds 剔除
    current = current
      .filter((n) => !emptyIds.has(n.id))
      .map((n) =>
        n.childrenIds?.some((c) => emptyIds.has(c))
          ? { ...n, childrenIds: n.childrenIds.filter((c) => !emptyIds.has(c)) }
          : n,
      );
  }
}

/**
 * 解组:删除指定 Group,孩子自动提升一级。
 * - 节点归还到祖父组的 childrenIds(若有)
 * - 子组的 parentId 改为祖父组 id(或 null)
 * 保持 Position/Rotation/Scale 不变。
 */
export function ungroupByIds(scene: SceneNode[], groupIds: string[]): SceneNode[] {
  if (!groupIds.length) return scene;
  const idsToRemove = new Set(groupIds);
  const byId = buildById(scene);

  let result = scene.filter((n) => !idsToRemove.has(n.id));

  for (const removedId of groupIds) {
    const removed = byId.get(removedId);
    if (!removed) continue;
    const grandParentId = removed.parentId ?? null;
    const removedChildren = removed.childrenIds ?? [];
    const isVersionFolder = getVersionFolderData(removed)?.versionFolder === true;

    // 节点归还 / 子组提升:把 removed 的孩子挂到 grandParentId
    for (const childId of removedChildren) {
      result = result.map((n) => {
        if (n.id !== childId) return n;
        // 版本文件夹解组时,清除子节点的 data(恢复为普通节点)
        if (isVersionFolder) {
          return { ...n, parentId: grandParentId, data: undefined };
        }
        return { ...n, parentId: grandParentId };
      });
    }

    // 追加孩子到祖父组的 childrenIds
    if (grandParentId && !idsToRemove.has(grandParentId)) {
      result = result.map((n) => {
        if (n.id !== grandParentId) return n;
        const existing = n.childrenIds ?? [];
        const existingChildren = new Set(existing);
        const newChildren = removedChildren.filter((cid) => !existingChildren.has(cid));
        return {
          ...n,
          childrenIds: [...existing, ...newChildren],
          boundsDirty: true,
        };
      });
    }
  }

  // 重排 siblingOrder
  result = reorderSiblingOrder(result);
  return result;
}

/**
 * 显式拖入命令:把节点加入目标 Group。
 * - 从原父组 childrenIds 移除
 * - 追加到目标组 childrenIds
 * - 修改 parentId 为目标组 id
 * - 标记目标组及祖先 bounds dirty
 */
export function dragIntoGroup(
  scene: SceneNode[],
  nodeIds: string[],
  targetGroupId: string,
): SceneNode[] {
  if (!nodeIds.length) return scene;
  const idSet = new Set(nodeIds);

  // 循环引用检测:不能把目标组的祖先拖入目标组
  for (const nid of nodeIds) {
    if (nid === targetGroupId) return scene;
    if (isDescendantOf(scene, targetGroupId, nid)) return scene;
  }

  let next = scene;

  // 从原父组移除
  next = next.map((n) => {
    if (n.type !== 'group') return n;
    const existing = n.childrenIds ?? [];
    if (!existing.some((cid) => idSet.has(cid))) return n;
    return {
      ...n,
      childrenIds: existing.filter((cid) => !idSet.has(cid)),
      boundsDirty: true,
    };
  });

  // 修改被拖入节点的 parentId,并更新 logicalIndex
  const targetGroup = buildById(next).get(targetGroupId);
  const targetLogicalIndex = targetGroup?.logicalIndex ?? 0;
  next = next.map((n) => {
    if (!idSet.has(n.id)) return n;
    return {
      ...n,
      parentId: targetGroupId,
      logicalIndex: targetLogicalIndex + 1,
    };
  });

  // 追加到目标组 childrenIds
  next = next.map((n) => {
    if (n.id !== targetGroupId) return n;
    const existing = n.childrenIds ?? [];
    const existingChildren = new Set(existing);
    const newChildren = nodeIds.filter((cid) => !existingChildren.has(cid));
    return {
      ...n,
      childrenIds: [...existing, ...newChildren],
      boundsDirty: true,
    };
  });

  // 重排 siblingOrder
  next = reorderSiblingOrder(next);
  return next;
}

/**
 * 显式拖出命令:把节点移出当前 Group,回到祖父组或根级。
 * - 从当前父组 childrenIds 移除
 * - parentId 改为祖父组 id 或 null
 */
export function dragOutOfGroup(scene: SceneNode[], nodeIds: string[]): SceneNode[] {
  if (!nodeIds.length) return scene;
  const byId = buildById(scene);

  let next = scene;

  // 收集每个节点的当前父组与祖父组
  for (const nid of nodeIds) {
    const node = byId.get(nid);
    if (!node || !node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent) continue;
    const grandParentId = parent.parentId ?? null;

    // 修改 parentId
    next = next.map((n) => {
      if (n.id !== nid) return n;
      return {
        ...n,
        parentId: grandParentId,
        logicalIndex: grandParentId ? (byId.get(grandParentId)?.logicalIndex ?? 0) + 1 : 0,
      };
    });

    // 从父组 childrenIds 移除
    next = next.map((n) => {
      if (n.id !== parent.id) return n;
      const existing = n.childrenIds ?? [];
      return {
        ...n,
        childrenIds: existing.filter((cid) => cid !== nid),
        boundsDirty: true,
      };
    });

    // 追加到祖父组 childrenIds(若有)
    if (grandParentId) {
      next = next.map((n) => {
        if (n.id !== grandParentId) return n;
        const existing = n.childrenIds ?? [];
        if (existing.includes(nid)) return n;
        return {
          ...n,
          childrenIds: [...existing, nid],
          boundsDirty: true,
        };
      });
    }
  }

  next = reorderSiblingOrder(next);
  return next;
}

/**
 * 层级面板 reparent:把 nodeId 挂到 newParentId 下。
 * 带循环引用检测。
 */
export function reparentNode(
  scene: SceneNode[],
  nodeId: string,
  newParentId: string | null,
): SceneNode[] {
  if (detectCircularReference(scene, nodeId, newParentId)) return scene;

  const byId = buildById(scene);
  const node = byId.get(nodeId);
  if (!node) return scene;
  // 守卫:只有组节点(type==='group')可作父节点(普通节点是最小单元,不接收子类)
  if (newParentId) {
    const newParent = byId.get(newParentId);
    if (!newParent || newParent.type !== 'group') return scene;
  }
  const oldParentId = node.parentId ?? null;

  let next = scene;

  // 从原父组移除
  if (oldParentId) {
    next = next.map((n) => {
      if (n.id !== oldParentId) return n;
      const existing = n.childrenIds ?? [];
      return {
        ...n,
        childrenIds: existing.filter((cid) => cid !== nodeId),
        boundsDirty: true,
      };
    });
  }

  // 修改 parentId 与 logicalIndex
  const newParent = newParentId ? byId.get(newParentId) : null;
  const newLogicalIndex = newParent ? (newParent.logicalIndex ?? 0) + 1 : 0;
  next = next.map((n) => {
    if (n.id !== nodeId) return n;
    return { ...n, parentId: newParentId, logicalIndex: newLogicalIndex };
  });

  // 追加到新父组 childrenIds
  if (newParentId) {
    next = next.map((n) => {
      if (n.id !== newParentId) return n;
      const existing = n.childrenIds ?? [];
      if (existing.includes(nodeId)) return n;
      return {
        ...n,
        childrenIds: [...existing, nodeId],
        boundsDirty: true,
      };
    });
  }

  next = reorderSiblingOrder(next);
  return next;
}

/** 重命名 Group */
export function renameGroup(scene: SceneNode[], groupId: string, title: string): SceneNode[] {
  return scene.map((n) => (n.id === groupId ? { ...n, title: title.trim() || n.title } : n));
}

/** 设置 Group 背景色 */
export function setGroupBackground(
  scene: SceneNode[],
  groupId: string,
  color: string | undefined,
): SceneNode[] {
  return scene.map((n) => (n.id === groupId ? { ...n, backgroundColor: color } : n));
}

/** 设置 Group 圆角(radius=undefined 清除自定义恢复默认 8) */
export function setGroupBorderRadius(
  scene: SceneNode[],
  groupId: string,
  radius: number | undefined,
): SceneNode[] {
  return scene.map((n) => (n.id === groupId ? { ...n, borderRadius: radius } : n));
}

/**
 * 设置节点外观字段(通用,group 和普通节点共用)。
 * 支持任意 NodeRecord 顶层外观字段 patch(backgroundColor/outlineColor/outlineWidth/
 * outlineOffset/borderRadius/opacity/nodeColor/titleBackgroundColor/contentBackgroundColor/
 * theme/pinColor/pinShape/pinSize 等)。
 * patch 中 undefined 值会清除该字段(恢复默认)。
 */
export function setNodeAppearance(
  scene: SceneNode[],
  nodeId: string,
  patch: Partial<SceneNode>,
): SceneNode[] {
  return scene.map((n) => (n.id === nodeId ? { ...n, ...patch } : n));
}

/** 切换节点隐藏状态(hidden=true 不渲染不参与命中) */
export function setNodeHidden(scene: SceneNode[], nodeId: string, hidden: boolean): SceneNode[] {
  return scene.map((n) => (n.id === nodeId ? { ...n, hidden } : n));
}

/** 切换节点锁定状态(locked=true 不可编辑不可拖拽) */
export function setNodeLocked(scene: SceneNode[], nodeId: string, locked: boolean): SceneNode[] {
  return scene.map((n) => (n.id === nodeId ? { ...n, locked } : n));
}

/**
 * Resize Group:仅更新 bounds 缓存,标记 dirty。
 * 注意:按需求第十一节,Group Resize 应遍历叶子节点缩放。
 * 当前实现保留"仅改 bounds"的简化行为(与原代码一致),后续可扩展。
 */
export function resizeGroup(scene: SceneNode[], groupId: string, newBounds: Rect): SceneNode[] {
  return scene.map((n) => (n.id === groupId ? { ...n, bounds: newBounds, boundsDirty: false } : n));
}

/**
 * 移动 Group:遍历所有叶子后代,平移 position。
 * 不修改 parentId。移动完成标记所有祖先 bounds dirty。
 * BFS 遍历同步所有子孙 position + 组自身 bounds 缓存。
 */
export function moveGroup(scene: SceneNode[], groupId: string, dx: number, dy: number): SceneNode[] {
  const descendantLeafIds = new Set(getLeafDescendants(scene, groupId).map((n) => n.id));
  const groupDescendantIds = new Set(getDescendantIds(scene, groupId));

  let result = scene.map((n) => {
    if (descendantLeafIds.has(n.id)) {
      return {
        ...n,
        position: { x: n.position.x + dx, y: n.position.y + dy },
      };
    }
    // Group 自身的 bounds 也平移(缓存)
    if (groupDescendantIds.has(n.id) || n.id === groupId) {
      if (n.bounds) {
        return {
          ...n,
          bounds: {
            x: n.bounds.x + dx,
            y: n.bounds.y + dy,
            width: n.bounds.width,
            height: n.bounds.height,
          },
        };
      }
    }
    return n;
  });

  // 标记被移动 Group 的所有祖先 bounds dirty(与 moveNodes 行为一致)
  result = markAncestorBoundsDirty(result, groupId);
  return result;
}

/** 移动节点:平移 position,标记所有祖先 bounds dirty */
export function moveNodes(
  scene: SceneNode[],
  nodeIds: Set<string>,
  dx: number,
  dy: number,
): SceneNode[] {
  let next = scene.map((n) =>
    nodeIds.has(n.id)
      ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
      : n,
  );
  // 标记所有移动节点的祖先 bounds dirty
  for (const nid of nodeIds) {
    next = markAncestorBoundsDirty(next, nid);
  }
  return next;
}

/**
 * 按 nodeId 列表删除节点,并清理 Group 的 childrenIds 引用。
 */
export function deleteNodesFromScene(scene: SceneNode[], nodeIds: Set<string>): SceneNode[] {
  if (!nodeIds.size) return scene;
  // 收集所有后代(删除组时连带子节点)
  const allIdsToRemove = new Set<string>(nodeIds);
  for (const nid of nodeIds) {
    getDescendantIds(scene, nid).forEach((did) => allIdsToRemove.add(did));
  }

  let next = scene.filter((n) => !allIdsToRemove.has(n.id));

  // 清理 Group childrenIds 引用,标记 dirty
  next = next.map((n) => {
    if (n.type !== 'group') return n;
    const existing = n.childrenIds ?? [];
    const filteredChildren = existing.filter((cid) => !allIdsToRemove.has(cid));
    if (filteredChildren.length !== existing.length) {
      return { ...n, childrenIds: filteredChildren, boundsDirty: true };
    }
    return n;
  });

  return next;
}

/**
 * 重排所有兄弟组的 siblingOrder,按父分组保持原数组顺序。
 */
export function reorderSiblingOrder(scene: SceneNode[]): SceneNode[] {
  const byParent = new Map<string | null, SceneNode[]>();
  for (const n of scene) {
    const key = n.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }

  const orderMap = new Map<string, number>();
  for (const [, siblings] of byParent) {
    siblings.forEach((n, i) => orderMap.set(n.id, i));
  }

  return scene.map((n) => {
    const newOrder = orderMap.get(n.id);
    return newOrder !== undefined && newOrder !== n.siblingOrder
      ? { ...n, siblingOrder: newOrder }
      : n;
  });
}

/**
 * 计算预览组 bounds(基于 promoted 选择集)。
 */
export function computePreviewBounds(scene: SceneNode[], selectedNodeIds: Set<string>): Rect | null {
  const promoted = promoteSelectionToOutermost(scene, selectedNodeIds);
  return computePromotedBounds(scene, promoted);
}

/**
 * 判断节点是否在指定 Group bounds 内(用于显式拖入判定)。
 */
export function isNodeInsideGroupBounds(
  scene: SceneNode[],
  nodeId: string,
  groupId: string,
): boolean {
  const byId = buildById(scene);
  const node = byId.get(nodeId);
  const group = byId.get(groupId);
  if (!node || !group || group.type !== 'group') return false;
  const bounds = getGroupBounds(scene, groupId);
  if (!bounds) return false;
  // 按节点中心判定
  const w = node.size?.width ?? 0;
  const h = node.size?.height ?? 0;
  const cx = node.position.x + w / 2;
  const cy = node.position.y + h / 2;
  return (
    cx >= bounds.x && cx <= bounds.x + bounds.width && cy >= bounds.y && cy <= bounds.y + bounds.height
  );
}
