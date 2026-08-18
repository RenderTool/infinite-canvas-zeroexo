/**
 * @zeroexo/plugin-history
 * 历史层插件: 命令合并策略 + undo/redo 便捷方法
 *
 * 核心能力:
 * - 拖拽期间连续 MoveNodeCommand 合并为一条历史(180ms 时间窗)
 * - 暴露 undo() / redo() / canUndo() / canRedo()
 * - 发布 history:changed 事件(canUndo/canRedo 状态变化)
 *
 * 不依赖 React,纯逻辑插件。
 */

import type { Plugin, PluginContext } from '@zeroexo/core';
import { MoveNodeCommand, CommandEvents } from '@zeroexo/core';
import type { Command, MergeStrategy } from '@zeroexo/core';

/** MoveNodeCommand 内部字段(用于合并,TypeScript private 在运行时可访问) */
interface MoveNodeInternals {
  nodeId: string;
  delta: { x: number; y: number };
}

/** 拖拽命令合并时间窗(ms) */
const MOVE_MERGE_WINDOW_MS = 180;

export class HistoryPlugin implements Plugin {
  id = 'history';

  private commandQueue?: import('@zeroexo/core').CommandQueue;
  private lastMoveTime = 0;

  install(context: PluginContext): void {
    this.commandQueue = context.commandQueue;

    // 设置合并策略: 同一节点的连续 MoveNodeCommand 在时间窗内合并
    const self = this;
    const strategy: MergeStrategy = (prev: Command, next: Command): Command | null => {
      if (prev.id === 'move-node' && next.id === 'move-node') {
        const now = Date.now();
        if (now - self.lastMoveTime < MOVE_MERGE_WINDOW_MS) {
          self.lastMoveTime = now;
          return self.mergeMoveCommands(prev, next);
        }
        self.lastMoveTime = now;
      }
      return null;
    };
    context.commandQueue.setMergeStrategy(strategy);

    // 命令执行/撤销/重做后发布 history:changed
    const onHistoryChange = (): void => {
      context.eventBus.emit('history:changed', {
        canUndo: context.commandQueue.canUndo(),
        canRedo: context.commandQueue.canRedo(),
      });
    };
    context.eventBus.on(CommandEvents.EXECUTED, onHistoryChange);
    context.eventBus.on(CommandEvents.UNDONE, onHistoryChange);
    context.eventBus.on(CommandEvents.REDONE, onHistoryChange);
  }

  /** 撤销 */
  undo(): void {
    this.commandQueue?.undo();
  }

  /** 重做 */
  redo(): void {
    this.commandQueue?.redo();
  }

  canUndo(): boolean {
    return this.commandQueue?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this.commandQueue?.canRedo() ?? false;
  }

  /** 重置合并计时(拖拽结束时调用,确保下次拖拽不合并到上次) */
  breakMergeChain(): void {
    this.lastMoveTime = 0;
  }

  /** 合并两个 MoveNodeCommand(delta 叠加) */
  private mergeMoveCommands(prev: Command, next: Command): Command | null {
    const p = prev as unknown as MoveNodeInternals;
    const n = next as unknown as MoveNodeInternals;
    // 只合并同一节点的移动
    if (p.nodeId !== n.nodeId) return null;
    return new MoveNodeCommand(p.nodeId, {
      x: p.delta.x + n.delta.x,
      y: p.delta.y + n.delta.y,
    });
  }

  deactivate(): void {
    this.commandQueue = undefined;
  }

  uninstall(): void {
    this.commandQueue = undefined;
  }
}
