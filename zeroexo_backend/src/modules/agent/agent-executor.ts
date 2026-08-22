/**
 * agent-executor - 单个 Agent 执行器
 *
 * 接收用户的输入(每条消息)和工具定义,驱动 LLM 调用循环:
 *   1. 发送系统指令 + 用户输入到 LLM
 *   2. 若 LLM 返回 tool_call → 执行工具 → 返回结果 → 继续循环
 *   3. 若 LLM 返回文本 → 视为最终输出,停止循环
 *   4. 最大迭代 20 次防止死循环
 *
 * 每一步通过 AsyncGenerator 向上层推送 SSE 事件。
 */

import { AgentEvent } from './dto/agent.dto';
import { Tool } from './tool-registry';
import { AiEventsService } from '../ai-events/ai-events.service';

/** LLM 服务的最小接口定义 */
export interface LlmService {
  chat(params: {
    messages: ChatMessage[];
    tools?: Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
  }): Promise<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

/** 对话消息(OpenAI 兼容: tool 消息必须携带 tool_call_id, assistant 消息需回传 tool_calls) */
export interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export class AgentExecutor {
  private readonly maxIterations = 20;

  constructor(
    private readonly agentType: string,
    private readonly instructions: string,
    private readonly tools: Tool[],
    private readonly llmService: LlmService,
    private readonly eventsService: AiEventsService,
  ) {}

  async* execute(
    input: string,
    artifactId: string,
    userId: string,
  ): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

    try {
      // 1. 推送初始状态
      yield {
        type: 'agent:step',
        data: { agentType: this.agentType, status: 'thinking', message: 'Agent 开始思考...' },
        timestamp: Date.now(),
      };

      // 构造消息列表: 系统指令 + 用户输入
      const messages: ChatMessage[] = [
        { role: 'system', content: this.instructions },
        { role: 'user', content: input },
      ];

      // 转换工具定义为 LLM 格式（使用工具实际定义的参数 schema，而非硬编码空对象）
      const llmTools = this.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: (t.parameters && Object.keys(t.parameters).length > 0)
            ? t.parameters
            : { type: 'object', properties: {} as Record<string, unknown> },
        },
      }));

      let iteration = 0;
      let finalOutput = '';

      while (iteration < this.maxIterations) {
        iteration++;

        // 2. 调用 LLM
        const response = await this.llmService.chat({
          messages,
          tools: llmTools.length > 0 ? llmTools : undefined,
        });

        const responseMessage = response.message;

        // 3. 处理 tool_call
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          // 将 assistant 的 tool_calls 消息回传(OpenAI 兼容规范必需,否则严格校验渠道拒绝)
          messages.push({
            role: 'assistant',
            content: responseMessage.content ?? '',
            tool_calls: responseMessage.tool_calls,
          });

          for (const toolCall of responseMessage.tool_calls) {
            // 推送工具调用事件
            yield {
              type: 'agent:tool_call',
              data: {
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
              timestamp: Date.now(),
            };

            // 查找并执行工具
            const tool = this.tools.find((t) => t.name === toolCall.function.name);
            if (tool) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                const result = await tool.execute(args);

                // 推送工具执行结果
                yield {
                  type: 'agent:tool_result',
                  data: {
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    result,
                  },
                  timestamp: Date.now(),
                };

                // 将工具结果追加到消息列表(tool 消息必须携带 tool_call_id)
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result),
                });
              } catch (err) {
                yield {
                  type: 'agent:tool_result',
                  data: {
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    error: (err as Error).message,
                  },
                  timestamp: Date.now(),
                };

                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: `Error: ${(err as Error).message}`,
                });
              }
            }
          }

          // 推送进度事件
          yield {
            type: 'agent:progress',
            data: { iteration, toolCalls: responseMessage.tool_calls.length },
            timestamp: Date.now(),
          };
        }

        // 4. 处理文本响应(最终输出)
        if (responseMessage.content) {
          finalOutput = responseMessage.content;

          yield {
            type: 'agent:step',
            data: {
              agentType: this.agentType,
              status: 'responding',
              content: finalOutput,
            },
            timestamp: Date.now(),
          };

          // 文本响应代表 agent 完成
          break;
        }

        // 安全机制: 如果既没有 content 也没有 tool_calls,退出
        if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
          break;
        }
      }

      // 5. 推送完成事件
      const durationMs = Date.now() - startTime;
      yield {
        type: 'agent:complete',
        data: {
          agentType: this.agentType,
          output: finalOutput,
          iterations: iteration,
          durationMs,
        },
        timestamp: Date.now(),
      };

      // 通过 AiEventsService 广播完成事件(供 Admin 页面消费)
      this.eventsService.broadcast({
        type: 'agent:complete',
        userId,
        resourceId: artifactId,
        timestamp: Date.now(),
        meta: {
          agentType: this.agentType,
          durationMs,
          iterations: iteration,
        },
      });
    } catch (err) {
      // 6. 推送错误事件
      const errorMessage = (err as Error).message;
      yield {
        type: 'agent:error',
        data: {
          agentType: this.agentType,
          error: errorMessage,
        },
        timestamp: Date.now(),
      };

      this.eventsService.broadcast({
        type: 'agent:error',
        userId,
        resourceId: artifactId,
        timestamp: Date.now(),
        meta: { agentType: this.agentType, error: errorMessage },
      });
    }
  }
}
