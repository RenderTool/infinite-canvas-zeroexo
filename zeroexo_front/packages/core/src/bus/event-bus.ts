/**
 * EventBus - 事件总线
 * 支持: 同步/异步 handler、可取消事件(emitCancelable + preventDefault)
 */

export interface Cancelable {
  /** 是否已被调用 preventDefault */
  defaultPrevented: boolean;
  /** 取消事件,后续 handler 不再执行,emitCancelable 返回 false */
  preventDefault(): void;
}

export interface EventContext {
  timestamp: number;
  source?: string;
  /** 仅 emitCancelable 触发时存在,普通 emit 为 undefined */
  cancelable?: Cancelable;
}

export type EventHandler<T = unknown> = (payload: T, context: EventContext) => void | Promise<void>;
export type Unsubscribe = () => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /** 订阅事件,返回取消订阅函数 */
  on<T>(event: string, handler: EventHandler<T>): Unsubscribe {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
    return () => this.off(event, handler);
  }

  /** 取消订阅 */
  off<T>(event: string, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler);
  }

  /** 普通触发,所有 handler 都会执行,不支持取消 */
  emit<T>(event: string, payload: T, source?: string): void {
    const context: EventContext = { timestamp: Date.now(), source };
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        void handler(payload, context);
      }
    }
  }

  /**
   * 可取消触发:handler 可通过 context.cancelable.preventDefault() 终止后续 handler
   * 返回 true 表示未被取消,false 表示已被取消
   * 注意: 仅同步阶段的 preventDefault 生效,async handler 在 await 后调用 preventDefault 无效
   */
  emitCancelable<T>(event: string, payload: T, source?: string): boolean {
    const cancelable: Cancelable = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    const context: EventContext = { timestamp: Date.now(), source, cancelable };
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        void handler(payload, context);
        if (cancelable.defaultPrevented) break;
      }
    }
    return !cancelable.defaultPrevented;
  }

  /** 查询某事件是否有订阅者 */
  hasListeners(event: string): boolean {
    const set = this.handlers.get(event);
    return !!set && set.size > 0;
  }

  /** 清空所有订阅 */
  clear(): void {
    this.handlers.clear();
  }
}
