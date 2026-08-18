/**
 * agent-llm.service - Agent LLM 服务
 *
 * 复用 ApiProvidersService 获取默认 AI 渠道配置和解密的 API Key，
 * 通过 OpenAI 兼容的聊天补全 API 调用 LLM，实现 AgentExecutor 的 LlmService 接口。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmService } from './agent-executor';

@Injectable()
export class AgentLlmService implements LlmService {
  private readonly logger = new Logger(AgentLlmService.name);

  constructor(
    private readonly providersService: ApiProvidersService,
    private readonly prisma: PrismaService,
  ) {}

  async chat(params: {
    messages: Array<{ role: string; content: string }>;
    tools?: Array<{
      type: string;
      function: { name: string; description: string; parameters: Record<string, unknown> };
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
  }> {
    const provider = await this.providersService.getDefaultRaw('ai')
      ?? await this.prisma.apiProvider.findFirst({
        where: { type: 'ai', enabled: true },
        orderBy: { createdAt: 'asc' },
      });
    if (!provider) {
      throw new Error('未配置可用的 AI 渠道，请在 API 设置中添加 AI 渠道');
    }

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
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: cfg.agentTemperature ?? 0.7,
      max_tokens: cfg.agentMaxTokens ?? 4096,
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
    const timeout = setTimeout(() => controller.abort(), 60000);

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
}
