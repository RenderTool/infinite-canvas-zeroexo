/**
 * CanvasOpExecutor - 统一画布操作执行器
 *
 * 将 CommandQueue 的命令封装为统一的 CanvasOp 操作描述，
 * 提供 executeOps 批量执行入口，替代直接调用 commandQueue.execute(new SomeCommand(...))。
 *
 * 支持的 op 类型:
 *   add_node, update_node, remove_node,
 *   add_edge, remove_edge,
 *   duplicate_node, resize_node, move_node,
 *   batch
 */

import {
  AddNodeCommand,
  AddEdgeCommand,
  RemoveEdgeCommand,
  RemoveNodeCommand,
  DuplicateNodeCommand,
  UpdateNodeDataCommand,
  ResizeNodeCommand,
  MoveNodeCommand,
  BatchCommand,
} from '@zeroexo/core';
import type { Command } from '@zeroexo/core';

// ===== 操作类型定义 =====

export interface AddNodeOp {
  op: 'add_node';
  args: {
    id: string;
    type: string;
    position: { x: number; y: number };
    size?: { width: number; height: number };
    title?: string;
    data?: Record<string, unknown>;
  };
}

export interface UpdateNodeOp {
  op: 'update_node';
  args: {
    id: string;
    patch: Record<string, unknown>;
  };
}

export interface RemoveNodeOp {
  op: 'remove_node';
  args: {
    id: string;
  };
}

export interface AddEdgeOp {
  op: 'add_edge';
  args: {
    id?: string;
    source: { nodeId: string; pinId?: string };
    target: { nodeId: string; pinId?: string };
  };
}

export interface RemoveEdgeOp {
  op: 'remove_edge';
  args: {
    id: string;
  };
}

export interface DuplicateNodeOp {
  op: 'duplicate_node';
  args: {
    id: string;
  };
}

export interface ResizeNodeOp {
  op: 'resize_node';
  args: {
    id: string;
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
  };
}

export interface MoveNodeOp {
  op: 'move_node';
  args: {
    id: string;
    delta: { x: number; y: number };
  };
}

export interface BatchOp {
  op: 'batch';
  args: {
    ops: CanvasOp[];
    label?: string;
  };
}

export type CanvasOp =
  | AddNodeOp
  | UpdateNodeOp
  | RemoveNodeOp
  | AddEdgeOp
  | RemoveEdgeOp
  | DuplicateNodeOp
  | ResizeNodeOp
  | MoveNodeOp
  | BatchOp;

// ===== 执行器 =====

export class CanvasOpExecutor {
  private commandQueue: any;

  constructor(commandQueue: any) {
    this.commandQueue = commandQueue;
  }

  /**
   * 批量执行一组 CanvasOp 操作
   * 如果操作数 > 1，自动包装为 BatchCommand 以支持撤销/重做
   */
  async executeOps(ops: CanvasOp[]): Promise<void> {
    if (!this.commandQueue || ops.length === 0) return;

    if (ops.length === 1) {
      const cmd = this.toCommand(ops[0]!);
      if (cmd) this.commandQueue.execute(cmd);
      return;
    }

    // 批量操作：收集所有命令
    const cmds: Command[] = [];
    for (const op of ops) {
      const cmd = this.toCommand(op);
      if (cmd) cmds.push(cmd);
    }
    if (cmds.length > 0) {
      this.commandQueue.execute(new BatchCommand(cmds, 'canvas-op-batch'));
    }
  }

  /**
   * 将单个 CanvasOp 转换为 Command 实例
   */
  private toCommand(op: CanvasOp): Command | null {
    switch (op.op) {
      case 'add_node': {
        const { id, type, position, size, title, data } = op.args;
        return new AddNodeCommand({
          id,
          type,
          position,
          size: size ?? { width: 200, height: 80 },
          title: title ?? '',
          data: data ?? {},
        });
      }

      case 'update_node': {
        const { id, patch } = op.args;
        return new UpdateNodeDataCommand(id, patch);
      }

      case 'remove_node': {
        return new RemoveNodeCommand(op.args.id);
      }

      case 'add_edge': {
        const { id, source, target } = op.args;
        const edgeId = id ?? `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        return new AddEdgeCommand({
          id: edgeId,
          source: { nodeId: source.nodeId, pinId: source.pinId ?? 'output' },
          target: { nodeId: target.nodeId, pinId: target.pinId ?? 'input' },
        });
      }

      case 'remove_edge': {
        return new RemoveEdgeCommand(op.args.id);
      }

      case 'duplicate_node': {
        return new DuplicateNodeCommand(op.args.id);
      }

      case 'resize_node': {
        const { id, oldRect, newRect } = op.args;
        return new ResizeNodeCommand(id, oldRect, newRect);
      }

      case 'move_node': {
        const { id, delta } = op.args;
        return new MoveNodeCommand(id, delta);
      }

      case 'batch': {
        const subCmds: Command[] = [];
        for (const subOp of op.args.ops) {
          const cmd = this.toCommand(subOp);
          if (cmd) subCmds.push(cmd);
        }
        if (subCmds.length === 0) return null;
        return new BatchCommand(subCmds, op.args.label ?? 'canvas-op-batch');
      }

      default:
        return null;
    }
  }
}