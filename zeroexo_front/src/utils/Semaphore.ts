/**
 * Semaphore - 信号量并发控制
 *
 * 用于限制同时执行的最大异步任务数。
 * 用法:
 *   const sem = new Semaphore(3);
 *   await sem.run(() => fetch('/api/data'));
 *   sem.dispose(); // 清理
 */
export class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly maxConcurrency: number) {}

  /** 获取一个许可，等待直到有可用许可 */
  async acquire(): Promise<void> {
    if (this.disposed) throw new Error('Semaphore 已销毁');
    if (this.current < this.maxConcurrency) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /** 释放一个许可 */
  release(): void {
    if (this.current <= 0) return;
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.current--;
    }
  }

  /** 运行一个异步任务，自动管理许可 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** 销毁所有等待的任务 */
  dispose(): void {
    this.disposed = true;
    for (const resolve of this.queue) {
      resolve(); // 让等待的 promise 继续，但后续检查 disposed
    }
    this.queue = [];
    this.current = 0;
  }
}