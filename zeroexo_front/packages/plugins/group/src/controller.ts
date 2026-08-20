/**
 * GroupController - group 层级系统状态控制器
 *
 * 职责:
 * 1. 预览组管理(选中 ≥2 节点生成预览,Ctrl+G 切换,Enter 确认,Escape 取消)
 * 2. 组操作(解组/重命名/移动,通过命令提交,支持撤销)
 * 3. 拖拽结束判定(自动吸附:节点中心落入组则加入;自动脱离:超出父组 bounds 则移出)
 * 4. Shift+拖拽强制移出当前父组(新增功能)
 * 5. 键盘处理(Ctrl+G/Delete/Backspace/Enter/Escape)
 *
 * 不依赖 React,纯逻辑控制器。渲染层通过 subscribe 订阅状态变化。
 *
 * 约束(沿用 project_memory):
 * - 节点拖入组区域自动加入(自动吸附,非弹窗)
 * - 节点拖出边界自动脱离
 * - 节点不跨现有组转移(已有父组的节点不自动加入其他组,只能先脱离再加入)
 * - Delete/Backspace 触发解组(仅影响当前层级,保留嵌套子组)
 * - 选中 < 2 节点或选中节点全在同一组内时取消预览
 * - 移动组:平移所有叶子后代 position + 平移组 bounds 缓存(组 position 恒为 {x:0,y:0})
 */

import type { CommandQueue, SceneNode, Rect } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import {
  findDeepestGroupAtPoint,
  findParentGroup,
  isGroup,
  getDescendantIds,
  getGroupBounds,
  getGroupBoundsWithEmptyFallback,
  getVersionFolderData,
  getDepth,
  promoteSelectionToOutermost,
  computePromotedBounds,
  type NodeSizeAccessor,
} from './scene-graph.js';
import {
  confirmGroupFromPreview,
  createVersionFolder,
  ungroupByIds,
  renameGroup as serviceRenameGroup,
  dragIntoGroup,
  dragOutOfGroup,
  removeEmptyGroups,
  moveGroup,
  reparentNode as serviceReparentNode,
  setGroupBackground,
  setGroupBorderRadius,
  setNodeAppearance as serviceSetNodeAppearance,
  setNodeHidden as serviceSetNodeHidden,
  setNodeLocked as serviceSetNodeLocked,
} from './group-service.js';
import { ReplaceSceneCommand, MoveGroupCommand, ResizeGroupCommand } from './commands.js';

export class GroupController {
  /** 预览组选中的节点 id(非 null 表示处于预览态) */
  private previewSelectedIds: Set<string> | null = null;
  /** 预览组 bounds(世界坐标) */
  private previewBounds: Rect | null = null;
  /** 预览组模式:'normal' 普通组 | 'version-folder' 聚合组(版本文件夹) */
  private previewGroupMode: 'normal' | 'version-folder' = 'normal';
  /** Shift+拖拽临时脱离的节点 id(非 null 表示拖拽中,组 bounds 实时排除这些节点) */
  private dragDetachedIds: Set<string> | null = null;
  /** 拖拽悬停目标组 id(无父组节点拖入组区域时实时计算,用于"松开加入组"提示) */
  private hoverJoinGroupId: string | null = null;
  /** 状态版本(每次 notify 递增;渲染层用作订阅快照,previewBounds/hoverJoinGroupId 变化均驱动重渲染) */
  private version = 0;
  /** 订阅者 */
  private readonly listeners = new Set<() => void>();
  /** 节点尺寸访问器(从 extensions.defaultSize 获取,用于 bounds 计算) */
  private nodeSizeAccessor: NodeSizeAccessor | null = null;
  /** T2: 拖拽悬停判定 rAF 合帧(pointermove 频率可能远超 60Hz,合帧后每帧最多一次判定) */
  private pendingDragMoveNodeIds: string[] | null = null;
  private dragMoveRafId = 0;
  /** T2: 拖拽期间组命中缓存(scene 引用不变则复用;组列表 + 各组 bounds 预计算,避免每帧 O(V) 遍历) */
  private dragHitCache: {
    scene: SceneNode[];
    groupList: SceneNode[];
    boundsByGroupId: Map<string, Rect>;
  } | null = null;

  constructor(
    private store: ReactGraphStore,
    private commandQueue: CommandQueue,
  ) {}

  /** 设置节点尺寸访问器(由 demo 从 extensions 注入) */
  setNodeSizeAccessor(accessor: NodeSizeAccessor): void {
    this.nodeSizeAccessor = accessor;
  }

  // ===== 场景访问 =====

  /** 当前场景节点数组(SceneNode[]) */
  getScene(): SceneNode[] {
    return this.store.getGraph().nodes;
  }

  /** 当前选中的节点 id 集合(桥接 store,供外部快捷键注册使用) */
  getSelectedNodeIds(): Set<string> {
    return this.store.getSelection().selectedNodeIds;
  }

  /**
   * 拖拽集扩展(DFS):选中集中的组 → 展开为组本身 + 所有子孙。
   * 用于"移动父组时同步所有子孙组与节点"(interaction 的 expandDragIdsHook)。
   * 不修改 scene,仅返回扩展后的 id 数组。
   */
  expandDragIds(ids: string[]): string[] {
    if (!ids.length) return ids;
    const scene = this.getScene();
    const expanded = new Set<string>(ids);
    for (const id of ids) {
      const node = scene.find((n) => n.id === id);
      if (node && isGroup(node)) {
        for (const descId of getDescendantIds(scene, id)) {
          expanded.add(descId);
        }
      }
    }
    return [...expanded];
  }

  // ===== 预览组 =====

  /**
   * 选中 ≥2 节点时生成预览(不修改 scene,仅状态)。
   * 选中 < 2 节点、选中含组节点、选中节点全在同一组内 → 取消预览。
   * 用 promoteSelectionToOutermost 归一化,确保子组作为整体参与 bounds 计算。
   */
  createPreview(selectedNodeIds: Set<string>): void {
    if (selectedNodeIds.size < 2) {
      this.cancelPreview();
      return;
    }
    const scene = this.getScene();

    // 过滤掉组节点(组节点不应参与 preview 计算,只保留普通节点)
    const nonGroupIds = new Set<string>();
    for (const id of selectedNodeIds) {
      const node = scene.find((n) => n.id === id);
      if (node && !isGroup(node)) {
        nonGroupIds.add(id);
      }
    }
    if (nonGroupIds.size < 2) {
      this.cancelPreview();
      return;
    }

    // 归一化到最外层(子组完全选中时提升为整体)
    const promoted = promoteSelectionToOutermost(scene, nonGroupIds);

    // 所有选中节点全在同一组内 → 取消预览(已分组)
    if (promoted.groups.length === 1 && promoted.nodes.length === 0) {
      this.cancelPreview();
      return;
    }

    const bounds = computePromotedBounds(scene, promoted, this.nodeSizeAccessor ?? undefined);
    if (!bounds) {
      this.cancelPreview();
      return;
    }

    this.previewSelectedIds = new Set(selectedNodeIds);
    this.previewBounds = bounds;
    this.notify();
  }

  /** 确认预览组为正式组(通过命令提交,支持撤销) */
  confirmPreview(groupLabel?: string): void {
    if (!this.previewSelectedIds || !this.previewBounds) return;
    if (this.previewGroupMode === 'version-folder') {
      this.confirmVersionFolderFromPreview();
      return;
    }
    const scene = this.getScene();
    const result = confirmGroupFromPreview(scene, this.previewSelectedIds, this.previewBounds, groupLabel);
    if (!result) return;
    this.commandQueue.execute(new ReplaceSceneCommand(result.scene));
    // 选中新建的组
    this.store.setSelection({
      selectedNodeIds: new Set([result.group.id]),
      selectedEdgeIds: new Set(),
    });
    this.cancelPreview();
  }

  /** 预览态创建版本文件夹(确认聚合组) */
  private confirmVersionFolderFromPreview(): void {
    if (!this.previewSelectedIds) return;
    const scene = this.getScene();
    const result = createVersionFolder(scene, this.previewSelectedIds);
    if (!result) return;
    this.commandQueue.execute(new ReplaceSceneCommand(result.scene));
    // 选中新建的组
    this.store.setSelection({
      selectedNodeIds: new Set([result.group.id]),
      selectedEdgeIds: new Set(),
    });
    this.cancelPreview();
  }

  /** 取消预览 */
  cancelPreview(): void {
    if (this.previewSelectedIds === null && this.previewBounds === null) return;
    this.previewSelectedIds = null;
    this.previewBounds = null;
    this.previewGroupMode = 'normal';
    this.notify();
  }

  /**
   * 刷新预览组 bounds(节点移动时调用)。
   * 若当前处于预览态,用当前选中节点重新计算 bounds,使预览框跟随节点移动。
   */
  refreshPreview(): void {
    if (!this.previewSelectedIds || this.previewSelectedIds.size < 2) return;
    const scene = this.getScene();
    // 过滤掉组节点(与 createPreview 逻辑一致)
    const nonGroupIds = new Set<string>();
    for (const id of this.previewSelectedIds) {
      const node = scene.find((n) => n.id === id);
      if (node && !isGroup(node)) {
        nonGroupIds.add(id);
      }
    }
    if (nonGroupIds.size < 2) {
      this.cancelPreview();
      return;
    }
    const promoted = promoteSelectionToOutermost(scene, nonGroupIds);
    const bounds = computePromotedBounds(scene, promoted, this.nodeSizeAccessor ?? undefined);
    if (!bounds) {
      this.cancelPreview();
      return;
    }
    this.previewBounds = bounds;
    this.notify();
  }

  /** 是否处于预览态 */
  isPreviewing(): boolean {
    return this.previewSelectedIds !== null;
  }

  /** 预览框平移的起始基准 bounds(拖动开始时缓存,避免平移累计误差) */
  private previewDragBase: Rect | null = null;

  /**
   * P0-2: 拖动中预览框跟随 —— 用总偏移平移缓存的起始 bounds(不动 graph,
   * 无需每帧重算节点 bounds;pointerup 由 finalizePreviewDrag 基于最新 graph 校正)。
   */
  movePreviewSilent(dx: number, dy: number): void {
    if (!this.previewSelectedIds || !this.previewBounds) return;
    if (!this.previewDragBase) this.previewDragBase = { ...this.previewBounds };
    this.previewBounds = {
      ...this.previewDragBase,
      x: this.previewDragBase.x + dx,
      y: this.previewDragBase.y + dy,
    };
    this.notify();
  }

  /** 拖动结束:基于最新 graph 重算真实 bounds,清除平移基准 */
  finalizePreviewDrag(): void {
    this.previewDragBase = null;
    this.refreshPreview();
  }

  /** 设置预览组模式 */
  setPreviewGroupMode(mode: 'normal' | 'version-folder'): void {
    this.previewGroupMode = mode;
  }

  /** 获取预览组模式 */
  getPreviewGroupMode(): 'normal' | 'version-folder' {
    return this.previewGroupMode;
  }

  /** 预览组 bounds(渲染层用) */
  getPreviewBounds(): Rect | null {
    return this.previewBounds;
  }

  // ===== 组操作 =====

  /**
   * 移动组(增量,通过 MoveGroupCommand 提交,支持合并)。
   * 平移所有叶子后代 position + 平移组及后代组 bounds 缓存。
   * 组 position 恒为 {x:0,y:0},不修改。
   */
  moveGroup(groupId: string, dx: number, dy: number): void {
    this.commandQueue.execute(new MoveGroupCommand(groupId, dx, dy));
  }

  /**
   * O-1b: 瞬态组拖拽通道 — 拖拽期间直写 position,不走命令队列(避免每帧全量状态重建)。
   * 通过 setStateSilent 直接替换 graph(触发渲染但不进历史/不触发持久化)。
   * 语义与 moveGroup 一致(平移叶子后代 position + 平移组 bounds 缓存)。
   */
  moveGroupSilent(groupId: string, dx: number, dy: number): void {
    const graph = this.commandQueue.getState();
    const newNodes = moveGroup(graph.nodes, groupId, dx, dy);
    this.commandQueue.setStateSilent({ ...graph, nodes: newNodes });
  }

  /**
   * O-1b: 提交组拖拽 — 先回退瞬态增量,再执行命令入历史。
   * 回退后执行命令,确保最终状态正确且 undo 可恢复拖拽前位置。
   */
  moveGroupCommit(groupId: string, totalDx: number, totalDy: number): void {
    if (totalDx === 0 && totalDy === 0) return;
    // 回退瞬态 delta(将 silent 写过的位置还原到拖拽前)
    const graph = this.commandQueue.getState();
    const revertedNodes = moveGroup(graph.nodes, groupId, -totalDx, -totalDy);
    this.commandQueue.setStateSilent({ ...graph, nodes: revertedNodes });
    // 执行命令(将 delta 应用到还原后的状态,得到正确终点)
    this.commandQueue.execute(new MoveGroupCommand(groupId, totalDx, totalDy));
  }

  /**
   * 移动预览组中的节点(预览框拖拽时调用)。
   * 直接修改预览节点的 position,不经过命令系统(预览未确认,不应产生历史)。
   * - 用 expandDragIds 展开选中集(选中的子组 → 全部子孙),与正式组拖拽行为一致
   * - 仅平移非组节点(组 position 恒为 {x:0,y:0} 的约定不变)
   * - 经 setStateSilent 提交新 GraphModel 引用(触发渲染层重渲染,
   *   但不进历史、不触发 persistence)
   * 同时更新预览组 bounds 缓存。
   */
  movePreviewNodes(dx: number, dy: number): void {
    if (!this.previewSelectedIds || this.previewSelectedIds.size < 2) return;
    const moveSet = new Set(this.expandDragIds([...this.previewSelectedIds]));
    const graph = this.store.getGraph();
    const newScene = graph.nodes.map((n) => {
      // 不用 isGroup() 类型守卫(其窄化会让 else 分支变为 never)
      if (moveSet.has(n.id) && n.type !== 'group') {
        return {
          ...n,
          position: { x: n.position.x + dx, y: n.position.y + dy },
        };
      }
      return n;
    });
    // 静默替换(不进历史):新引用触发 useSyncExternalStore 重渲染
    this.commandQueue.setStateSilent({ ...graph, nodes: newScene });
    // 刷新预览 bounds
    this.refreshPreview();
  }

  /** 解组(通过命令提交,支持撤销) */
  ungroup(groupIds: string[]): void {
    if (!groupIds.length) return;
    const scene = this.getScene();
    const newScene = ungroupByIds(scene, groupIds);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /**
   * 切换 Version Folder 的激活版本
   * 更新 data.activeVersionId,通过 ReplaceSceneCommand 提交(支持撤销)。
   * 同时迁移所有进出旧激活版本的连线到新激活版本。
   */
  switchVersion(groupId: string, newVersionId: string): void {
    const scene = this.getScene();
    const group = scene.find((n) => n.id === groupId);
    if (!group || !isGroup(group) || !getVersionFolderData(group)?.versionFolder) return;
    // 检查 newVersionId 是否在 childrenIds 中
    if (!group.childrenIds?.includes(newVersionId)) return;
    const oldVersionId = getVersionFolderData(group)?.activeVersionId;
    if (oldVersionId === newVersionId) return;

    // 获取所有 edges(从 store 的 graph 中)
    const graph = this.store.getGraph();
    const edges = graph.edges ?? [];

    // 迁移连线:将进出 oldVersionId 的连线改为进出 newVersionId
    // 注意:edges 不在 scene 中,需要单独处理
    // 方案:直接在 ReplaceSceneCommand 中更新 scene,同时通过 store 更新 edges
    // 但 scene 不包含 edges,所以分两步:先更新 scene,再更新 edge 目标
    const newScene = scene.map((n) => {
      if (n.id !== groupId) return n;
      return {
        ...n,
        data: { ...(n.data ?? {}), activeVersionId: newVersionId },
      };
    });
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));

    // 连线迁移:遍历 edges,将 source/target 中指向旧版本子节点的改为新版本
    for (const edge of edges) {
      const srcNodeId = typeof edge.source === 'object' ? (edge.source as any).nodeId ?? edge.source : edge.source;
      const tgtNodeId = typeof edge.target === 'object' ? (edge.target as any).nodeId ?? edge.target : edge.target;
      if (srcNodeId === oldVersionId || tgtNodeId === oldVersionId) {
        // 需要迁移这条边
        const newSource = srcNodeId === oldVersionId
          ? (typeof edge.source === 'object' ? { ...(edge.source as any), nodeId: newVersionId } : newVersionId)
          : edge.source;
        const newTarget = tgtNodeId === oldVersionId
          ? (typeof edge.target === 'object' ? { ...(edge.target as any), nodeId: newVersionId } : newVersionId)
          : edge.target;
        // 删除旧边,添加新边
        // 使用 store 的 removeEdge + addEdge 方法
        // 通过 store.getGraph().edges 更新不直接支持,需通过命令
        // 这里用 store 的 updateNodeData 方式不可行,改为通过 store 直接操作
        // 最简单方式:直接修改 store 的 graph
        try {
          // @ts-expect-error - 动态删除边
          this.store.removeEdge(edge.id);
          // @ts-expect-error - 动态添加边
          this.store.addEdge({
            ...edge,
            id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            source: newSource,
            target: newTarget,
          });
        } catch {
          // 静默失败,store 可能不暴露这些方法
        }
      }
    }
  }

  /**
   * 从选中节点创建 Version Folder
   * 调用 createVersionFolder 创建,选中新建组,通知排除节点。
   * 返回排除的节点 ID 数组(用于 toast 通知)。
   */
  createVersionFolderFromSelection(): string[] {
    const selectedIds = this.getSelectedNodeIds();
    if (selectedIds.size < 2) return [];
    const scene = this.getScene();
    const result = createVersionFolder(scene, selectedIds);
    if (!result) return [];
    this.commandQueue.execute(new ReplaceSceneCommand(result.scene));
    // 选中新建的组
    this.store.setSelection({
      selectedNodeIds: new Set([result.group.id]),
      selectedEdgeIds: new Set(),
    });
    return result.excludedIds;
  }

  /** 重命名组(通过命令提交,支持撤销) */
  renameGroup(groupId: string, title: string): void {
    const scene = this.getScene();
    const newScene = serviceRenameGroup(scene, groupId, title);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /** 设置组背景色(通过命令提交,支持撤销;color=undefined 清除自定义恢复默认) */
  setGroupBackground(groupId: string, color: string | undefined): void {
    const scene = this.getScene();
    const newScene = setGroupBackground(scene, groupId, color);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /** 设置组圆角(通过命令提交,支持撤销;radius=undefined 清除自定义恢复默认 8) */
  setGroupBorderRadius(groupId: string, radius: number | undefined): void {
    const scene = this.getScene();
    const newScene = setGroupBorderRadius(scene, groupId, radius);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /**
   * 设置节点外观字段(通用,group 和普通节点共用;通过命令提交,支持撤销)。
   * patch 中 undefined 值清除该字段(恢复默认)。
   * 支持字段: backgroundColor/outlineColor/outlineWidth/outlineOffset/borderRadius/opacity/
   * nodeColor/titleBackgroundColor/contentBackgroundColor/theme/pinColor/pinShape/pinSize 等。
   */
  setNodeAppearance(nodeId: string, patch: Partial<SceneNode>): void {
    const scene = this.getScene();
    const newScene = serviceSetNodeAppearance(scene, nodeId, patch);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /** 层级面板 reparent(通过命令提交,支持撤销;带循环引用检测) */
  reparentNode(nodeId: string, newParentId: string | null): void {
    const scene = this.getScene();
    const newScene = serviceReparentNode(scene, nodeId, newParentId);
    if (newScene === scene) return; // 无变化(循环引用或相同父)
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /** 切换节点隐藏(通过命令提交,支持撤销) */
  setNodeHidden(nodeId: string, hidden: boolean): void {
    const scene = this.getScene();
    const newScene = serviceSetNodeHidden(scene, nodeId, hidden);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /** 切换节点锁定(通过命令提交,支持撤销) */
  setNodeLocked(nodeId: string, locked: boolean): void {
    const scene = this.getScene();
    const newScene = serviceSetNodeLocked(scene, nodeId, locked);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /**
   * 删除场景节点(含其所有子孙),通过命令提交,支持撤销。
   * 组节点删除会移除整个子树(与 ungroup 不同:ungroup 保留子节点,delete 移除子树)。
   */
  deleteSceneNode(nodeId: string): void {
    const scene = this.getScene();
    const descendantIds = getDescendantIds(scene, nodeId);
    const toRemove = new Set<string>([nodeId, ...descendantIds]);
    const newScene = scene.filter((n) => !toRemove.has(n.id));
    if (newScene.length === scene.length) return; // 未找到节点
    // 清除选中(如果删除的节点在选中集中)
    const currentSelection = this.store.getSelection();
    let changed = false;
    const remainingIds = new Set<string>();
    for (const id of currentSelection.selectedNodeIds) {
      if (!toRemove.has(id)) {
        remainingIds.add(id);
      } else {
        changed = true;
      }
    }
    if (changed) {
      this.store.setSelection({ selectedNodeIds: remainingIds, selectedEdgeIds: new Set() });
    }
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /**
   * 批量删除多个选中的节点(含组+节点混合选择)。
   * 选中什么就删除什么,不级联删除子节点:
   *   - 组节点 → 解组(移除容器,子节点保留为独立节点)
   *   - 非组节点 → 直接移除
   * 通过 ReplaceSceneCommand 提交,支持撤销。
   */
  deleteNodes(nodeIds: Iterable<string>): void {
    const scene = this.getScene();
    const ids = [...nodeIds];
    if (ids.length === 0) return;
    // 选中什么就删除什么:组节点→解组(移除容器,子节点保留),非组节点→直接移除
    // 不级联删除子节点,用户框选时只删除选中的内容
    const groupIds = ids.filter((id) => {
      const node = scene.find((n) => n.id === id);
      return node?.type === 'group';
    });
    const nonGroupIds = ids.filter((id) => !groupIds.includes(id));
    let newScene = scene;
    // 1. 解组(移除组容器,子节点保留为独立节点)
    if (groupIds.length > 0) {
      newScene = ungroupByIds(newScene, groupIds);
    }
    // 2. 删除非组节点
    if (nonGroupIds.length > 0) {
      const toRemove = new Set(nonGroupIds);
      newScene = newScene.filter((n) => !toRemove.has(n.id));
    }
    if (newScene.length === scene.length) return;
    // 清除选中(如果删除的节点在选中集中)
    const currentSelection = this.store.getSelection();
    let changed = false;
    const remainingIds = new Set<string>();
    for (const id of currentSelection.selectedNodeIds) {
      if (!groupIds.includes(id) && !nonGroupIds.includes(id)) {
        remainingIds.add(id);
      } else {
        changed = true;
      }
    }
    if (changed) {
      this.store.setSelection({ selectedNodeIds: remainingIds, selectedEdgeIds: new Set() });
    }
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /**
   * Resize 组(仅覆盖 bounds 缓存,不缩放子节点)。
   * 通过 ResizeGroupCommand 提交(可合并,连续 mousemove 合并为一条历史)。
   * boundsDirty=false 暂时锁定用户自定义 bounds;子节点移动后会重新标记 dirty。
   */
  resizeGroup(groupId: string, oldBounds: Rect, newBounds: Rect): void {
    this.commandQueue.execute(new ResizeGroupCommand(groupId, oldBounds, newBounds));
  }

  /**
   * O-1c: 瞬态组缩放通道 — 拖拽期间直写 bounds,不走命令队列。
   * 通过 setStateSilent 直接替换 graph(触发渲染但不进历史/不触发持久化)。
   */
  resizeGroupSilent(groupId: string, newBounds: Rect): void {
    const graph = this.commandQueue.getState();
    const newNodes = graph.nodes.map((n) =>
      n.id === groupId
        ? { ...n, bounds: newBounds, boundsDirty: false }
        : n,
    );
    this.commandQueue.setStateSilent({ ...graph, nodes: newNodes });
  }

  /**
   * O-1c: 提交组缩放 — 先回退瞬态 oldBounds,再执行命令入历史。
   */
  resizeGroupCommit(groupId: string, oldBounds: Rect, newBounds: Rect): void {
    const graph = this.commandQueue.getState();
    const revertedNodes = graph.nodes.map((n) =>
      n.id === groupId
        ? { ...n, bounds: oldBounds, boundsDirty: false }
        : n,
    );
    this.commandQueue.setStateSilent({ ...graph, nodes: revertedNodes });
    this.commandQueue.execute(new ResizeGroupCommand(groupId, oldBounds, newBounds));
  }

  /** 读取组当前 bounds(尊重 dirty 标记和用户自定义 bounds 缓存;拖拽中排除临时脱离节点;含空组回退) */
  getGroupBounds(groupId: string): Rect | null {
    return getGroupBoundsWithEmptyFallback(
      this.getScene(),
      groupId,
      this.nodeSizeAccessor ?? undefined,
      this.dragDetachedIds ?? undefined,
    );
  }

  /**
   * 空组清理:组内最后一个子节点被删除/移出后,组壳随之自动移除。
   * 通过 ReplaceSceneCommand 提交(可撤销);无空组时不做任何事(避免空命令噪音)。
   */
  cleanupEmptyGroups(): void {
    const scene = this.getScene();
    const cleaned = removeEmptyGroups(scene);
    if (cleaned === scene) return;
    this.commandQueue.execute(new ReplaceSceneCommand(cleaned));
    // 同步清理选中态中残留的已移除组壳 id
    const cleanedIds = new Set(cleaned.map((n) => n.id));
    const sel = this.store.getSelection();
    const remaining = [...sel.selectedNodeIds].filter((id) => cleanedIds.has(id));
    if (remaining.length !== sel.selectedNodeIds.size) {
      this.store.setSelection({
        selectedNodeIds: new Set(remaining),
        selectedEdgeIds: sel.selectedEdgeIds,
      });
    }
  }

  // ===== Shift+拖拽临时脱离 =====

  /**
   * 拖拽开始钩子(由 interaction 的 dragStartHook 调用)。
   * Shift 按下时,把"父组不在拖拽集中"的被拖拽节点标记为"临时脱离",
   * 组 bounds 计算实时排除它们(视觉上节点拖出组时组立即收缩)。
   * 拖拽结束后由 handleDragEnd 清除标记 + 永久移出。
   *
   * 父组在拖拽集中的节点不脱离(它们跟随父组移动,如拖拽组时其子孙)。
   */
  handleDragStart(nodeIds: string[], shiftKey: boolean): void {
    const scene = this.getScene();
    if (shiftKey) {
      const draggedSet = new Set(nodeIds);
      const detached = new Set<string>();
      for (const id of nodeIds) {
        const parent = findParentGroup(scene, id);
        // 仅当父组不在拖拽集中时才标记脱离(父组被一起拖时,子节点跟随,不脱离)
        if (parent !== null && !draggedSet.has(parent.id)) {
          detached.add(id);
        }
      }
      if (detached.size > 0) {
        this.dragDetachedIds = detached;
      } else {
        // 无可脱离节点,确保清除(避免上次残留)
        this.clearDragDetachedIds();
      }
    } else {
      this.clearDragDetachedIds();
    }
  }

  /** 读取当前临时脱离的节点 id(渲染层用于 bounds 排除) */
  getDragDetachedIds(): Set<string> | null {
    return this.dragDetachedIds;
  }

  /** 读取拖拽悬停目标组 id(渲染层用于"松开加入组"提示与目标组高亮) */
  getHoverJoinGroupId(): string | null {
    return this.hoverJoinGroupId;
  }

  /** 状态版本号(渲染层订阅快照:任一状态 notify 后递增,确保变化可被感知) */
  getVersion(): number {
    return this.version;
  }

  /**
   * 拖拽移动钩子(由 interaction 的 dragMoveHook 调用)。
   * 实时计算"无父组的被拖节点中心落点的最深组"作为吸附目标:
   * - 有父组的节点不跨组转移(与 handleDragEnd 自动吸附规则一致),不参与判定
   * - 悬停目标组本身在拖拽集中时不算(不能加入自己)
   * T2: pointermove 每帧调用,内部 rAF 合帧 —— 悬停判定降频到每帧最多一次,
   * 配合组命中缓存(scene 引用不变即复用预计算组列表+bounds),消除每帧全量遍历。
   */
  handleDragMove(nodeIds: string[]): void {
    this.pendingDragMoveNodeIds = nodeIds;
    if (this.dragMoveRafId !== 0) return;
    this.dragMoveRafId = requestAnimationFrame(() => {
      this.dragMoveRafId = 0;
      const ids = this.pendingDragMoveNodeIds;
      this.pendingDragMoveNodeIds = null;
      if (ids) this.runDragMoveHoverCheck(ids);
    });
  }

  /** rAF 内执行真实悬停判定(逻辑与原 handleDragMove 等价,组命中走缓存) */
  private runDragMoveHoverCheck(nodeIds: string[]): void {
    const scene = this.getScene();
    // P0-2 瞬态拖拽通道:拖拽期间 graph 不更新,节点位置需叠加瞬态偏移表,
    // 否则悬停判定基于拖拽起始位置,拖入组提示永不触发
    const offsets = this.store.getDragOffsets();
    const draggedSet = new Set(nodeIds);
    let next: string | null = null;
    for (const id of nodeIds) {
      const node = scene.find((n) => n.id === id);
      if (!node || node.type === 'group') continue;
      if (findParentGroup(scene, id) !== null) continue; // 有父组 → 不吸附
      const size = node.size ?? { width: 0, height: 0 };
      const off = offsets.get(id) ?? { dx: 0, dy: 0 };
      const cx = node.position.x + off.dx + size.width / 2;
      const cy = node.position.y + off.dy + size.height / 2;
      const target = this.findGroupAtPointCached(scene, cx, cy);
      if (target && !draggedSet.has(target.id)) {
        next = target.id;
        break;
      }
    }
    if (next !== this.hoverJoinGroupId) {
      this.hoverJoinGroupId = next;
      this.notify();
    }
  }

  /**
   * 组命中:拖拽期间组列表 + bounds 缓存(仅 scene 引用变化时重建)。
   * 与 findDeepestGroupAtPoint 判定规则一致(最深层命中),但不每帧全量遍历。
   */
  private findGroupAtPointCached(scene: SceneNode[], worldX: number, worldY: number): SceneNode | null {
    let cache = this.dragHitCache;
    if (!cache || cache.scene !== scene) {
      const groupList: SceneNode[] = [];
      const boundsByGroupId = new Map<string, Rect>();
      for (const n of scene) {
        if (n.type !== 'group') continue;
        const b = getGroupBounds(scene, n.id);
        if (!b) continue;
        groupList.push(n);
        boundsByGroupId.set(n.id, b);
      }
      cache = { scene, groupList, boundsByGroupId };
      this.dragHitCache = cache;
    }
    const { groupList, boundsByGroupId } = cache;
    let deepest: SceneNode | null = null;
    let deepestDepth = -1;
    for (const n of groupList) {
      const b = boundsByGroupId.get(n.id);
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

  /**
   * 显式移出组(右键/胶囊工具栏等显式入口):把指定节点移出当前父组,
   * 提升到祖父组或根级(与 Shift+拖拽脱离同语义,通过命令提交支持撤销)。
   */
  moveOutOfGroup(nodeIds: string[]): void {
    if (!nodeIds.length) return;
    const scene = this.getScene();
    const idsToMoveOut = nodeIds.filter((id) => findParentGroup(scene, id) !== null);
    if (!idsToMoveOut.length) return;
    const newScene = dragOutOfGroup(scene, idsToMoveOut);
    this.commandQueue.execute(new ReplaceSceneCommand(newScene));
  }

  /** 清除临时脱离标记(拖拽结束时调用) */
  clearDragDetachedIds(): void {
    if (this.dragDetachedIds === null) return;
    this.dragDetachedIds = null;
    this.notify();
  }

  // ===== 拖拽结束判定(自动吸附/Shift移出/自动脱离) =====

  /**
   * 拖拽结束时由 interaction 调用。
   * - hasMoved=false: 纯点击,不触发组归属判定(避免误操作)
   * - shiftKey=true: 强制移出当前父组(新增功能)
   * - shiftKey=false: 按节点中心判定
   *   - 节点中心落入某组且无父组 → 自动加入(自动吸附)
   *   - 节点中心不在任何组内且有父组 → 自动脱离
   *   - 已有父组的节点不跨组转移(只能先脱离再加入)
   */
  handleDragEnd(nodeIds: string[], shiftKey: boolean, hasMoved: boolean): void {
    // T2: 取消挂起的悬停判定 rAF(拖拽结束,残留帧不应再触发 notify)
    if (this.dragMoveRafId !== 0) {
      cancelAnimationFrame(this.dragMoveRafId);
      this.dragMoveRafId = 0;
      this.pendingDragMoveNodeIds = null;
    }
    // 拖拽结束:基于最新 graph 校正预览框 bounds(拖动期间为平移态)
    this.finalizePreviewDrag();
    // 拖拽结束:无论是否移动,都清除临时脱离标记(避免纯点击 Shift 残留)
    // 永久移出逻辑不依赖临时标记(直接读 parentId),先清除安全
    this.clearDragDetachedIds();
    // 清除悬停目标组(拖拽结束,吸附提示消失)
    if (this.hoverJoinGroupId !== null) {
      this.hoverJoinGroupId = null;
      this.notify();
    }
    if (!nodeIds.length || !hasMoved) return;
    const scene = this.getScene();

    if (shiftKey) {
      // Shift+拖拽:强制移出当前父组
      // 仅脱离"父组不在拖拽集中"的成员(拖拽集已展开含组子孙):
      // 拖子组时只有子组本身被提升,其后代保留在子组内(子组整体脱离)
      const draggedSet = new Set(nodeIds);
      const idsToMoveOut = nodeIds.filter((id) => {
        const parent = findParentGroup(scene, id);
        return parent !== null && !draggedSet.has(parent.id);
      });
      if (idsToMoveOut.length) {
        const newScene = dragOutOfGroup(scene, idsToMoveOut);
        this.commandQueue.execute(new ReplaceSceneCommand(newScene));
      }
      return;
    }

    // 普通拖拽:用节点中心判定
    const nodeCenter = (n: SceneNode): { cx: number; cy: number } => {
      const w = n.size?.width ?? 0;
      const h = n.size?.height ?? 0;
      return { cx: n.position.x + w / 2, cy: n.position.y + h / 2 };
    };

    const toJoin: string[] = []; // 无父组 → 加入组
    const toMoveOut: string[] = []; // 有父组 → 移出

    for (const id of nodeIds) {
      const node = scene.find((n) => n.id === id);
      if (!node || isGroup(node)) continue; // 组节点不参与自动吸附
      const { cx, cy } = nodeCenter(node);
      const deepestAtNode = findDeepestGroupAtPoint(scene, cx, cy);
      const currentParent = findParentGroup(scene, id);

      if (!deepestAtNode) {
        // 节点中心不在任何组内
        if (currentParent) {
          toMoveOut.push(id); // 自动脱离
        }
      } else if (!currentParent) {
        // 节点中心在某组内,且无父组 → 自动加入
        toJoin.push(id);
      }
      // currentParent 存在时不跨组转移
    }

    let newScene = scene;
    if (toMoveOut.length) {
      newScene = dragOutOfGroup(newScene, toMoveOut);
    }
    if (toJoin.length) {
      const byTarget = new Map<string, string[]>();
      for (const id of toJoin) {
        const node = newScene.find((n) => n.id === id);
        if (!node) continue;
        const { cx, cy } = nodeCenter(node);
        const target = findDeepestGroupAtPoint(newScene, cx, cy);
        if (target) {
          const arr = byTarget.get(target.id) ?? [];
          arr.push(id);
          byTarget.set(target.id, arr);
        }
      }
      for (const [groupId, ids] of byTarget) {
        newScene = dragIntoGroup(newScene, ids, groupId);
      }
    }

    if (newScene !== scene) {
      this.commandQueue.execute(new ReplaceSceneCommand(newScene));
    }
  }

  // ===== 键盘 =====
  // 快捷键逻辑已迁移至 GroupPlugin.getShortcutEntries()(由 app 注册到 keyboard 插件),
  // controller 仅暴露 isPreviewing/confirmPreview/cancelPreview/createPreview/ungroup 等原语。

  // ===== 订阅 =====

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }
}
