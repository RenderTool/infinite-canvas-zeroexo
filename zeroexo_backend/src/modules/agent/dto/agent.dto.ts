/** SSE Agent 事件负载 */
export interface AgentEvent {
  type: 'agent:step' | 'agent:tool_call' | 'agent:tool_result' | 'agent:progress' | 'agent:complete' | 'agent:error';
  data: unknown;
  timestamp: number;
}
