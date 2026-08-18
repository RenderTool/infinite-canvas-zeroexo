/**
 * 内置命令
 * Phase 2 将完整实现具体逻辑
 */

import type { Command, CommandContext } from './command-queue.js';
import type { NodeRecord, EdgeRecord, GraphModel } from '../model/types.js';

export class AddNodeCommand implements Command {
  id = 'add-node';
  constructor(private node: NodeRecord) {}
  execute(state: GraphModel): GraphModel {
    // 防止重复添加相同 ID 的节点（避免 React duplicate key 错误）
    if (state.nodes.some((n) => n.id === this.node.id)) {
      return state;
    }
    return { ...state, nodes: [...state.nodes, this.node] };
  }
  undo(state: GraphModel): GraphModel {
    return { ...state, nodes: state.nodes.filter((n) => n.id !== this.node.id) };
  }
}

export class RemoveNodeCommand implements Command {
  id = 'remove-node';
  private removed?: NodeRecord;
  constructor(private nodeId: string) {}
  execute(state: GraphModel): GraphModel {
    this.removed = state.nodes.find((n) => n.id === this.nodeId);
    return { ...state, nodes: state.nodes.filter((n) => n.id !== this.nodeId) };
  }
  undo(state: GraphModel): GraphModel {
    if (this.removed) {
      return { ...state, nodes: [...state.nodes, this.removed] };
    }
    return state;
  }
}

export class MoveNodeCommand implements Command {
  id = 'move-node';
  constructor(private nodeId: string, private delta: { x: number; y: number }) {}
  execute(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId
          ? { ...n, position: { x: n.position.x + this.delta.x, y: n.position.y + this.delta.y } }
          : n,
      ),
    };
  }
  undo(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId
          ? { ...n, position: { x: n.position.x - this.delta.x, y: n.position.y - this.delta.y } }
          : n,
      ),
    };
  }
}

/**
 * MoveNodesCommand - 批量移动节点（绝对位置，幂等）
 * 用于瞬态拖拽通道：拖拽期间通过 setStateSilent 直写 position，
 * pointerup 时提交一条本命令入历史（一次 undo 恢复全部节点起点）。
 * execute 设置为 endPositions（状态已被 silent 更新到终点时幂等），
 * undo 恢复 startPositions。单次 nodes.map 遍历，优于 N 条 MoveNodeCommand。
 */
export class MoveNodesCommand implements Command {
  id = 'move-nodes';
  constructor(
    private startPositions: Map<string, { x: number; y: number }>,
    private endPositions: Map<string, { x: number; y: number }>,
  ) {}
  execute(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) => {
        const end = this.endPositions.get(n.id);
        return end ? { ...n, position: { x: end.x, y: end.y } } : n;
      }),
    };
  }
  undo(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) => {
        const start = this.startPositions.get(n.id);
        return start ? { ...n, position: { x: start.x, y: start.y } } : n;
      }),
    };
  }
}

export class AddEdgeCommand implements Command {
  id = 'add-edge';
  constructor(private edge: EdgeRecord) {}
  execute(state: GraphModel): GraphModel {
    return { ...state, edges: [...state.edges, this.edge] };
  }
  undo(state: GraphModel): GraphModel {
    return { ...state, edges: state.edges.filter((e) => e.id !== this.edge.id) };
  }
}

export class RemoveEdgeCommand implements Command {
  id = 'remove-edge';
  private removed?: EdgeRecord;
  constructor(private edgeId: string) {}
  execute(state: GraphModel): GraphModel {
    this.removed = state.edges.find((e) => e.id === this.edgeId);
    return { ...state, edges: state.edges.filter((e) => e.id !== this.edgeId) };
  }
  undo(state: GraphModel): GraphModel {
    if (this.removed) {
      return { ...state, edges: [...state.edges, this.removed] };
    }
    return state;
  }
}

export class UpdateNodeDataCommand implements Command {
  id = 'update-node-data';
  private oldData?: unknown;
  constructor(
    private nodeId: string,
    private patch: Record<string, unknown>,
  ) {}
  execute(state: GraphModel): GraphModel {
    const node = state.nodes.find((n) => n.id === this.nodeId);
    if (node) {
      this.oldData = node.data;
      const newData =
        node.data && typeof node.data === 'object'
          ? { ...(node.data as Record<string, unknown>), ...this.patch }
          : this.patch;
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === this.nodeId ? { ...n, data: newData } : n,
        ),
      };
    }
    return state;
  }
  undo(state: GraphModel): GraphModel {
    if (this.oldData !== undefined) {
      return {
        ...state,
        nodes: state.nodes.map((n) => (n.id === this.nodeId ? { ...n, data: this.oldData } : n)),
      };
    }
    return state;
  }
}

/**
 * UpdateNodeTitleCommand - 更新节点顶层 title 属性(同时同步 data.title)
 *
 * 用于层级面板重命名等场景,确保 node.title 和 node.data.title 同时更新。
 * 支持 undo。
 */
export class UpdateNodeTitleCommand implements Command {
  id = 'update-node-title';
  private oldTitle?: string;
  private oldDataTitle?: unknown;
  constructor(
    private nodeId: string,
    private title: string,
  ) {}

  execute(state: GraphModel): GraphModel {
    const node = state.nodes.find((n) => n.id === this.nodeId);
    if (!node) return state;
    this.oldTitle = node.title;
    const dataObj = node.data as { title?: unknown } | null;
    if (dataObj && typeof dataObj === 'object') {
      this.oldDataTitle = dataObj.title;
    }
    return {
      ...state,
      nodes: state.nodes.map((n) => {
        if (n.id !== this.nodeId) return n;
        const newData =
          n.data && typeof n.data === 'object'
            ? { ...(n.data as Record<string, unknown>), title: this.title }
            : n.data;
        return { ...n, title: this.title, data: newData };
      }),
    };
  }

  undo(state: GraphModel): GraphModel {
    if (this.oldTitle === undefined) return state;
    return {
      ...state,
      nodes: state.nodes.map((n) => {
        if (n.id !== this.nodeId) return n;
        const newData =
          n.data && typeof n.data === 'object'
            ? { ...(n.data as Record<string, unknown>), title: this.oldDataTitle }
            : n.data;
        return { ...n, title: this.oldTitle, data: newData };
      }),
    };
  }
}

/**
 * BatchCommand - 批量命令
 * 把多个子命令打包成一个历史条目,一次 undo 全部撤销。
 * execute 顺序执行子命令,undo 逆序撤销。
 * 用于"添加 50 节点"等需要原子化撤销的场景。
 */
export class BatchCommand implements Command {
  id: string;
  private readonly commands: Command[];

  constructor(commands: Command[], id = 'batch') {
    this.commands = commands;
    this.id = id;
  }

  execute(state: GraphModel, context: CommandContext): GraphModel {
    let s = state;
    for (const cmd of this.commands) {
      s = cmd.execute(s, context);
    }
    return s;
  }
  undo(state: GraphModel, context: CommandContext): GraphModel {
    let s = state;
    for (let i = this.commands.length - 1; i >= 0; i--) {
      s = this.commands[i]!.undo(s, context);
    }
    return s;
  }
}

export class DuplicateNodeCommand implements Command {
  id = 'duplicate-node';
  private newNode?: NodeRecord;
  constructor(private nodeId: string, private offset: { x: number; y: number } = { x: 30, y: 30 }) {}

  execute(state: GraphModel): GraphModel {
    const node = state.nodes.find((n) => n.id === this.nodeId);
    if (!node) return state;

    this.newNode = {
      ...node,
      id: `${node.id}-duplicate-${Date.now()}`,
      position: {
        x: node.position.x + this.offset.x,
        y: node.position.y + this.offset.y,
      },
    };

    return { ...state, nodes: [...state.nodes, this.newNode] };
  }

  undo(state: GraphModel): GraphModel {
    if (!this.newNode) return state;
    return { ...state, nodes: state.nodes.filter((n) => n.id !== this.newNode!.id) };
  }
}

/**
 * ResizeNodeCommand - 节点尺寸修改(可合并)
 * 用绝对值 oldRect/newRect,合并时取第一条的 oldRect + 最后一条的 newRect。
 * 改 node.position(左/上角拖拽时同步平移以保持对角不动) + node.size。
 */
export class ResizeNodeCommand implements Command {
  id = 'resize-node';
  readonly nodeId: string;
  readonly oldRect: { x: number; y: number; width: number; height: number };
  readonly newRect: { x: number; y: number; width: number; height: number };

  constructor(
    nodeId: string,
    oldRect: { x: number; y: number; width: number; height: number },
    newRect: { x: number; y: number; width: number; height: number },
  ) {
    this.nodeId = nodeId;
    this.oldRect = oldRect;
    this.newRect = newRect;
  }

  execute(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId
          ? {
              ...n,
              position: { x: this.newRect.x, y: this.newRect.y },
              size: { width: this.newRect.width, height: this.newRect.height },
            }
          : n,
      ),
    };
  }

  undo(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId
          ? {
              ...n,
              position: { x: this.oldRect.x, y: this.oldRect.y },
              size: { width: this.oldRect.width, height: this.oldRect.height },
            }
          : n,
      ),
    };
  }
}
