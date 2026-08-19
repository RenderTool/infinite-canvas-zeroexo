/**
 * 剧创节点数据类型(独立页面壳版本)
 *
 * 剧本(script) / 分镜(storyboard) / 出片(workbench) 三类画布节点共用结构。
 * 节点不依赖任何创作项目:内容直接写入节点 data,随画布 Yjs 实时同步。
 */

/** 剧创节点类型 */
export type CreationNodeType = 'script' | 'storyboard' | 'workbench';

/** 剧创节点 data 结构(各类型通过可选字段扩展) */
export interface CreationNodeData {
  /** 节点标题 */
  title: string;
  /** 阶段状态 idle/ready */
  status: 'idle' | 'ready';
  /** 剧本单版本内容(HTML);仅剧本节点使用 */
  content?: string;
}

/** 各剧创节点默认尺寸 */
export const CREATION_DEFAULT_SIZE: Record<CreationNodeType, { width: number; height: number }> = {
  script: { width: 720, height: 520 },
  storyboard: { width: 720, height: 520 },
  workbench: { width: 720, height: 520 },
};

/** 各剧创节点最小尺寸(不可继续缩小) */
export const CREATION_MIN_SIZE: Record<CreationNodeType, { width: number; height: number }> = {
  script: { width: 480, height: 360 },
  storyboard: { width: 640, height: 400 },
  workbench: { width: 480, height: 360 },
};

/** 分镜节点生成中的紧凑占位尺寸(生成完成后展开到 defaultSize) */
export const CREATION_COMPACT_SIZE = { width: 200, height: 150 };

/** 各剧创节点引脚定义(剧本:1 输出;分镜:1 输入 + 1 输出;出片:1 输入) */
export const CREATION_PINS: Record<
  CreationNodeType,
  { id: string; name: string; direction: 'input' | 'output' }[]
> = {
  script: [{ id: 'output', name: 'Output', direction: 'output' }],
  storyboard: [
    { id: 'input', name: 'Input', direction: 'input' },
    { id: 'output', name: 'Output', direction: 'output' },
  ],
  workbench: [{ id: 'input', name: 'Input', direction: 'input' }],
};