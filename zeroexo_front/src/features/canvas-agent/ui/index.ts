/**
 * canvas-agent/ui/index.ts — 统一导出
 */

export { AgentDock } from './AgentDock.js';
export { useCanvasAgentStore } from './store.js';
export { useCanvasContext, CanvasContextProvider } from './context/canvas-context.js';
export { useAgentTheme } from './context/theme-context.js';
export { registerBlockRenderer } from './message-blocks/MessageRenderer.js';

export * from './types.js';