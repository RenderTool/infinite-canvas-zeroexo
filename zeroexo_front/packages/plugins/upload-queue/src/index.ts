/**
 * @zeroexo/plugin-upload-queue
 *
 * 通用并发上传队列插件。
 * 提供:
 * - UploadQueue: 独立于 UI 的并发任务队列（重试、进度追踪、事件通知）
 * - UploadQueuePlugin: Plugin 实现（通过 PluginHost 管理生命周期）
 * - 类型定义: UploadTask, QueueProgress, TaskEvent 等
 *
 * 用法:
 * ```ts
 * import { UploadQueuePlugin } from '@zeroexo/plugin-upload-queue';
 *
 * const uploadQueuePlugin = new UploadQueuePlugin({ concurrency: 5 });
 * editor.plugins.install(uploadQueuePlugin);
 *
 * // 获取队列实例
 * const queue = uploadQueuePlugin.getQueue();
 *
 * // 添加任务
 * queue.addTasks(files, async (file) => {
 *   return await uploadAsset(file);
 * });
 * ```
 */

import type { Plugin, PluginContext } from '@zeroexo/core';
import { UploadQueue } from './upload-queue.js';
import type { UploadQueueConfig } from './types.js';

export type { UploadTask, QueueProgress, TaskEvent, TaskEventListener, TaskId, TaskStatus, UploadQueueConfig } from './types.js';
export { UploadQueue } from './upload-queue.js';

/** 插件 ID */
export const UPLOAD_QUEUE_PLUGIN_ID = 'upload-queue';

/**
 * UploadQueuePlugin - 上传队列插件
 *
 * 通过 PluginHost 管理，可在插件间共享队列能力。
 * 其他插件可通过 `context.getPlugin(UploadQueuePlugin)` 获取实例。
 */
export class UploadQueuePlugin implements Plugin {
  id = UPLOAD_QUEUE_PLUGIN_ID;
  dependencies?: string[];
  provides?: string[];

  private queue: UploadQueue;

  constructor(config: UploadQueueConfig = {}) {
    this.queue = new UploadQueue(config);
  }

  install(_context: PluginContext): void {
    // UploadQueuePlugin 不需要使用 context
  }

  activate(): void {
    // 插件激活时无需特殊操作，队列按需启动
  }

  deactivate(): void {
    // 插件停用时取消所有待处理任务
    this.queue.cancel();
  }

  uninstall(): void {
    this.queue.reset();
  }

  /** 获取队列实例 */
  getQueue(): UploadQueue {
    return this.queue;
  }
}
