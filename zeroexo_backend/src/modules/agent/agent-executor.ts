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

import { AgentEvent, StepRequestData, QuestionRequestData, AgentPhase, PlanData, UploadRequestData, BriefData, ParamsRequestData } from './dto/agent.dto';
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
        noteEnabled: {
          type: 'boolean',
          description: '是否附用户备注输入框（收集偏好/风格等信息时设为 true）',
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
  {
    name: 'request_params',
    description:
      '发起节点参数契约表单（R3 F1）：生成类任务需要用户确认参数时调用，前端以 ParamsBlock 渲染标准参数表单（字段选择 + 「自动」方案一键填入 + 备注输入框），提交后作为新一轮消息回执。禁止在聊天里用「我推荐你用xxx」口头给参数；生成节点前涉及参数拍板一律用本工具。',
    parameters: {
      type: 'object',
      properties: {
        nodeType: {
          type: 'string',
          enum: ['image', 'video', 'audio', 'text', 'script', 'storyboard'],
          description: '目标节点类型',
        },
        title: { type: 'string', description: '表单标题（引导文案）' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: '字段键（对齐生成参数：quality/size/count/vquality/seconds/voice/format…）' },
              label: { type: 'string', description: '字段显示名' },
              type: { type: 'string', enum: ['select', 'text', 'number', 'boolean'], description: '字段类型' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { label: { type: 'string' }, value: { type: 'string' } },
                  required: ['label', 'value'],
                },
                description: 'select 类型的选项列表',
              },
              default: { description: '默认值' },
              desc: { type: 'string', description: '字段说明' },
            },
            required: ['key', 'label', 'type'],
          },
          description: '标准参数选项表单字段（用户逐项填写）',
        },
        presets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '方案名（如「电影感」）' },
              desc: { type: 'string', description: '方案说明' },
              values: { type: 'object', description: '一键填入的字段值（key → value）' },
            },
            required: ['name', 'values'],
          },
          description: '「自动」方案（点击一键填入 fields，可多套）',
        },
        noteLabel: { type: 'string', description: '备注输入框标签（进一步修改提示）' },
      },
      required: ['nodeType'],
    },
    execute: async () => ({ ok: true }),
  },
  {
    name: 'todo_write',
    description:
      '写入任务清单快照（Plan#36 P0-3）：执行多步骤任务（分镜/剧管/工作链）时同步进度，前端固定在输入框上方显示任务卡（已完成/总数）。可多次调用覆盖更新。不暂停。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '任务项唯一标识' },
              label: { type: 'string', description: '任务项文案' },
              status: {
                type: 'string',
                enum: ['queued', 'running', 'completed', 'failed'],
                description: '状态: queued 待执行 / running 执行中 / completed 完成 / failed 失败',
              },
            },
            required: ['id', 'label'],
          },
          description: '任务项列表（全量覆盖）',
        },
      },
      required: ['items'],
    },
    execute: async () => ({ ok: true }),
  },
  {
    name: 'plan_present',
    description:
      '提交结构化执行计划（Plan#36 R2-5）：多步骤任务在动手前必须先用本工具向用户展示计划（目标/步骤/每步预期产物/风险提示），前端以计划卡呈现并阻塞等待用户确认或提出修改；用户确认后才允许执行画布变更/生成类工具。简单的单步任务无需调用。',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: '计划目标（一句话）' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '步骤唯一标识' },
              label: { type: 'string', description: '步骤文案' },
              deliverable: { type: 'string', description: '预期产物' },
              risk: { type: 'string', description: '该步骤风险提示（可选）' },
            },
            required: ['id', 'label'],
          },
          description: '步骤列表（2-8 步）',
        },
        risks: {
          type: 'array',
          items: { type: 'string' },
          description: '全局风险提示（如主体不一致影响场景一致性）',
        },
      },
      required: ['goal', 'steps'],
    },
    execute: async () => ({ ok: true }),
  },
  {
    name: 'request_upload',
    description:
      '请求用户上传文件（Plan#36 R2-5）：需要用户提供素材/文档（小说原文/剧本/参考图）时调用，前端在对话内直接弹出上传卡（无需用户去画布建节点）。上传完成后文件名/大小/内容摘要作为回执返回，可继续用其他工具处理。调用后暂停等待上传。',
    parameters: {
      type: 'object',
      properties: {
        guideText: { type: 'string', description: '引导文案（说明需要什么文件、用途）' },
        accept: { type: 'string', description: '接受的文件类型，如 .txt,.md,.docx' },
        multiple: { type: 'boolean', description: '是否允许多文件，默认否' },
      },
    },
    execute: async () => ({ ok: true }),
  },
  {
    name: 'emit_brief',
    description:
      '输出任务简报（Plan#36 R2-5）：任务完成交付时调用，前端以简报卡呈现（成果摘要 + 产出节点引用点击可聚焦 + 待审核声明）。每轮任务收尾最多调用一次。不暂停。',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '成果摘要（做了什么/产出什么）' },
        nodeRefs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string', description: '画布节点 ID' },
              label: { type: 'string', description: '节点显示名' },
            },
            required: ['nodeId', 'label'],
          },
          description: '产出节点引用',
        },
        note: { type: 'string', description: '待审核声明/后续引导（如"有疑问可继续问我"）' },
      },
      required: ['summary'],
    },
    execute: async () => ({ ok: true }),
  },
  {
    name: 'research_note',
    description:
      '记录方案调研结论（Plan#36 R2-5）：对用户方案的可行性/风格/技术选型做过分析判断时调用，将结论摘要写入执行时间线供用户可见。不暂停、不阻塞。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '调研主题（如"小说拆解方案可行性"）' },
        conclusion: { type: 'string', description: '结论摘要（2-4 句）' },
      },
      required: ['topic', 'conclusion'],
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
  /**
   * 可选：流式聊天（Plan#36 P0-1 增量渲染）。
   * 实现方支持时走流式，逐块回调 onDelta（正文增量）/ onThinkingDelta（思考增量），
   * 最终返回与 chat() 相同的完整消息结构（用于 tool_calls 判断）。
   * 未实现该方法时 executor 回退到 chat()（工具调用链完整优先）。
   */
  chatStream?(params: {
    messages: ChatMessage[];
    tools?: Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>;
    onDelta?: (delta: string) => void;
    onThinkingDelta?: (delta: string) => void;
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

/** LLM 单轮响应消息（chat / chatStream 统一结构） */
export interface LlmMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

export class AgentExecutor {
  private readonly maxIterations = 20;

  /** 回执等待者（协议交互已改无状态回合，仅保留接口兼容旧 answer 端点） */
  private answerWaiters: Array<() => void> = [];

  /** phase 状态机当前阶段（Plan#36 R2-5，仅变化时推送避免刷屏） */
  private currentPhase: AgentPhase | null = null;

  /** 协议交互暂停标记（R2 返工）：非空时本轮在回执 tool 消息后直接收尾，
   * 用户回执作为新一轮消息回流（无状态回合，不再挂起等待——根治断连后确认无响应） */
  private pauseAfter: string | null = null;

  /** phase 变更时返回事件，未变化返回 null */
  private phaseEvent(phase: AgentPhase, label?: string): AgentEvent | null {
    if (this.currentPhase === phase) return null;
    this.currentPhase = phase;
    return { type: 'agent:phase', data: { phase, label }, timestamp: Date.now() };
  }

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
  resumeWithAnswer(_answer: string): boolean {
    // R2 返工：协议交互已改无状态回合（回执走新一轮消息），挂起恢复不再使用
    const waiters = this.answerWaiters;
    this.answerWaiters = [];
    waiters.forEach((resolve) => resolve());
    return true;
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

  /**
   * 调用 LLM 并流式消费（Plan#36 P0-1 增量渲染）。
   *
   * 优先使用 LlmService.chatStream()（若实现）：LLM 文本/思考逐块产生时，
   * 本生成器将其转为 agent:message_delta / agent:thinking_delta 事件逐块 yield，
   * 最后 return 完整 LlmMessage（含 tool_calls，供主循环工具分发）。
   * 未实现 chatStream 时回退到 chat()（一次返回，不产生增量事件，兼容旧渠道）。
   */
  private async *consumeLlm(
    messages: ChatMessage[],
    llmTools: NonNullable<Parameters<LlmService['chat']>[0]['tools']>,
  ): AsyncGenerator<AgentEvent, LlmMessage, unknown> {
    const chatParams = {
      messages,
      tools: llmTools.length > 0 ? llmTools : undefined,
    };

    if (!this.llmService.chatStream) {
      const response = await this.llmService.chat(chatParams);
      return response.message as LlmMessage;
    }

    // 增量缓冲：LLM 回调(同步)推入，本生成器异步消费并 yield
    const queue: Array<{ kind: 'text' | 'thinking'; delta: string }> = [];
    let wake: (() => void) | null = null;
    let settled = false;
    let llmMessage: LlmMessage | null = null;
    let llmError: Error | null = null;

    const notify = () => {
      const fn = wake;
      wake = null;
      fn?.();
    };

    void this.llmService
      .chatStream({
        ...chatParams,
        onDelta: (delta) => {
          if (delta) {
            queue.push({ kind: 'text', delta });
            notify();
          }
        },
        onThinkingDelta: (delta) => {
          if (delta) {
            queue.push({ kind: 'thinking', delta });
            notify();
          }
        },
      })
      .then((response) => {
        llmMessage = response.message as LlmMessage;
        settled = true;
        notify();
      })
      .catch((err) => {
        llmError = err instanceof Error ? err : new Error(String(err));
        settled = true;
        notify();
      });

    // 消费循环：优先吐缓冲增量；缓冲空时等待回调唤醒或完成
    while (!settled || queue.length > 0) {
      while (queue.length > 0) {
        const item = queue.shift()!;
        yield {
          type: item.kind === 'thinking' ? 'agent:thinking_delta' : 'agent:message_delta',
          data: { delta: item.delta },
          timestamp: Date.now(),
        };
      }
      if (settled) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }

    if (llmError) throw llmError;
    if (!llmMessage) throw new Error('LLM 流式响应为空');
    return llmMessage;
  }

  async* execute(
    input: string,
    artifactId: string,
    userId: string,
    /** 会话历史（Plan#36 R2-1 记忆链路）：仅 user/assistant 文本轮，由上层从会话落库构建 */
    history: ChatMessage[] = [],
  ): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

    try {
      // 1. 推送初始状态（thinking phase，Plan#36 R2-5）
      yield {
        type: 'agent:step',
        data: { agentType: this.agentType, status: 'thinking', message: 'Agent 开始思考...' },
        timestamp: Date.now(),
      };
      const initialPhase = this.phaseEvent('thinking');
      if (initialPhase) yield initialPhase;

      // 构造消息列表: 系统指令 + 会话历史（含压缩摘要，治遗忘） + 当前用户输入
      const messages: ChatMessage[] = [
        { role: 'system', content: this.instructions },
        ...history,
        { role: 'user', content: input },
      ];

      // 转换工具定义为 LLM 格式（协议工具 + 实际工具）
      const llmTools = this.buildLlmTools();

      let iteration = 0;
      let finalOutput = '';

      while (iteration < this.maxIterations) {
        iteration++;

        // 2. 调用 LLM（Plan#36 P0-1: 优先流式，增量文本/思考逐块 yield，保证对话体感）
        const llmGen = this.consumeLlm(messages, llmTools);
        let llmResponse: LlmMessage | null = null;
        for (;;) {
          const { value, done } = await llmGen.next();
          if (done) {
            llmResponse = value as LlmMessage;
            break;
          }
          yield value;
        }
        const response = { message: llmResponse! };

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

            // 协议工具拦截(Plan#33 D1): 转为契约事件,不实际执行;交互卡发出即收尾（R2 无状态回合）
            if (AgentExecutor.PROTOCOL_TOOL_NAMES.has(toolName)) {
              const args = this.safeParseArgs(toolCall.function.arguments);
              switch (toolName) {
                case 'request_step': {
                  const clarifyPhase = this.phaseEvent('clarify');
                  if (clarifyPhase) yield clarifyPhase;
                  const step: StepRequestData = {
                    key: String(args.key ?? 'step'),
                    title: String(args.title ?? '步骤'),
                    description: args.description ? String(args.description) : undefined,
                    required: args.required !== undefined ? Boolean(args.required) : false,
                    prompts: Array.isArray(args.prompts) ? args.prompts.map(String) : undefined,
                    suggestions: Array.isArray(args.suggestions) ? args.suggestions : undefined,
                    noteEnabled: args.noteEnabled !== undefined ? Boolean(args.noteEnabled) : undefined,
                  };
                  yield {
                    type: 'agent:step_request',
                    data: { step },
                    timestamp: Date.now(),
                  };
                  this.pauseAfter = `[用户确认步骤 ${step.key}]`;
                  break;
                }
                case 'request_question': {
                  const clarifyPhase = this.phaseEvent('clarify');
                  if (clarifyPhase) yield clarifyPhase;
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
                  this.pauseAfter = '[用户选择]';
                  break;
                }
                case 'request_params': {
                  // R3 F1: 节点参数契约表单 → ParamsBlock，阻塞等待用户提交回执
                  const paramsClarifyPhase = this.phaseEvent('clarify');
                  if (paramsClarifyPhase) yield paramsClarifyPhase;
                  const params: ParamsRequestData = {
                    nodeType: String(args.nodeType ?? 'text'),
                    title: args.title ? String(args.title) : undefined,
                    fields: Array.isArray(args.fields) ? args.fields : undefined,
                    presets: Array.isArray(args.presets) ? args.presets : undefined,
                    noteLabel: args.noteLabel ? String(args.noteLabel) : undefined,
                  };
                  yield {
                    type: 'agent:params_request',
                    data: { params },
                    timestamp: Date.now(),
                  };
                  this.pauseAfter = '[用户提交参数表单]';
                  break;
                }
                case 'emit_md': {
                  const md = String(args.content ?? '');
                  yield { type: 'agent:md', data: { md }, timestamp: Date.now() };
                  break;
                }
                case 'todo_write': {
                  // P0-3: 任务清单快照以 tool_call 事件下发给前端(前端剥离为任务卡),不暂停
                  yield {
                    type: 'agent:tool_call',
                    data: {
                      toolCallId: toolCall.id,
                      toolName: 'todo_write',
                      arguments: toolCall.function.arguments,
                    },
                    timestamp: Date.now(),
                  };
                  break;
                }
                case 'plan_present': {
                  // R2-5: 结构化执行计划 → PlanBlock，阻塞等待用户确认/修改后继续
                  const planningPhase = this.phaseEvent('planning');
                  if (planningPhase) yield planningPhase;
                  const plan: PlanData = {
                    goal: String(args.goal ?? '执行计划'),
                    steps: Array.isArray(args.steps)
                      ? args.steps
                          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
                          .map((s, i) => ({
                            id: String(s.id ?? `step_${i}`),
                            label: String(s.label ?? ''),
                            deliverable: s.deliverable ? String(s.deliverable) : undefined,
                            risk: s.risk ? String(s.risk) : undefined,
                          }))
                      : [],
                    risks: Array.isArray(args.risks) ? args.risks.map(String) : undefined,
                  };
                  yield { type: 'agent:plan', data: { plan }, timestamp: Date.now() };
                  this.pauseAfter = '[用户对执行计划的回执]';
                  break;
                }
                case 'request_upload': {
                  // R2-5: 对话内上传卡 → UploadBlock，阻塞等待上传回执
                  const uploadClarifyPhase = this.phaseEvent('clarify');
                  if (uploadClarifyPhase) yield uploadClarifyPhase;
                  const upload: UploadRequestData = {
                    guideText: args.guideText ? String(args.guideText) : undefined,
                    accept: args.accept ? String(args.accept) : undefined,
                    multiple: args.multiple !== undefined ? Boolean(args.multiple) : false,
                  };
                  yield { type: 'agent:upload_request', data: { upload }, timestamp: Date.now() };
                  this.pauseAfter = '[用户上传文件]';
                  break;
                }
                case 'emit_brief': {
                  // R2-5: 任务简报 → BriefBlock，不暂停
                  const briefReportPhase = this.phaseEvent('reporting');
                  if (briefReportPhase) yield briefReportPhase;
                  const brief: BriefData = {
                    summary: String(args.summary ?? ''),
                    nodeRefs: Array.isArray(args.nodeRefs)
                      ? args.nodeRefs
                          .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
                          .map((r) => ({ nodeId: String(r.nodeId ?? ''), label: String(r.label ?? '') }))
                          .filter((r) => r.nodeId)
                      : undefined,
                    note: args.note ? String(args.note) : undefined,
                  };
                  yield { type: 'agent:brief', data: { brief }, timestamp: Date.now() };
                  break;
                }
                case 'research_note': {
                  // R2-5: 调研结论写入执行时间线（tool_call 形态，前端语义映射展示），不暂停
                  yield {
                    type: 'agent:tool_call',
                    data: {
                      toolCallId: toolCall.id,
                      toolName: 'research_note',
                      arguments: toolCall.function.arguments,
                    },
                    timestamp: Date.now(),
                  };
                  break;
                }
              }
              // 回执 tool 消息: 保证 assistant.tool_calls 有对应 tool 响应(严格校验渠道必需)
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: '协议事件已发送给用户，等待其在新回合回执',
              });
              // R2 返工：协议交互改为无状态回合——交互卡发出即收尾，
              // 用户回执作为新一轮消息回流（历史注入衔接上下文），不再挂起等待
              if (this.pauseAfter) {
                yield {
                  type: 'agent:complete',
                  data: {
                    agentType: this.agentType,
                    output: '',
                    pause: this.pauseAfter,
                    iterations: iteration,
                    durationMs: Date.now() - startTime,
                  },
                  timestamp: Date.now(),
                };
                return;
              }
              continue;
            }

            // 真实工具执行前切换 executing phase（R2-5）
            const executingPhase = this.phaseEvent('executing');
            if (executingPhase) yield executingPhase;

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

          // R2-5: 交付阶段（无 emit_brief 时也保证收尾面板态）
          const reportPhase = this.phaseEvent('reporting');
          if (reportPhase) yield reportPhase;

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
