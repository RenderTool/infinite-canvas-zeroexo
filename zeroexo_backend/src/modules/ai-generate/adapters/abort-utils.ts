/**
 * AbortController 共享工具
 *
 * 所有适配器的 HTTP 请求统一使用此工具创建 AbortController，
 * 实现「外部取消信号 + 内部超时」的组合中断机制。
 *
 * 使用方式：
 *   const { controller, cleanup } = createAbortController(ctx.timeoutMs, ctx.signal);
 *   try {
 *     const res = await fetch(url, { signal: controller.signal, ... });
 *     ...
 *   } catch (err) {
 *     if (err instanceof Error && err.name === 'AbortError') {
 *       throw new Error(isUserCancelled(err, ctx.signal) ? '用户取消' : `请求超时(...)`);
 *     }
 *     throw err;
 *   } finally {
 *     cleanup();
 *   }
 */

/** 组合中断控制器的返回值 */
export interface AbortHandle {
  /** 组合后的 AbortController，传入 fetch 的 signal */
  controller: AbortController;
  /** 清理函数，在 finally 中调用（清除定时器 + 移除事件监听器） */
  cleanup: () => void;
}

/**
 * 创建组合 AbortController：外部取消信号 + 内部超时
 *
 * 两种中断源任一触发都会 abort：
 *   1. timeoutMs 超时
 *   2. externalSignal.abort()（用户取消）
 *
 * @param timeoutMs 超时毫秒数
 * @param externalSignal 外部取消信号（来自 Service 层的 AbortController）
 */
export function createAbortController(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): AbortHandle {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // 外部取消信号触发时，abort 内部 controller
  const onExternalAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      // 已经取消，立即 abort
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  return { controller, cleanup };
}

/**
 * 判断 AbortError 是否由用户取消引起（而非超时）
 *
 * @param err catch 块捕获的错误
 * @param externalSignal 外部取消信号（来自 ctx.signal）
 * @returns true 表示用户主动取消，false 表示超时
 */
export function isUserCancelled(
  err: unknown,
  externalSignal?: AbortSignal,
): boolean {
  return (
    err instanceof Error &&
    err.name === 'AbortError' &&
    externalSignal?.aborted === true
  );
}
