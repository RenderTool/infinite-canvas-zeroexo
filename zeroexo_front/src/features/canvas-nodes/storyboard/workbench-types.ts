/**
 * workbench-types - 出片工作台节点数据类型
 *
 * 数据直接写入 node.data，随画布 Yjs 同步。
 */

export type WorkbenchStatus = 'idle' | 'ready' | 'generating' | 'done';
// idle = 未开拍(初始态), ready = 已就绪(上游连入), generating = 生成中, done = 全部完成

export interface WorkbenchShot {
  id: string;
  number: number;
  description: string;
  shotType: string;
  duration: number;
  imagePrompt?: string;
  videoPrompt?: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  /** 首帧/尾帧图片 storageKey */
  firstFrameKey?: string;
  lastFrameKey?: string;
  /** 上游分镜 shot 的 id（用于追溯） */
  sourceShotId?: string;
}

export interface WorkbenchNodeData {
  status: WorkbenchStatus;
  shots: WorkbenchShot[];
  /** 总时长(秒) */
  totalDuration: number;
  /** 已完成的镜头数 */
  completedCount: number;
  /** 上游分镜节点 id */
  sourceStoryboardId?: string;
  /** 上游统筹节点 id */
  sourceProductionManagerId?: string;
}