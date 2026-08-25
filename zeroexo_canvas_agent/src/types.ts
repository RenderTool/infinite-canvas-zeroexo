/**
 * types — 画布快照与节点类型（浏览器上行数据契约）
 *
 * 节点类型对齐 zeroexo_front 画布：
 * script 剧本 / storyboard 分镜 / image 图片 / video 视频 / audio 音频
 * generator 生成器 / text 文本 / config 配置 / production-manager 制片管理
 */

export type Position = { x: number; y: number };
export type Size2D = { width: number; height: number };
export type Viewport = { x: number; y: number; k: number };

export type CanvasNodeType =
  | 'script'
  | 'storyboard'
  | 'image'
  | 'video'
  | 'audio'
  | 'generator'
  | 'text'
  | 'config'
  | 'production-manager';

export interface CanvasNode {
  id: string;
  type: string;
  title?: string;
  position: Position;
  size?: Size2D;
  /** 节点数据摘要（浏览器侧已截断，避免快照过大） */
  metadata?: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
}

/** 浏览器周期性/变更时上行的画布快照 */
export interface CanvasSnapshot {
  projectId?: string;
  title?: string;
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
  selectedNodeIds?: string[];
  viewport?: Viewport;
  /** SSE 客户端标识（首次连接分配） */
  clientId?: string;
}

export type AgentEmit = (type: string, payload: unknown) => void;
