/**
 * Group 命令 - 基于 CommandQueue 的可撤销 group 操作。
 *
 * - ReplaceSceneCommand: 替换整个 nodes 数组(group-service 纯函数结果提交用)
 * - MoveGroupCommand: 组增量移动(可合并,拖拽时连续 mousemove 合并为一条历史)
 * - ResizeGroupCommand: 组 bounds 覆盖(可合并,仅改 bounds 缓存)
 *
 * group-service 的操作(confirmGroupFromPreview/ungroupByIds/dragIntoGroup/...)
 * 都返回新的 SceneNode[],通过 ReplaceSceneCommand 提交以支持撤销/重做。
 */

import type { Command } from '@zeroexo/core';
import type { GraphModel, NodeRecord, Rect } from '@zeroexo/core';
import { moveGroup } from './group-service.js';

/**
 * 替换整个 nodes 数组的命令。
 * execute: oldNodes → newNodes
 * undo: newNodes → oldNodes
 */
export class ReplaceSceneCommand implements Command {
  id = 'replace-scene';
  private oldNodes: NodeRecord[] | undefined;

  constructor(private newNodes: NodeRecord[]) {}

  execute(state: GraphModel): GraphModel {
    this.oldNodes = state.nodes;
    return { ...state, nodes: this.newNodes };
  }

  undo(state: GraphModel): GraphModel {
    if (this.oldNodes) {
      return { ...state, nodes: this.oldNodes };
    }
    return state;
  }
}

/**
 * 组增量移动命令(可合并)。
 * execute: 平移组所有叶子后代 position + 平移组及后代组 bounds 缓存
 * undo: 反向平移
 *
 * 拖拽时连续 mousemove 产生多个 MoveGroupCommand,
 * 通过 CommandQueue 的 mergeStrategy 合并为一条(累积 dx/dy),
 * 最终历史中只有一条总增量命令。
 */
export class MoveGroupCommand implements Command {
  id = 'move-group';
  readonly groupId: string;
  readonly dx: number;
  readonly dy: number;

  constructor(groupId: string, dx: number, dy: number) {
    this.groupId = groupId;
    this.dx = dx;
    this.dy = dy;
  }

  execute(state: GraphModel): GraphModel {
    return { ...state, nodes: moveGroup(state.nodes, this.groupId, this.dx, this.dy) };
  }
  undo(state: GraphModel): GraphModel {
    return { ...state, nodes: moveGroup(state.nodes, this.groupId, -this.dx, -this.dy) };
  }
}

/**
 * 组 bounds 覆盖命令(可合并)。
 * execute: 覆盖 group.bounds + boundsDirty=false(用户自定义 bounds 暂时锁定)
 * undo: 恢复 oldBounds
 *
 * 拖拽时连续 mousemove 产生多个 ResizeGroupCommand,
 * 合并时取第一条 oldBounds + 最后一条 newBounds。
 *
 * 注意:
 * - 子节点移动会 markAncestorBoundsDirty,下次 getGroupBounds 会丢弃自定义 bounds 重算
 * - 整组移动(moveGroup)不破坏自定义 bounds(仅平移 bounds 缓存)
 */
export class ResizeGroupCommand implements Command {
  id = 'resize-group';
  readonly groupId: string;
  readonly oldBounds: Rect;
  readonly newBounds: Rect;

  constructor(groupId: string, oldBounds: Rect, newBounds: Rect) {
    this.groupId = groupId;
    this.oldBounds = oldBounds;
    this.newBounds = newBounds;
  }

  execute(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.groupId
          ? { ...n, bounds: this.newBounds, boundsDirty: false }
          : n,
      ),
    };
  }

  undo(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.groupId
          ? { ...n, bounds: this.oldBounds, boundsDirty: false }
          : n,
      ),
    };
  }
}
