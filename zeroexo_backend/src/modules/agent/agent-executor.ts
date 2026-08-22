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

import { AgentEvent, StepRequestData, QuestionRequestData } from './dto/agent.dto';
import { Tool } from './tool-registry';
import { AiEventsService } from '../ai-events/ai-events.service';

/**
 * 协议工具（Plan#33 D1）: 契约交互的"虚拟工具"。
 * LLM 通过调用它们触发 step/question/md 契约事件,executor 拦截并转为对应 AgentEvent,
 * step/question 会暂停循环等待前端回执(agent-session 通过 /tasks/:id/answer 恢复)。
 */
export const PROTOCOL_TOOLS: Tool[] = [
  {
    name: 'request_step',
    description:
      '发起 step 接口交互：向用户展示一个执行步骤（如 TVC 规划链路中的"确定广告目标"）。资料足够时用户可跳过；资料不足时引导用户上传/引用画布节点来收敛目标。调用后 Agent 会暂停等待用户确认。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '步骤唯一标识，如 generate_shots' },
        title: { type: 'string', description: '步骤标题' },
        description: { type: 'string', description: '步骤说明' },
        required: { type: 'boolean', description: '是否必选，默认 false（可跳过）' },
        prompts: {
          type: 'array',
          items: { type: 'string' },
          description: '引导提示：资料不足时引导上传/引用画布节点',
        },
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { value: { type: 'string' }, label: { type: 'string' } },
          },
          description: '快捷选项（如"直接生成全部 N 集"）',
        },
      },
      required: ['key', 'title'],
    },
    execute: async () => ({ ok: true }),
  },
  {
    name: 'request_question',
    description:
      '发起提问接口交互：向用户给出明确选项（单选/多选），用于需要用户拍板的决策点。调用后 Agent 会暂停等待用户选择。',
    parameters: {
      type: 'object',
      properties: {
        guideText: { type: 'string', description: '引导文案' },
        multi: { type: 'boolean', description: '是否多选，默认单选' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              label: { type: 'string' },
              desc: { type: 'string' },
            },
            required: ['value', 'label'],
          },
          description: '选项列表',
        },
      },
      required: ['items'],
    },
    execute: async () => ({ ok: true }),
  },
  {
    name: 'emit_md',
    description:
      '输出 Markdown 内容块：当需要以结构化 Markdown 展示内容（如分镜表、方案对比、清单）时调用，前端以 MarkdownBlock 渲染。不暂停。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Markdown 内容' },
      },
      required: ['content'],
    },
    execute: async () => ({ ok: true }),
  },
];

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

  /** 回执等待：协议事件(step/question)产出后,循环挂起等待前端通过 /tasks/:id/answer 恢复 */
  private pendingAnswer: string | null = null;
  private answerWaiters: Array<() => void> = [];

  constructor(
    private readonly agentType: string,
    private readonly instructions: string,
    private readonly tools: Tool[],
    private readonly llmService: LlmService,
    private readonly eventsService: AiEventsService,
  ) {}

  /**
   * 恢复挂起的协议交互: 注入用户回执内容(回答/跳过/自定义输入)。
   * 无等待者时缓存答案,下一个协议事件立即消费(避免竞态)。
   */
  resumeWithAnswer(answer: string): boolean {
    this.pendingAnswer = answer;
    const waiters = this.answerWaiters;
    this.answerWaiters = [];
    waiters.forEach((resolve) => resolve());
    return true;
  }

  /**
   * 等待用户回执(带超时,防止挂起任务永久占用并发槽位)。
   */
  private waitForAnswer(timeoutMs = 5 * 60 * 1000): Promise<string> {
    if (this.pendingAnswer !== null) {
      const value = this.pendingAnswer;
      this.pendingAnswer = null;
      return Promise.resolve(value);
    }
    return new Promise<string>((resolve, reject) => {
      const handler = () => {
        clearTimeout(timer);
        const value = this.pendingAnswer ?? '';
        this.pendingAnswer = null;
        resolve(value);
      };
      const timer = setTimeout(() => {
        const idx = this.answerWaiters.indexOf(handler);
        if (idx >= 0) this.answerWaiters.splice(idx, 1);
        reject(new Error('等待用户回执超时(5分钟),任务已终止'));
      }, timeoutMs);
      this.answerWaiters.push(handler);
    });
  }

  /** 协议工具名集合(LLM 调用即被拦截转为契约事件,不实际执行) */
  private static readonly PROTOCOL_TOOL_NAMES = new Set(
    PROTOCOL_TOOLS.map((t) => t.name),
  );

  /** 安全解析工具参数(JSON 解析失败时回退空对象) */
  private safeParseArgs(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** 将协议工具注入 LLM 工具列表(始终可用,由 SYSTEM_PROMPT 指导何时调用) */
  private buildLlmTools(): NonNullable<Parameters<LlmService['chat']>[0]['tools']> {
    const realTools = this.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: (t.parameters && Object.keys(t.parameters).length > 0)
          ? t.parameters
          : { type: 'object', properties: {} as Record<string, unknown> },
      },
    }));
    const protocolTools = PROTOCOL_TOOLS.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: (t.parameters && Object.keys(t.parameters).length > 0)
          ? t.parameters
          : { type: 'object', properties: {} as Record<string, unknown> },
      },
    }));
    return [...realTools, ...protocolTools];
  }

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

      // 转换工具定义为 LLM 格式（协议工具 + 实际工具）
      const llmTools = this.buildLlmTools();

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
            const toolName = toolCall.function.name;

            // 协议工具拦截(Plan#33 D1): 转为契约事件,不实际执行; step/question 暂停等待前端回执
            if (AgentExecutor.PROTOCOL_TOOL_NAMES.has(toolName)) {
              const args = this.safeParseArgs(toolCall.function.arguments);
              let userReply = '';
              switch (toolName) {
                case 'request_step': {
                  const step: StepRequestData = {
                    key: String(args.key ?? 'step'),
                    title: String(args.title ?? '步骤'),
                    description: args.description ? String(args.description) : undefined,
                    required: args.required !== undefined ? Boolean(args.required) : false,
                    prompts: Array.isArray(args.prompts) ? args.prompts.map(String) : undefined,
                    suggestions: Array.isArray(args.suggestions) ? args.suggestions : undefined,
                  };
                  yield {
                    type: 'agent:step_request',
                    data: { step },
                    timestamp: Date.now(),
                  };
                  userReply = await this.waitForAnswer();
                  messages.push({
                    role: 'user',
                    content: `[用户确认步骤 ${step.key}]: ${userReply || '已跳过'}`,
                  });
                  break;
                }
                case 'request_question': {
                  const question: QuestionRequestData = {
                    guideText: args.guideText ? String(args.guideText) : undefined,
                    multi: args.multi !== undefined ? Boolean(args.multi) : false,
                    items: Array.isArray(args.items) ? args.items : [],
                  };
                  yield {
                    type: 'agent:question_request',
                    data: { question },
                    timestamp: Date.now(),
                  };
                  userReply = await this.waitForAnswer();
                  messages.push({ role: 'user', content: `[用户选择]: ${userReply}` });
                  break;
                }
                case 'emit_md': {
                  const md = String(args.content ?? '');
                  yield { type: 'agent:md', data: { md }, timestamp: Date.now() };
                  break;
                }
              }
              // 回执 tool 消息: 保证 assistant.tool_calls 有对应 tool 响应(严格校验渠道必需)
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: userReply
                  ? `协议事件已发送,用户回执: ${userReply}`
                  : '协议事件已发送给用户(无需回执)',
              });
              continue;
            }

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
