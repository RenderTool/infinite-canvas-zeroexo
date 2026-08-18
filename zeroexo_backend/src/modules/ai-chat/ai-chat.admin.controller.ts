import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AppException, badRequest } from '../../common/errors/app-exception.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { buildApiUrl } from '../api-providers/adapters/build-api-url';
import { decrypt } from '../../common/crypto/crypto-aes.util';
import { ConfigService } from '@nestjs/config';
import { UsageTrackerService } from '../api-providers/usage/usage-tracker.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '@prisma/client';

/**
 * LLM 对话测试端点
 *
 * POST /admin/ai/chat
 * 接收 providerId 和 messages, 调用对应 AI 渠道的 chat/completions 端点,
 * 返回 LLM 响应内容。
 *
 * 支持深度思考模式(thinkingMode):
 * - 开启时向 API 下发 reasoning_effort 参数
 * - 解析响应中的 reasoning / reasoning_content 字段
 * - 自动提取 content 中的 ​原因 标签内容到 thinkingContent
 *
 * 仅支持 OpenAI 兼容格式的 API (openai/bailian/siliconflow/volcengine/custom)。
 * Anthropic 和 Gemini 格式暂不支持。
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/ai')
export class AiChatAdminController {
  private readonly encryptionKey: string;
  private readonly logger = new Logger(AiChatAdminController.name);

  constructor(
    private readonly apiProvidersService: ApiProvidersService,
    private readonly config: ConfigService,
    private readonly usageTracker: UsageTrackerService,
    private readonly prisma: PrismaService,
  ) {
    this.encryptionKey = this.config.get<string>('ai.encryptionKey')!;
  }

  @Post('chat')
  async chat(
    @CurrentUser() user: User,
    @Body()
    body: {
      providerId: string;
      messages: Array<{ role: string; content: string }>;
      model?: string;
      thinkingMode?: boolean;
    },
  ) {
    const { providerId, messages, model, thinkingMode } = body;

    if (!providerId) {
      throw badRequest('BAD_REQUEST', 'providerId is required');
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw badRequest('BAD_REQUEST', 'messages must not be empty');
    }

    // 获取 Provider 原始记录(含密文 credentials)
    const provider = await this.apiProvidersService.getRawById(providerId);

    if (!provider.enabled) {
      throw badRequest('CHANNEL_UNAVAILABLE', 'this channel is disabled');
    }

    if (provider.type !== 'ai') {
      throw badRequest('BAD_REQUEST', 'this channel is not an AI channel');
    }

    // 解密 API Key
    const creds = (provider.credentials as Record<string, any>) || {};
    let apiKey = '';
    if (creds.apiKey && typeof creds.apiKey === 'string') {
      try {
        apiKey = decrypt(creds.apiKey, this.encryptionKey);
      } catch {
        throw new AppException(500, ErrorCode.CHANNEL_KEY_DECRYPT_FAILED, 'Failed to decrypt API Key');
      }
    }

    if (!apiKey) {
      throw badRequest('CHANNEL_KEY_MISSING', 'this channel has no API Key configured');
    }

    // 解析 baseUrl 和 API 格式
    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = (cfg.baseUrl as string) || '';
    const apiFormat = (cfg.apiFormat as string) || 'openai';

    // 仅支持 OpenAI 兼容格式
    if (apiFormat !== 'openai') {
      throw badRequest('BAD_REQUEST', `Unsupported API format: ${apiFormat}, only OpenAI-compatible format is supported`);
    }

    // 运行时自动检测并补全版本路径(/v1 等)，避免用户 baseUrl 不带版本路径时 404
    const url = `${buildApiUrl(baseUrl, provider.provider)}/chat/completions`;

    // 选择模型: 优先使用请求中指定的, 其次是 provider 的默认模型, 最后回退
    const selectedModel =
      model ||
      (cfg.defaultModel as string) ||
      '';

    if (!selectedModel) {
      throw badRequest('BAD_REQUEST', 'No model specified, pass model in the request or set a default model in the channel config');
    }

    // 构造请求 body
    const requestBody: Record<string, any> = {
      model: selectedModel,
      messages,
      stream: false,
    };

    // 深度思考模式: 添加 reasoning_effort 参数
    if (thinkingMode) {
      requestBody.reasoning_effort = 'medium';
    }

    // 发起 API 请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new AppException(
        500,
        ErrorCode.AI_LLM_CALL_FAILED,
        `LLM call failed (${response.status}): ${errorText.slice(0, 500)}`,
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          reasoning?: string;
          reasoning_content?: string;
        };
      }>;
      error?: { message?: string };
    };

    if (json.error) {
      throw new AppException(500, ErrorCode.AI_LLM_CALL_FAILED, `LLM returned an error: ${json.error.message}`);
    }

    // 解析 usage 并记录用量
    const usage = (json as any)?.usage as { total_tokens?: number } | undefined;
    this.logger.debug(`AI 响应 usage 数据: providerId=${providerId}, model=${selectedModel}, usage=${JSON.stringify(usage)}`);
    if (usage?.total_tokens != null && usage.total_tokens > 0) {
      this.usageTracker.record(providerId, 'tokens', usage.total_tokens, 'day').catch((err) => {
        this.logger.warn(`记录 token 用量失败: ${err.message}`);
      });
    } else {
      this.logger.warn(`AI 响应缺少有效 usage 数据: providerId=${providerId}, model=${selectedModel}, raw usage=${JSON.stringify((json as any)?.usage)}`);
    }

    // 提取主要内容和思考内容
    const message = json.choices?.[0]?.message;
    let content = message?.content || '';
    let thinkingContent = '';

    // 深度思考模式: 从多个来源提取思考内容
    if (thinkingMode) {
      // 1. OpenAI o-series: choices[0].message.reasoning
      thinkingContent = message?.reasoning || '';
      // 2. DeepSeek R1: choices[0].message.reasoning_content
      if (!thinkingContent) {
        thinkingContent = message?.reasoning_content || '';
      }
      // 3. 部分中转 API 将思考内容嵌入 content 中的 原因 标签
      if (!thinkingContent && content) {
        const thinkMatch = content.match(/​原因([\s\S]*?)​\/原因/);
        if (thinkMatch) {
          thinkingContent = thinkMatch[1].trim();
          content = content.replace(/​原因[\s\S]*?​\/原因\s*/g, '').trim();
        }
      }
    }

    if (!content) {
      throw new AppException(500, ErrorCode.AI_GENERATION_FAILED, 'AI returned an empty response');
    }

    // 标记使用
    await this.apiProvidersService.markUsed(providerId);

    // 记录模型级调用记录，供运营分析「模型使用排行」统计（AI 测试调用同样计入）
    try {
      const totalTokens = usage?.total_tokens ?? 0;
      await this.prisma.aiGeneration.create({
        data: {
          ownerId: user.id,
          providerId,
          providerName: provider.name,
          model: selectedModel,
          kind: 'text',
          prompt: (messages[messages.length - 1]?.content || '').slice(0, 1000),
          params: { _isTest: true },
          status: 'success',
          costTokens: totalTokens,
        },
      });
    } catch (err) {
      this.logger.warn(`记录 AI 测试调用失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { content, thinkingContent };
  }
}
