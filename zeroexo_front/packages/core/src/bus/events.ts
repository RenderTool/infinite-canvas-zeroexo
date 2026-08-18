/** 事件类型常量 */

export const GraphEvents = {
  NODE_ADDED: 'graph:node-added',
  NODE_REMOVED: 'graph:node-removed',
  NODE_UPDATED: 'graph:node-updated',
  EDGE_ADDED: 'graph:edge-added',
  EDGE_REMOVED: 'graph:edge-removed',
} as const;

export const ViewportEvents = {
  CHANGED: 'viewport:changed',
} as const;

export const SelectionEvents = {
  CHANGED: 'selection:changed',
} as const;

export const InteractionEvents = {
  DRAG_START: 'interaction:drag-start',
  DRAG_END: 'interaction:drag-end',
} as const;

export const CommandEvents = {
  EXECUTED: 'command:executed',
  UNDONE: 'command:undone',
  REDONE: 'command:redone',
} as const;
