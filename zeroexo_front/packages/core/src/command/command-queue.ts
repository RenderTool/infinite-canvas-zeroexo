/**
 * CommandQueue - 命令队列(撤销/重做)
 * Phase 2 将完善合并策略和事件发布
 */

import type { GraphModel } from '../model/types.js';
import type { EventBus } from '../bus/event-bus.js';
import { CommandEvents, GraphEvents } from '../bus/events.js';

export interface CommandContext {
  eventBus: EventBus;
}

export interface Command {
  id: string;
  execute(state: GraphModel, context: CommandContext): GraphModel;
  undo(state: GraphModel, context: CommandContext): GraphModel;
}

export type MergeStrategy = (prev: Command, next: Command) => Command | null;

export class CommandQueue {
  private past: Command[] = [];
  private future: Command[] = [];
  private capacity: number;
  private state: GraphModel;
  private eventBus: EventBus;
  /** 合并策略列表(按注册顺序尝试,第一个返回非 null 的生效) */
  private mergeStrategies: MergeStrategy[] = [];

  constructor(state: GraphModel, eventBus: EventBus, capacity = 50) {
    this.state = state;
    this.eventBus = eventBus;
    this.capacity = capacity;
  }

  execute(command: Command): void {
    const context: CommandContext = { eventBus: this.eventBus };
    // 合并策略: 先撤销 prev 恢复到合并前状态,再执行合并命令
    // 避免 prev delta 被双重应用。
    // 遍历所有注册的策略,第一个返回非 null 的生效。
    if (this.mergeStrategies.length > 0 && this.past.length > 0) {
      const prev = this.past[this.past.length - 1]!;
      let merged: Command | null = null;
      for (const strategy of this.mergeStrategies) {
        merged = strategy(prev, command);
        if (merged) break;
      }
      if (merged) {
        this.past.pop();
        // 撤销 prev,恢复到 prev 执行前的状态
        this.state = prev.undo(this.state, context);
        // 在干净状态上执行合并命令(包含 prev + next 的完整 delta)
        this.state = merged.execute(this.state, context);
        this.past.push(merged);
        this.future = [];
        this.eventBus.emit(CommandEvents.EXECUTED, { commandId: merged.id });
        return;
      }
    }
    this.state = command.execute(this.state, context);
    this.past.push(command);
    if (this.past.length > this.capacity) {
      this.past.shift();
    }
    this.future = [];
    this.eventBus.emit(CommandEvents.EXECUTED, { commandId: command.id });
  }

  undo(): void {
    const command = this.past.pop();
    if (command) {
      const context: CommandContext = { eventBus: this.eventBus };
      this.state = command.undo(this.state, context);
      this.future.push(command);
      this.eventBus.emit(CommandEvents.UNDONE, { commandId: command.id });
    }
  }

  redo(): void {
    const command = this.future.pop();
    if (command) {
      const context: CommandContext = { eventBus: this.eventBus };
      this.state = command.execute(this.state, context);
      this.past.push(command);
      this.eventBus.emit(CommandEvents.REDONE, { commandId: command.id });
    }
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 设置合并策略(覆盖所有已注册策略,向后兼容) */
  setMergeStrategy(strategy: MergeStrategy): void {
    this.mergeStrategies = [strategy];
  }

  /** 追加合并策略(多插件可各自注册,按注册顺序尝试) */
  addMergeStrategy(strategy: MergeStrategy): void {
    this.mergeStrategies.push(strategy);
  }

  getState(): GraphModel {
    return this.state;
  }

  /**
   * 替换整个 graph 状态(用于加载持久化数据)
   * - 清空历史栈(新状态没有历史)
   * - emit EXECUTED 事件触发 store/persistence 更新
   * - 不进命令历史(这不是一个可撤销的操作)
   */
  replaceState(state: GraphModel): void {
    this.state = state;
    this.past = [];
    this.future = [];
    this.eventBus.emit(CommandEvents.EXECUTED, { commandId: 'replace-state' });
  }

  /**
   * 静默替换 graph 状态(用于临时性变更,如预览组拖拽)
   * - 仅替换 state 引用,不清空历史栈、不进历史
   * - 发布 GraphEvents.NODE_UPDATED(而非 CommandEvents),渲染层会同步新引用,
   *   但 persistence 等只监听 CommandEvents 的订阅者不会被触发
   */
  setStateSilent(state: GraphModel): void {
    this.state = state;
    this.eventBus.emit(GraphEvents.NODE_UPDATED, {});
  }
}
