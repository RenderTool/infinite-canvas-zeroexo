/**
 * UploadQueue - 通用并发任务队列
 *
 * 职责:
 * - 并发控制（限流）
 * - 自动重试（指数退避）
 * - 进度追踪
 * - 事件通知
 *
 * 不依赖 React / UI，纯业务逻辑。
 * 调用方负责提供 task.processor（实际的上传/处理逻辑）。
 */

import type {
  UploadTask,
  UploadQueueConfig,
  QueueProgress,
  TaskEvent,
  TaskEventListener,
  TaskId,
} from './types.js';

/** 默认配置 */
const DEFAULTS = {
  concurrency: 5,
  maxRetries: 2,
  retryBaseDelay: 1000,
};

/**
 * 计算指数退避延迟
 * retryCount=0 → baseDelay = 1s
 * retryCount=1 → baseDelay * 2 = 2s
 * retryCount=2 → baseDelay * 4 = 4s
 */
function backoffDelay(base: number, retryCount: number): number {
  return base * Math.pow(2, retryCount);
}

export class UploadQueue {
  private tasks: Map<TaskId, UploadTask> = new Map();
  private pending: TaskId[] = [];
  private running = new Set<TaskId>();
  private aborted = false;
  private listeners = new Set<TaskEventListener>();

  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelay: number;

  /** resolve 回调（外部等待队列完成） */
  private doneResolver: (() => void) | null = null;
  private donePromise: Promise<void> | null = null;

  constructor(config: UploadQueueConfig = {}) {
    this.concurrency = config.concurrency ?? DEFAULTS.concurrency;
    this.maxRetries = config.maxRetries ?? DEFAULTS.maxRetries;
    this.retryBaseDelay = config.retryBaseDelay ?? DEFAULTS.retryBaseDelay;
  }

  // ===== 公开 API =====

  /** 添加批量任务并开始处理 */
  addTasks<TInput, TOutput>(
    inputs: TInput[],
    processor: (input: TInput) => Promise<TOutput>,
  ): void {
    for (const input of inputs) {
      const task: UploadTask = {
        id: this.generateId(),
        input,
        status: 'pending',
        retryCount: 0,
        maxRetries: this.maxRetries,
        createdAt: Date.now(),
        processor: processor as UploadTask['processor'],
      };
      this.tasks.set(task.id, task);
      this.pending.push(task.id);
    }
    this.start();
  }

  /** 启动队列处理（如果尚未启动） */
  start(): void {
    if (!this.donePromise) {
      this.donePromise = new Promise((resolve) => {
        this.doneResolver = resolve;
      });
    }
    this.aborted = false;
    this.schedule();
  }

  /** 等待队列全部完成 */
  async waitForCompletion(): Promise<void> {
    if (!this.donePromise) return;
    await this.donePromise;
  }

  /** 取消队列（正在运行的任务继续完成，待处理的任务标记为 cancelled） */
  cancel(): void {
    this.aborted = true;
    for (const id of this.pending) {
      const task = this.tasks.get(id);
      if (task) {
        task.status = 'cancelled';
        this.emit({ type: 'task-cancelled', taskId: id });
      }
    }
    this.pending = [];
    this.tryResolve();
  }

  /** 注册事件监听 */
  on(listener: TaskEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 获取当前进度快照 */
  getProgress(): QueueProgress {
    let total = 0;
    let completed = 0;
    let success = 0;
    let failed = 0;
    let cancelled = 0;
    let running = 0;
    let pending = 0;

    for (const task of this.tasks.values()) {
      total++;
      switch (task.status) {
        case 'done':
          success++;
          completed++;
          break;
        case 'error':
          failed++;
          completed++;
          break;
        case 'cancelled':
          cancelled++;
          completed++;
          break;
        case 'running':
          running++;
          break;
        case 'pending':
          pending++;
          break;
      }
    }

    return {
      total,
      completed,
      success,
      failed,
      cancelled,
      running,
      pending,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      isDone: completed >= total && total > 0,
    };
  }

  /** 获取所有任务 */
  getTasks(): UploadTask[] {
    return [...this.tasks.values()];
  }

  /** 获取单个任务 */
  getTask(id: TaskId): UploadTask | undefined {
    return this.tasks.get(id);
  }

  /** 获取当前运行数 */
  getRunningCount(): number {
    return this.running.size;
  }

  /** 获取待处理数 */
  getPendingCount(): number {
    return this.pending.length;
  }

  /** 重置队列状态 */
  reset(): void {
    this.tasks.clear();
    this.pending = [];
    this.running.clear();
    this.aborted = false;
    this.donePromise = null;
    this.doneResolver = null;
    this.listeners.clear();
  }

  // ===== 内部方法 =====

  /** 调度待处理任务 */
  private schedule(): void {
    if (this.aborted) return;

    while (this.pending.length > 0 && this.running.size < this.concurrency) {
      const id = this.pending.shift();
      if (!id) break;
      const task = this.tasks.get(id);
      if (!task || task.status === 'cancelled') continue;
      this.executeTask(id);
    }

    // 如果队列已空且没有正在运行的，标记完成
    if (this.pending.length === 0 && this.running.size === 0) {
      this.tryResolve();
    }
  }

  /** 执行单个任务 */
  private async executeTask(id: TaskId): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) return;

    this.running.add(id);
    task.status = 'running';
    task.startedAt = Date.now();
    this.emit({ type: 'task-started', taskId: id });

    try {
      const result = await task.processor(task.input);
      task.status = 'done';
      task.result = result;
      task.completedAt = Date.now();
      this.running.delete(id);
      this.emit({ type: 'task-completed', taskId: id, result });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      task.retryCount++;

      if (task.retryCount <= task.maxRetries) {
        // 重试
        this.running.delete(id);
        task.status = 'pending';
        this.emit({
          type: 'task-retrying',
          taskId: id,
          error: errorMsg,
          retryCount: task.retryCount,
        });

        // 指数退避后放回队列
        const delay = backoffDelay(this.retryBaseDelay, task.retryCount - 1);
        setTimeout(() => {
          if (!this.aborted) {
            this.pending.unshift(id);
            this.schedule();
          }
        }, delay);
      } else {
        // 超过最大重试次数，标记失败
        task.status = 'error';
        task.error = errorMsg;
        task.completedAt = Date.now();
        this.running.delete(id);
        this.emit({ type: 'task-failed', taskId: id, error: errorMsg });
      }
    }

    // 调度下一个
    this.schedule();
  }

  /** 如果所有任务完成，触发 donePromise */
  private tryResolve(): void {
    if (this.pending.length === 0 && this.running.size === 0) {
      this.doneResolver?.();
      this.donePromise = null;
      this.doneResolver = null;
    }
  }

  /** 发送事件通知 */
  private emit(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 监听器抛错不影响队列
      }
    }
  }

  private counter = 0;
  private generateId(): string {
    return `task_${Date.now()}_${++this.counter}`;
  }
}
