/**
 * agent-panel/index.ts — 全局 Agent 面板模块出口
 */

export { AgentPanel } from './AgentPanel.js';
export type { AgentPanelProps } from './AgentPanel.js';
export { PHASE_AGENT_ROLES, getAgentTypeByPhase } from './types.js';
export type { PhaseAgentRole, AgentPanelState } from './types.js';
export { agentClient } from './AgentClient.js';
export type { AgentClientCallbacks, AgentSendOptions, AgentExecuteResponse } from './AgentClient.js';