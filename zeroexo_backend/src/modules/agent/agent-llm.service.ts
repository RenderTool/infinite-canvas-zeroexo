/**
 * agent-llm.service - Agent LLM 服务
 *
 * 复用 ApiProvidersService 获取默认 AI 渠道配置和解密的 API Key，
 * 通过 OpenAI 兼容的聊天补全 API 调用 LLM，实现 AgentExecutor 的 LlmService 接口。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChatMessage, LlmService } from './agent-executor';

@Injectable()
export class AgentLlmService implements LlmService {
  private readonly logger = new Logger(AgentLlmService.name);

  constructor(
    private readonly providersService: ApiProvidersService,
    private readonly prisma: PrismaService,
  ) {}

  async chat(params: {
    messages: ChatMessage[];
    tools?: Array<{
      type: string;
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>;
    thinking?: 'enabled' | 'disabled';
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
  }> {
    return this.requestLlm({ ...params, stream: false });
  }

  /**
   * 流式聊天（Plan#36 P0-1 增量渲染）。
   * OpenAI 兼容 stream 模式：逐块解析 SSE，正文/思考增量实时回调，最终返回完整消息（含 tool_calls）。
   */
  async chatStream(params: {
    messages: ChatMessage[];
    tools?: Array<{
      type: string;
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>;
    thinking?: 'enabled' | 'disabled';
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
  }> {
    const provider = await this.resolveProvider();
    const apiKey = await this.providersService.getDecryptedApiKey(provider.id);
    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = cfg.baseUrl ?? 'https://api.openai.com/v1';
    const apiFormat = (cfg.apiFormat as string) ?? 'openai';

    if (apiFormat !== 'openai') {
      return this.requestLlm({ ...params, stream: false });
    }

    const enabledModels = Array.isArray(cfg.enabledModels) ? cfg.enabledModels : [];
    const model = cfg.agentModel ?? cfg.defaultModel ?? enabledModels[0];
    if (!model) {
      throw new Error(
        `AI 渠道「${provider.name}」未配置模型，请在 API 设置中为该渠道添加可用模型`,
      );
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const body: Record<string, any> = {
      model,
      stream: true,
      messages: params.messages.map((m) => {
        const msg: Record<string, any> = { role: m.role, content: m.content };
        if (m.tool_calls && m.tool_calls.length > 0) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        return msg;
      }),
      temperature: cfg.agentTemperature ?? 0.7,
      max_tokens: cfg.agentMaxTokens ?? 8192,
      // DeepSeek 深度思考（用户拍板 2026-08-25）：由调用方按 agent 类型决定——canvas_agent 主对话 enabled（推理进 reasoning_content → 前端 ThinkTree 折叠），
      // 结构化输出子任务 disabled（reasoning_tokens 挤占 max_tokens 致 JSON 截断，Plan#20 P0）；渠道配置 agentThinking 可覆盖
      ...(provider.provider === 'deepseek'
        ? { thinking: { type: ((cfg.agentThinking as string) === 'enabled' || ((cfg.agentThinking as string) !== 'disabled' && params.thinking === 'enabled')) ? 'enabled' : 'disabled' } }
        : {}),
      ...(cfg.agentExtraBody || {}),
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: t.type,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    }

    this.logger.debug(`LLM 流式请求: ${url}, messages=${params.messages.length}, tools=${params.tools?.length ?? 0}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.agentTimeoutMs ?? 120000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`LLM API 错误 [${response.status}]: ${errText.slice(0, 500)}`);
      }

      // 组装最终消息：content 逐块累积，tool_calls 按 index 合并（流式分片）
      let role = 'assistant';
      let content = '';
      // Plan#43 B3: <thinking> 标记分流状态(思考归思考通道,正文归正文通道,标签不输出)
      const thinkState = { inThinking: false, buf: '' };
      const toolCallsMap = new Map<number, {
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>();

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取 LLM 流式响应');

      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 格式：data: {...} 每行一个事件，[DONE] 结尾
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') break;

          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta ?? {};
          if (delta.role) role = delta.role;
          if (delta.content) {
            // Plan#43 B3: <thinking> 标记内的增量归思考通道,标签外归正文;content 只累积正文(思考不进对话历史)
            this.splitThinkingChunk(
              delta.content,
              thinkState,
              (body) => { if (body) { content += body; params.onDelta?.(body); } },
              (think) => { if (think) params.onThinkingDelta?.(think); },
            );
          }
          if (delta.reasoning_content) {
            params.onThinkingDelta?.(delta.reasoning_content);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCallsMap.get(idx);
              if (!existing) {
                toolCallsMap.set(idx, {
                  id: tc.id ?? '',
                  type: tc.type ?? 'function',
                  function: { name: '', arguments: '' },
                });
              }
              const target = toolCallsMap.get(idx)!;
              if (tc.id) target.id = tc.id;
              if (tc.type) target.type = tc.type;
              if (tc.function?.name) target.function.name += tc.function.name;
              if (tc.function?.arguments) target.function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Plan#43 B3: 流结束冲刷残余缓冲(未闭合思考归思考,残缺开始标签前缀丢弃)
      this.finalizeThinkingSplit(
        thinkState,
        (body) => { if (body) { content += body; params.onDelta?.(body); } },
        (think) => { if (think) params.onThinkingDelta?.(think); },
      );

      const toolCalls = toolCallsMap.size > 0
        ? [...toolCallsMap.values()]
        : undefined;

      return {
        message: {
          role,
          content: content || null,
          tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 解析默认 AI 渠道（chat 与 chatStream 共用） */
  private async resolveProvider(): Promise<any> {
    const provider = await this.providersService.getDefaultRaw('ai')
      ?? await this.prisma.apiProvider.findFirst({
        where: { type: 'ai', enabled: true },
        orderBy: { createdAt: 'asc' },
      });
    if (!provider) {
      throw new Error('未配置可用的 AI 渠道，请在 API 设置中添加 AI 渠道');
    }
    return provider;
  }

  /** 非流式请求实现（原 chat 逻辑） */
  private async requestLlm(params: {
    messages: ChatMessage[];
    tools?: Array<{
      type: string;
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>;
    stream?: boolean;
    thinking?: 'enabled' | 'disabled';
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
  }> {
    const provider = await this.resolveProvider();

    const apiKey = await this.providersService.getDecryptedApiKey(provider.id);
    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = cfg.baseUrl ?? 'https://api.openai.com/v1';
    const apiFormat = (cfg.apiFormat as string) ?? 'openai';

    // 只支持 OpenAI 兼容格式
    if (apiFormat !== 'openai') {
      throw new Error(`Agent 框架当前仅支持 OpenAI 兼容格式，当前渠道格式: ${apiFormat}`);
    }

    // 模型优先级：agentModel → defaultModel → enabledModels[0]
    const enabledModels = Array.isArray(cfg.enabledModels) ? cfg.enabledModels : [];
    const model = cfg.agentModel ?? cfg.defaultModel ?? enabledModels[0];
    if (!model) {
      throw new Error(
        `AI 渠道「${provider.name}」未配置模型，请在 API 设置中为该渠道添加可用模型`,
      );
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const body: Record<string, any> = {
      model,
      // 透传 tool_calls / tool_call_id(OpenAI 兼容规范: tool 消息必须携带 tool_call_id)
      messages: params.messages.map((m) => {
        const msg: Record<string, any> = { role: m.role, content: m.content };
        if (m.tool_calls && m.tool_calls.length > 0) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        return msg;
      }),
      temperature: cfg.agentTemperature ?? 0.7,
      // 分镜等结构化长输出需更大上限,默认 8192 防止 JSON 被截断
      max_tokens: cfg.agentMaxTokens ?? 8192,
      // Plan#20 P0: DeepSeek 推理模型默认关闭 thinking——reasoning_tokens 挤占 max_tokens
      // 预算导致结构化 JSON 输出被截断;2026-08-25 用户拍板改为按调用方传入（canvas_agent 主对话 enabled，见 chatStream）;
      // 渠道级配置会被重置丢失,故沉淀为代码级默认;渠道配置 agentThinking 可覆盖
      ...(provider.provider === 'deepseek'
        ? { thinking: { type: ((cfg.agentThinking as string) === 'enabled' || ((cfg.agentThinking as string) !== 'disabled' && params.thinking === 'enabled')) ? 'enabled' : 'disabled' } }
        : {}),
      // 渠道可选附加参数(优先级最高,可覆盖上方默认)
      ...(cfg.agentExtraBody || {}),
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: t.type,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    }

    this.logger.debug(`LLM 请求: ${url}, messages=${params.messages.length}, tools=${params.tools?.length ?? 0}`);

    const controller = new AbortController();
    // 长 prompt + 推理模型 + 结构化长输出,超时放宽到 120s
    const timeout = setTimeout(() => controller.abort(), cfg.agentTimeoutMs ?? 120000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`LLM API 错误 [${response.status}]: ${errText.slice(0, 500)}`);
      }

      const data = (await response.json()) as any;
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error('LLM 响应无 choices');
      }

      const message = choice.message;
      if (!message) {
        throw new Error('LLM 响应 message 为空');
      }

      return {
        message: {
          role: message.role ?? 'assistant',
          content: message.content ?? null,
          tool_calls: message.tool_calls?.map((tc: any) => ({
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * <thinking> 标记分流（Plan#43 B3）：把 content chunk 按 <thinking>...</thinking> 拆分。
   * 标记内 → emitThink（思考通道）；标记外 → emitBody（正文通道）；标签本身不输出。
   * 跨 chunk 的半截标签保留在 state.buf，等下一个 chunk 拼齐再判定。
   */
  private splitThinkingChunk(
    chunk: string,
    state: { inThinking: boolean; buf: string },
    emitBody: (s: string) => void,
    emitThink: (s: string) => void,
  ): void {
    const OPEN = '<thinking>';
    const CLOSE = '</thinking>';
    state.buf += chunk;
    for (;;) {
      if (state.inThinking) {
        const idx = state.buf.indexOf(CLOSE);
        if (idx >= 0) {
          if (idx > 0) emitThink(state.buf.slice(0, idx));
          state.buf = state.buf.slice(idx + CLOSE.length);
          state.inThinking = false;
          continue;
        }
        // 未闭合：末尾可能是被截断的闭合标签，保留至多 CLOSE.length-1 字符
        const keep = Math.min(state.buf.length, CLOSE.length - 1);
        const safeEnd = state.buf.length - keep;
        if (safeEnd > 0) emitThink(state.buf.slice(0, safeEnd));
        state.buf = state.buf.slice(safeEnd);
        return;
      }
      const idx = state.buf.indexOf(OPEN);
      if (idx >= 0) {
        if (idx > 0) emitBody(state.buf.slice(0, idx));
        state.buf = state.buf.slice(idx + OPEN.length);
        state.inThinking = true;
        continue;
      }
      // 未开始：末尾可能是被截断的开始标签，保留至多 OPEN.length-1 字符
      const keep = Math.min(state.buf.length, OPEN.length - 1);
      const safeEnd = state.buf.length - keep;
      if (safeEnd > 0) emitBody(state.buf.slice(0, safeEnd));
      state.buf = state.buf.slice(safeEnd);
      return;
    }
  }

  /** 流结束冲刷：未闭合思考整体归思考；残余是 <thinking> 残缺前缀则丢弃，否则归正文 */
  private finalizeThinkingSplit(
    state: { inThinking: boolean; buf: string },
    emitBody: (s: string) => void,
    emitThink: (s: string) => void,
  ): void {
    if (state.buf.length === 0) return;
    if (state.inThinking) {
      emitThink(state.buf);
    } else if (!'<thinking>'.startsWith(state.buf)) {
      emitBody(state.buf);
    }
    state.buf = '';
  }
}
