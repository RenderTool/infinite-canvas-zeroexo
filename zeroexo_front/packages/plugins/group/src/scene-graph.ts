/**
 * Scene Graph 核心 DFS 工具模块(基于 NodeRecord[] / SceneNode[])。
 *
 * 架构原则(沿用源项目):
 * - Canvas = Scene Graph
 * - Group = Container Node(type='group',拥有 childrenIds)
 * - Parent = 唯一层级关系(仅通过 parentId 表达)
 * - Bounds = 缓存(持久化但带 dirty 标记,子节点变更时标记脏)
 * - Render = DFS(按 siblingOrder 遍历)
 * - Selection = 最后队列(不修改 logicalIndex/siblingOrder/zIndex)
 * - 归属 = 用户行为(移动不改 parent,仅创建/解组/拖入/拖出/reparent 可改)
 *
 * 不存在自动吸附和隐式层级变化。
 * SceneNode 是 NodeRecord 的类型别名(@zeroexo/core),两者等价。
 */

import type { SceneNode, Rect, Point } from '@zeroexo/core';
import { GROUP_SIZE_FACTOR, GROUP_MIN_PADDING, GROUP_TITLE_HEIGHT } from './constants.js';

// ===== Version Folder 数据(存储于 NodeRecord.data) =====

/** Version Folder 组数据:聚合图片版本,叠卡预览 */
export interface VersionFolderData {
  versionFolder?: boolean;
  previewMode?: 'stacked' | 'grid';
  activeVersionId?: string;
  memberType?: string;
  createdAt?: number;
}

/** 读取 Version Folder 数据(未命中返回 undefined) */
export function getVersionFolderData(node: SceneNode | undefined): VersionFolderData | undefined {
  return node?.data as VersionFolderData | undefined;
}


// ===== 基础索引 =====

/** 构建 id → SceneNode Map */
export function buildById(scene: SceneNode[]): Map<string, SceneNode> {
  return new Map(scene.map((n) => [n.id, n]));
}

/** 获取根节点(parentId 为 null 的节点),按 siblingOrder 排序 */
export function getRoots(scene: SceneNode[]): SceneNode[] {
  return scene
    .filter((n) => n.parentId === null || n.parentId === undefined)
    .sort((a, b) => (a.siblingOrder ?? 0) - (b.siblingOrder ?? 0));
}

/** 获取直接子节点,按 siblingOrder 排序 */
export function getChildren(scene: SceneNode[], parentId: string): SceneNode[] {
  const byId = buildById(scene);
  const parent = byId.get(parentId);
  const childrenIds = parent?.childrenIds;
  if (!parent || !childrenIds || !childrenIds.length) return [];
  return childrenIds
    .map((cid) => byId.get(cid))
    .filter((n): n is SceneNode => Boolean(n))
    .sort((a, b) => (a.siblingOrder ?? 0) - (b.siblingOrder ?? 0));
}

/** 判断是否为 Group(type='group') */
export function isGroup(node: SceneNode | undefined): node is SceneNode {
  return Boolean(node) && (node as SceneNode).type === 'group';
}

/** 判断是否为 Version Folder group(组且 data.versionFolder===true) */
export function isVersionFolder(node: SceneNode | undefined): boolean {
  return isGroup(node) && getVersionFolderData(node)?.versionFolder === true;
}

/** 获取 Version Folder 的激活版本 ID */
export function getActiveVersionId(node: SceneNode): string | undefined {
  return getVersionFolderData(node)?.activeVersionId;
}

/** 判断是否为 Version Folder 且处于叠卡预览模式 */
export function isVersionFolderStacked(node: SceneNode | undefined): boolean {
  return isVersionFolder(node) && getVersionFolderData(node)?.previewMode === 'stacked';
}

/** 获取 Version Folder 的成员类型约束 */
export function getVersionFolderMemberType(node: SceneNode): string | undefined {
  return getVersionFolderData(node)?.memberType;
}

/** 判断是否为叶子节点(非 group,或 group 无 children) */
export function isLeaf(node: SceneNode): boolean {
  return node.type !== 'group' || (node.childrenIds?.length ?? 0) === 0;
}

// ===== 后代/祖先 =====

/** DFS 收集所有后代节点 ID(含子组内节点) */
export function getDescendantIds(scene: SceneNode[], rootId: string): string[] {
  const byId = buildById(scene);
  const result: string[] = [];
  const visited = new Set<string>();

  const dfs = (id: string) => {
    const node = byId.get(id);
    if (!node || visited.has(id)) return;
    visited.add(id);
    for (const cid of node.childrenIds ?? []) {
      result.push(cid);
      dfs(cid);
    }
  };
  dfs(rootId);
  return result;
}

/** DFS 收集所有后代节点(含子组内节点) */
export function getDescendants(scene: SceneNode[], rootId: string): SceneNode[] {
  const byId = buildById(scene);
  return getDescendantIds(scene, rootId)
    .map((id) => byId.get(id))
    .filter((n): n is SceneNode => Boolean(n));
}

/** 收集所有后代叶子节点(非 group 节点) */
export function getLeafDescendants(scene: SceneNode[], rootId: string): SceneNode[] {
  return getDescendants(scene, rootId).filter((n) => n.type !== 'group');
}

/** 收集所有祖先 ID(从直接父到根) */
export function getAncestorIds(scene: SceneNode[], nodeId: string): string[] {
  const byId = buildById(scene);
  const result: string[] = [];
  let current = byId.get(nodeId);
  while (current) {
    const pid = current.parentId;
    if (!pid) break;
    result.push(pid);
    current = byId.get(pid);
  }
  return result;
}

/** 收集所有祖先节点 */
export function getAncestors(scene: SceneNode[], nodeId: string): SceneNode[] {
  const byId = buildById(scene);
  return getAncestorIds(scene, nodeId)
    .map((id) => byId.get(id))
    .filter((n): n is SceneNode => Boolean(n));
}

/** 判断 childId 是否是 ancestorId 的后代 */
export function isDescendantOf(scene: SceneNode[], childId: string, ancestorId: string): boolean {
  if (childId === ancestorId) return false;
  return getAncestorIds(scene, childId).includes(ancestorId);
}

/** 循环引用检测:把 nodeId 挂到 newParentId 下是否会成环 */
export function detectCircularReference(
  scene: SceneNode[],
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  if (nodeId === newParentId) return true;
  return isDescendantOf(scene, newParentId, nodeId);
}

// ===== 深度 =====

/** 通过 parentId 链计算深度(根=0) */
export function getDepth(scene: SceneNode[], nodeId: string): number {
  return getAncestorIds(scene, nodeId).length;
}

// ===== Bounds 计算 =====

/** 节点尺寸访问器(从 extensions.defaultSize 或 node.size 获取实际渲染尺寸) */
export type NodeSizeAccessor = (node: SceneNode) => { width: number; height: number };

/** 计算一组节点的 Union bounds(不含 padding) */
export function unionNodeBounds(
  nodes: SceneNode[],
  getSize?: NodeSizeAccessor,
): Rect | null {
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const size = getSize ? getSize(n) : (n.size ?? { width: 0, height: 0 });
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + size.width);
    maxY = Math.max(maxY, n.position.y + size.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 计算 Group bounds = 直接子节点 bounds Union + padding + 顶部标题安全区。
 *
 * 直接子节点:叶子用 position+size,子组用其递归 bounds(已含子组自身标题区)。
 * 这样多组嵌套时,父组会在子组标题区之上再预留自己的标题安全区,
 * 父组标题栏不会与子组标题栏重叠(子节点不顶到头部标题安全区)。
 *
 * 顶部额外预留 GROUP_TITLE_HEIGHT:组的标题栏渲染在 bounds 顶部,子节点不应挡住标题。
 *
 * excludeIds:Shift+拖拽临时脱离时,被拖拽的节点 id 集合(从 bounds 计算中排除,
 * 使组 bounds 实时收缩,视觉上节点已脱离组)。递归传递给子组。
 */
export function computeGroupBounds(
  scene: SceneNode[],
  groupId: string,
  getSize?: NodeSizeAccessor,
  excludeIds?: Set<string>,
): Rect | null {
  const children = getChildren(scene, groupId);
  if (!children.length) return null;
  // 直接子节点 bounds:叶子用 position+size,子组用递归 getGroupBounds(含其标题区)
  // 注意:不用 isGroup() 类型守卫(其签名 node is SceneNode 会让 else 分支窄化为 never)
  const childBounds: Rect[] = [];
  for (const child of children) {
    // Shift+拖拽临时脱离:跳过被拖拽的节点(组 bounds 实时排除)
    if (excludeIds && excludeIds.has(child.id)) continue;
    if (child.type === 'group') {
      const gb = getGroupBounds(scene, child.id, getSize, excludeIds);
      if (gb) childBounds.push(gb);
    } else {
      const size = getSize ? getSize(child) : (child.size ?? { width: 0, height: 0 });
      childBounds.push({
        x: child.position.x,
        y: child.position.y,
        width: size.width,
        height: size.height,
      });
    }
  }
  if (!childBounds.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of childBounds) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const union = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const padX = Math.max((union.width * (GROUP_SIZE_FACTOR - 1)) / 2, GROUP_MIN_PADDING);
  const padY = Math.max((union.height * (GROUP_SIZE_FACTOR - 1)) / 2, GROUP_MIN_PADDING);
  // BUG1: 尺寸取整,避免小数点
  return {
    x: Math.round(union.x - padX),
    y: Math.round(union.y - padY - GROUP_TITLE_HEIGHT),
    width: Math.round(union.width + padX * 2),
    height: Math.round(union.height + padY * 2 + GROUP_TITLE_HEIGHT),
  };
}

/**
 * 读取 Group bounds。若 boundsDirty=true 则 DFS 重算并返回新值(调用方负责写回)。
 * 若无持久化 bounds 也无 dirty 标记(旧数据兜底),按需重算。
 *
 * excludeIds:Shift+拖拽临时脱离时排除的节点 id(仅影响重算,不影响缓存)。
 */
export function getGroupBounds(
  scene: SceneNode[],
  groupId: string,
  getSize?: NodeSizeAccessor,
  excludeIds?: Set<string>,
): Rect | null {
  const byId = buildById(scene);
  const group = byId.get(groupId);
  if (!group || group.type !== 'group') return null;
  // 有 excludeIds 时强制重算(不用缓存),实现拖拽中 bounds 实时排除
  if (!excludeIds && group.bounds && !group.boundsDirty) return group.bounds;
  return computeGroupBounds(scene, groupId, getSize, excludeIds);
}

/** 空组回退尺寸(基准图片节点 620×348 的一半) */
export const EMPTY_GROUP_SIZE = { width: 310, height: 174 };

/**
 * 获取组 bounds(含空组回退)。
 * 空组(无子节点)时 getGroupBounds 可能返回 null 或残留的旧缓存 bounds,
 * 导致胶囊工具栏锚点/聚焦/适配视图落到组 position(0,0)世界原点。
 * 此函数对空组统一返回基准图片节点一半尺寸的回退 bounds,
 * 位置取持久化 bounds 左上角(无则组 position),供渲染/锚点/聚焦各层一致使用。
 */
export function getGroupBoundsWithEmptyFallback(
  scene: SceneNode[],
  groupId: string,
  getSize?: NodeSizeAccessor,
  excludeIds?: Set<string>,
): Rect | null {
  const byId = buildById(scene);
  const group = byId.get(groupId);
  if (!group || group.type !== 'group') return null;
  if (!(group.childrenIds?.length)) {
    return {
      x: group.bounds?.x ?? group.position.x,
      y: group.bounds?.y ?? group.position.y,
      width: EMPTY_GROUP_SIZE.width,
      height: EMPTY_GROUP_SIZE.height,
    };
  }
  return getGroupBounds(scene, groupId, getSize, excludeIds);
}

/**
 * 标记节点所有祖先的 bounds 为 dirty。
 * 子节点 position/size/children 变更时调用。
 */
export function markAncestorBoundsDirty(scene: SceneNode[], nodeId: string): SceneNode[] {
  const ancestorIds = new Set(getAncestorIds(scene, nodeId));
  if (!ancestorIds.size) return scene;
  return scene.map((n) => (ancestorIds.has(n.id) ? { ...n, boundsDirty: true } : n));
}

/** 合并多个 bounds 为一个外接矩形 + padding */
export function mergeBoundsList(bounds: Rect[]): Rect | null {
  if (!bounds.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bounds) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const padX = Math.max((width * (GROUP_SIZE_FACTOR - 1)) / 2, GROUP_MIN_PADDING);
  const padY = Math.max((height * (GROUP_SIZE_FACTOR - 1)) / 2, GROUP_MIN_PADDING);
  // BUG1: 尺寸取整
  return { x: Math.round(minX - padX), y: Math.round(minY - padY), width: Math.round(width + padX * 2), height: Math.round(height + padY * 2) };
}

// ===== 选中归一化 =====

/** 查找节点的直接父 Group(通过 parentId) */
export function findParentGroup(scene: SceneNode[], nodeId: string): SceneNode | null {
  const byId = buildById(scene);
  const node = byId.get(nodeId);
  const pid = node?.parentId;
  if (!node || !pid) return null;
  const parent = byId.get(pid);
  return parent && parent.type === 'group' ? parent : null;
}

/** 判断 Group 是否完全被选中(所有叶子后代都在 selectedSet 中) */
export function isGroupFullySelected(
  scene: SceneNode[],
  groupId: string,
  selectedSet: Set<string>,
): boolean {
  const leaves = getLeafDescendants(scene, groupId);
  if (!leaves.length) return false;
  return leaves.every((n) => selectedSet.has(n.id));
}

export type PromotedSelection = {
  groups: SceneNode[];
  nodes: SceneNode[];
};

/**
 * 选中归一化到最外层。
 * 若选中节点所在子组完全被选中,则把该子组提升为整体单元,自底向上找最外层完全选中的祖先。
 */
export function promoteSelectionToOutermost(
  scene: SceneNode[],
  selectedSet: Set<string>,
): PromotedSelection {
  const byId = buildById(scene);
  const promotedGroups: SceneNode[] = [];
  const promotedNodes: SceneNode[] = [];
  const handledIds = new Set<string>();

  for (const id of selectedSet) {
    if (handledIds.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;

    // 节点不在任何组 → 直接作为独立节点
    const directParent = findParentGroup(scene, id);
    if (!directParent) {
      promotedNodes.push(node);
      handledIds.add(id);
      continue;
    }

    // 直接父组未完全选中 → 保持单个节点
    if (!isGroupFullySelected(scene, directParent.id, selectedSet)) {
      promotedNodes.push(node);
      handledIds.add(id);
      continue;
    }

    // 自底向上找最外层完全选中的祖先
    let currentGroup = directParent;
    while (true) {
      const pid = currentGroup.parentId;
      if (!pid) break;
      const parentGroup = byId.get(pid);
      if (
        !parentGroup ||
        parentGroup.type !== 'group' ||
        !isGroupFullySelected(scene, parentGroup.id, selectedSet)
      ) {
        break;
      }
      currentGroup = parentGroup;
    }

    promotedGroups.push(currentGroup);
    // 标记该组所有后代为已处理
    getDescendantIds(scene, currentGroup.id).forEach((did) => handledIds.add(did));
    handledIds.add(currentGroup.id);
  }

  return { groups: promotedGroups, nodes: promotedNodes };
}

/**
 * 计算 promoted 选择集的合并边界(含 padding + 顶部标题安全区)。
 *
 * 与 computeGroupBounds 保持一致:顶部额外预留 GROUP_TITLE_HEIGHT,
 * 确保预览组(dashed 框)与提交后正式组的 bounds 视觉一致,
 * 不会在 commit → boundsDirty 重算时发生跳变。
 */
export function computePromotedBounds(
  scene: SceneNode[],
  promoted: PromotedSelection,
  getSize?: NodeSizeAccessor,
): Rect | null {
  const allBounds: Rect[] = [];
  for (const g of promoted.groups) {
    const b = getGroupBounds(scene, g.id, getSize);
    if (b) allBounds.push(b);
  }
  for (const n of promoted.nodes) {
    const size = getSize ? getSize(n) : (n.size ?? { width: 0, height: 0 });
    allBounds.push({
      x: n.position.x,
      y: n.position.y,
      width: size.width,
      height: size.height,
    });
  }
  if (!allBounds.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of allBounds) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const padX = Math.max((width * (GROUP_SIZE_FACTOR - 1)) / 2, GROUP_MIN_PADDING);
  const padY = Math.max((height * (GROUP_SIZE_FACTOR - 1)) / 2, GROUP_MIN_PADDING);
  // BUG1: 尺寸取整
  return {
    x: Math.round(minX - padX),
    y: Math.round(minY - padY - GROUP_TITLE_HEIGHT),
    width: Math.round(width + padX * 2),
    height: Math.round(height + padY * 2 + GROUP_TITLE_HEIGHT),
  };
}

// ===== 命中测试(按鼠标落点) =====

/**
 * 按鼠标世界坐标落点判定命中哪个 Group。
 * 返回 depth 最大的命中 Group(最深层)。
 * 仅用于"显式拖入命令"触发时的归属判定,不在拖拽过程中自动调用。
 */
export function findDeepestGroupAtPoint(
  scene: SceneNode[],
  worldX: number,
  worldY: number,
): SceneNode | null {
  let deepest: SceneNode | null = null;
  let deepestDepth = -1;
  for (const n of scene) {
    if (n.type !== 'group') continue;
    const b = getGroupBounds(scene, n.id);
    if (!b) continue;
    if (worldX >= b.x && worldX <= b.x + b.width && worldY >= b.y && worldY <= b.y + b.height) {
      const d = getDepth(scene, n.id);
      if (d > deepestDepth) {
        deepestDepth = d;
        deepest = n;
      }
    }
  }
  return deepest;
}

// ===== logicalIndex 计算 =====

/**
 * 计算新组的 logicalIndex。
 * - 内部框选(所有 promoted 条目同父):newLogicalIndex = parent.logicalIndex + 1
 * - 外部框选(包围已有组):newLogicalIndex = min(被包围组的 logicalIndex) - 1
 * - 根级:0
 */
export function computeNewLogicalIndex(
  scene: SceneNode[],
  promoted: PromotedSelection,
  bestParentId: string | null,
): number {
  if (bestParentId) {
    const byId = buildById(scene);
    const parent = byId.get(bestParentId);
    return parent ? (parent.logicalIndex ?? 0) + 1 : 0;
  }
  // 根级:若包围了已有组,取最小 logicalIndex - 1;否则 0
  if (promoted.groups.length) {
    const minIdx = Math.min(...promoted.groups.map((g) => g.logicalIndex ?? 0));
    return minIdx - 1;
  }
  return 0;
}

// ===== 工厂函数 =====

/** 创建普通节点 SceneNode */
export function createLeafNode(params: {
  id?: string;
  type: string;
  title: string;
  position: Point;
  width: number;
  height: number;
  parentId?: string | null;
  siblingOrder?: number;
  logicalIndex?: number;
  data?: unknown;
}): SceneNode {
  const parentId = params.parentId ?? null;
  const logicalIndex = params.logicalIndex ?? 0;
  return {
    id: params.id || `node-${crypto.randomUUID()}`,
    type: params.type,
    title: params.title,
    parentId,
    childrenIds: [],
    siblingOrder: params.siblingOrder ?? 0,
    logicalIndex,
    position: params.position,
    size: { width: params.width, height: params.height },
    data: params.data,
  };
}

/** 创建 Group 节点 SceneNode */
export function createGroupNode(params: {
  id?: string;
  title: string;
  parentId?: string | null;
  siblingOrder?: number;
  logicalIndex?: number;
  childrenIds?: string[];
  bounds?: Rect;
  backgroundColor?: string;
  data?: unknown;
}): SceneNode {
  return {
    id: params.id || `group-${crypto.randomUUID()}`,
    type: 'group',
    title: params.title,
    parentId: params.parentId ?? null,
    childrenIds: params.childrenIds ?? [],
    siblingOrder: params.siblingOrder ?? 0,
    logicalIndex: params.logicalIndex ?? 0,
    position: { x: 0, y: 0 },
    bounds: params.bounds,
    boundsDirty: true,
    backgroundColor: params.backgroundColor,
    data: params.data,
  };
}

/** 默认组标题 */
export function defaultGroupTitle(existingCount: number, label = 'Group'): string {
  return `${label} ${existingCount + 1}`;
}
