/**
 * @zeroexo/plugin-upload-queue - 类型定义
 *
 * 定义上传队列的任务类型、状态和回调。
 * 不依赖 React，纯 TypeScript 类型。
 */

/** 任务唯一标识 */
export type TaskId = string;

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

/** 单个上传任务 */
export interface UploadTask<TInput = unknown, TOutput = unknown> {
  id: TaskId;
  /** 任务输入数据 */
  input: TInput;
  /** 当前状态 */
  status: TaskStatus;
  /** 错误信息（仅 status='error' 时有值） */
  error?: string;
  /** 尝试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 任务处理函数（上传/处理业务逻辑） */
  processor: (input: TInput) => Promise<TOutput>;
  /** 任务执行结果 */
  result?: TOutput;
}

/** 队列进度快照 */
export interface QueueProgress {
  /** 总任务数 */
  total: number;
  /** 已完成（done + error + cancelled） */
  completed: number;
  /** 成功数 */
  success: number;
  /** 失败数 */
  failed: number;
  /** 取消数 */
  cancelled: number;
  /** 运行中 */
  running: number;
  /** 待处理 */
  pending: number;
  /** 进度百分比 0-100 */
  percent: number;
  /** 是否全部完成 */
  isDone: boolean;
}

/** 任务回调事件 */
export type TaskEvent =
  | { type: 'task-started'; taskId: TaskId }
  | { type: 'task-completed'; taskId: TaskId; result: unknown }
  | { type: 'task-failed'; taskId: TaskId; error: string }
  | { type: 'task-retrying'; taskId: TaskId; error: string; retryCount: number }
  | { type: 'task-cancelled'; taskId: TaskId };

/** 任务监听器 */
export type TaskEventListener = (event: TaskEvent) => void;

/** 队列配置 */
export interface UploadQueueConfig {
  /** 最大并发数（默认 5） */
  concurrency?: number;
  /** 重试次数（默认 2） */
  maxRetries?: number;
  /** 重试延迟基数(ms)（默认 1000，指数退避） */
  retryBaseDelay?: number;
}
