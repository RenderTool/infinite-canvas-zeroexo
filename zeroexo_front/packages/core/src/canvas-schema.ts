import type { Command } from './command/command-queue.js';
import type { EdgeRecord, NodeRecord } from './model/types.js';
import type { CanvasOperationContext } from './node-runtime-contract.js';

export interface ConnectionContext {
  source: { nodeId: string; pinId: string };
  target: { nodeId: string; pinId: string };
  sourceNode?: NodeRecord;
  targetNode?: NodeRecord;
}

export interface ConnectionDecision {
  allowed: boolean;
  reason?: string;
  action?: 'connect' | 'collect-into-target' | 'merge-stacks' | 'reject';
}

export interface NodeActionContext {
  actor: CanvasOperationContext['actor'];
  selectedNodeIds: string[];
  source?: string;
}

export interface NodeAction {
  id: string;
  label: string;
  nodeType: string;
  run(context: NodeActionContext): Command[];
}

export interface CanvasSchema {
  validateConnection(context: ConnectionContext): ConnectionDecision;
  normalizeBatch?(ops: readonly unknown[]): readonly unknown[];
  getNodeActions?(context: NodeActionContext): NodeAction[];
  validateNode?(node: NodeRecord): { valid: boolean; errors?: string[] };
  validateEdge?(edge: EdgeRecord): { valid: boolean; errors?: string[] };
}

export const allowAllCanvasSchema: CanvasSchema = {
  validateConnection: () => ({ allowed: true, action: 'connect' }),
};
