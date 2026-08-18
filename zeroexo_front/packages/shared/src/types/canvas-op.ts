/**
 * CanvasOp 类型定义
 *
 * 从 agent-unified-architecture spec 提取
 * 包含所有 canvas_* 操作类型，与后端 CanvasOpExecutor 对齐
 */

/**
 * Canvas 操作类型
 * 与后端 canvas-op-executor.service.ts 的 CanvasOp 接口对齐
 */
export type CanvasOp =
  | { op: 'add_node'; args: { id: string; type: string; position?: { x: number; y: number }; title?: string; data?: Record<string, unknown> } }
  | { op: 'add_edge'; args: { source: { nodeId: string; pinId: string }; target: { nodeId: string; pinId: string } } }
  | { op: 'update_node'; args: { id: string; patch: Record<string, unknown> } }
  | { op: 'remove_node'; args: { id: string } }
  | { op: 'set_selection'; args: { nodeIds: string[] } }
  | { op: 'focus'; args: { id: string } }
  | { op: 'update_data'; args: { id: string; data: Record<string, unknown> } };

/** CanvasOp 操作结果 */
export interface CanvasOpResult {
  success: boolean;
  op: string;
  data?: unknown;
  error?: string;
}