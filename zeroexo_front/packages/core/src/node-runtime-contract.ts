import type { Command, CommandQueue } from './command/command-queue.js';
import type { EdgeRecord, NodeRecord } from './model/types.js';

export type NodeScaleMode = 'free' | 'uniform' | 'locked';
export type NodeSelectionMode = 'runtime' | 'custom';

export interface NodeSizeBasis {
  width: number;
  height: number;
  referenceSize?: number;
}

export interface NodeScaleContract {
  basis: NodeSizeBasis;
  mode: NodeScaleMode;
  min?: { width: number; height: number };
  max?: { width: number; height: number };
  preserveAspectRatio?: boolean;
}

export interface NodeElementMeasureContract {
  /** DOM 类型由渲染包具体实现，core 保持无 DOM 依赖。 */
  getMeasureElement?: (root: unknown) => unknown | null;
  fallback: 'root';
}

export interface NodeStateStyle {
  className?: string;
  style?: Record<string, string | number>;
  outline?: 'none' | 'subtle' | 'strong';
  opacity?: number;
}

export interface NodeMotionContract {
  switch?: 'none' | 'fade' | 'crossfade' | 'slide';
  durationMs?: number;
  reducedMotionFallback?: 'none' | 'fade';
}

export interface NodeVisualContract {
  appearance: 'shell' | 'custom';
  selectionMode: NodeSelectionMode;
  hover?: NodeStateStyle;
  selected?: NodeStateStyle;
  disabled?: NodeStateStyle;
  focus?: NodeStateStyle;
  motion?: NodeMotionContract;
  themeTokens?: Record<string, string>;
}

export interface OverlayContract {
  anchor: 'node-bounds' | 'pin' | 'world-point';
  scaleMode: 'screen-fixed' | 'world-scaled';
  collision: 'none' | 'viewport' | 'node';
  pointerPolicy: 'interactive' | 'passive';
}

export interface NodeCapabilities {
  stackable?: boolean;
  mediaKinds?: string[];
  capabilities?: string[];
}

export interface NodeDefinition {
  schemaVersion: number;
  size?: NodeScaleContract;
  measure?: NodeElementMeasureContract;
  visual?: NodeVisualContract;
  overlay?: OverlayContract;
  capabilities?: NodeCapabilities;
}

export interface NodeRuntimeContract {
  definition?: NodeDefinition;
  createCommands?: (node: NodeRecord, context: NodeRuntimeContext) => Command[];
  getMeasureBounds?: (node: NodeRecord) => { width: number; height: number };
}

export interface NodeRuntimeContext {
  commandQueue: CommandQueue;
  graph: { nodes: NodeRecord[]; edges: EdgeRecord[] };
  actor: CanvasActor;
  operationId: string;
}

export type CanvasActor = 'user' | 'agent' | 'import' | 'stress';

export interface CanvasOperationContext {
  operationId: string;
  traceId: string;
  actor: CanvasActor;
  source?: string;
  projectId?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  parentOperationId?: string;
}

export interface CanvasOperationMetrics {
  operationId: string;
  traceId: string;
  actor: CanvasActor;
  opCount: number;
  commandCount: number;
  nodeCountBefore?: number;
  nodeCountAfter?: number;
  edgeCountBefore?: number;
  edgeCountAfter?: number;
  durationMs: number;
  status: 'planned' | 'executed' | 'rejected' | 'failed';
  error?: string;
}

export interface CanvasOperationObserver {
  onPlan?(metrics: CanvasOperationMetrics): void;
  onComplete?(metrics: CanvasOperationMetrics): void;
}
