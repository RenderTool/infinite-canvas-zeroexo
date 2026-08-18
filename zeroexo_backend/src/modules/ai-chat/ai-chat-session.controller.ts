import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { badRequest, notFound } from '../../common/errors/app-exception.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { buildApiUrl } from '../api-providers/adapters/build-api-url';
import { decrypt } from '../../common/crypto/crypto-aes.util';
import type { User } from '@prisma/client';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/ai/chat')
export class AiChatSessionController {
  private readonly logger = new Logger(AiChatSessionController.name);
  private readonly encryptionKey: string;

  /** 每个 session 最多保留的消息条数，超出则截断保留最近的 N 条 */
  private readonly MAX_MESSAGES_PER_SESSION = 200;

  /** 超过此条数触发自动摘要（必须小于 MAX_MESSAGES_PER_SESSION） */
  private readonly SUMMARIZE_THRESHOLD = 100;

  /** 每条消息内容最大长度 */
  private readonly MAX_DISCUSSION_LENGTH = 2000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiProvidersService: ApiProvidersService,
    private readonly config: ConfigService,
  ) {
    this.encryptionKey = this.config.get<string>('ai.encryptionKey')!;
  }

  /** 获取当前用户的会话列表 */
  @Get('sessions')
  async getSessions(@CurrentUser() user: User) {
    const sessions = await this.prisma.aiChatSession.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return { sessions };
  }

  /** 获取指定会话的全部消息 */
  @Get('sessions/:id/messages')
  async getMessages(@Param('id') id: string, @CurrentUser() user: User) {
    const session = await this.prisma.aiChatSession.findUnique({
      where: { id },
    });
    if (!session || session.userId !== user.id) {
      throw notFound('NOT_FOUND', 'session not found');
    }
    const messages = await this.prisma.aiChatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });

    // 如果有摘要，在消息列表最前面注入一条 system 消息
    if (session.summary) {
      messages.unshift({
        id: '__summary__',
        sessionId: id,
        role: 'system',
        content: `[早期对话摘要]\n${session.summary}`,
        thinkingContent: null,
        createdAt: session.createdAt,
      } as any);
    }

    return { session, messages };
  }

  /** 同步消息到后端（创建/更新 session + 批量写入 messages） */
  @Post('sync')
  async sync(
    @CurrentUser() user: User,
    @Body()
    body: {
      providerId: string;
      model: string;
      messages: Array<{
        role: string;
        content: string;
        thinkingContent?: string;
      }>;
    },
  ) {
    const { providerId, model, messages } = body;
    this.logger.log(`同步聊天记录: userId=${user.id}, providerId=${providerId}, model=${model}, messagesCount=${messages?.length}`);

    if (!providerId || !model || !messages || messages.length === 0) {
      throw badRequest('BAD_REQUEST', 'incomplete parameters');
    }

    // 验证每条消息内容长度
    for (const msg of messages) {
      if (msg.content && msg.content.length > this.MAX_DISCUSSION_LENGTH) {
        throw badRequest('BAD_REQUEST', `each message content must not exceed ${this.MAX_DISCUSSION_LENGTH} characters`);
      }
    }

    // 限制消息数量，超出时截断保留最近的 N 条
    const limitedMessages = messages.length > this.MAX_MESSAGES_PER_SESSION
      ? messages.slice(messages.length - this.MAX_MESSAGES_PER_SESSION)
      : messages;
    const truncatedCount = messages.length - limitedMessages.length;
    /** 需要被摘要的早期消息（在截断且达到阈值时捕获） */
    let messagesToSummarize: typeof messages | null = null;

    if (truncatedCount > 0) {
      this.logger.warn(`会话消息超限，截断 ${truncatedCount} 条: providerId=${providerId}, model=${model}, 原始 ${messages.length} 条 → 保留 ${limitedMessages.length} 条`);
      if (truncatedCount >= this.SUMMARIZE_THRESHOLD) {
        messagesToSummarize = messages.slice(0, truncatedCount);
      }
    }

    // 使用事务确保唯一性（userId + providerId + model）
    const session = await this.prisma.$transaction(async (tx) => {
      let existing = await tx.aiChatSession.findFirst({
        where: { userId: user.id, providerId, model },
      });
      if (existing) {
        return existing;
      }
      return tx.aiChatSession.create({
        data: {
          userId: user.id,
          providerId,
          model,
          title: messages[0]?.content?.slice(0, 50) || '',
        },
      });
    });

    // 删除旧消息，写入新消息（全量替换）
    await this.prisma.$transaction(async (tx) => {
      await tx.aiChatMessage.deleteMany({
        where: { sessionId: session!.id },
      });
      await tx.aiChatMessage.createMany({
        data: limitedMessages.map((m, i) => ({
          sessionId: session!.id,
          role: m.role,
          content: m.content,
          thinkingContent: m.thinkingContent || null,
          // 每条消息使用递增时间戳，确保读取时 orderBy createdAt ASC 顺序正确
          createdAt: new Date(Date.now() + i),
        })),
      });
      await tx.aiChatSession.update({
        where: { id: session!.id },
        data: { updatedAt: new Date() },
      });
    });

    // 异步触发早期消息摘要（不阻塞响应）
    if (messagesToSummarize && messagesToSummarize.length > 0) {
      this.triggerSummarization(session.id, providerId, messagesToSummarize).catch((err) => {
        this.logger.error(`自动摘要失败: sessionId=${session!.id}, error=${err.message}`);
      });
    }

    return { sessionId: session.id };
  }

  /**
   * 异步生成早期消息摘要，并保存到 session.summary
   *
   * 使用会话对应的 AI 渠道调用 LLM 对早期消息进行压缩总结，
   * 生成的摘要将在 getMessages 中作为 system 消息注入。
   */
  private async triggerSummarization(
    sessionId: string,
    providerId: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<void> {
    // 构造摘要 prompt
    const conversationText = messages
      .map((m) => `[${m.role}]\n${m.content}`)
      .join('\n\n');
    const summarizationPrompt = `请对以下对话内容进行简洁的中文摘要（不超过200字），保留关键信息和对话脉络：\n\n${conversationText}`;

    // 获取 provider 凭证并调用 API
    const provider = await this.apiProvidersService.getRawById(providerId);
    if (!provider.enabled || provider.type !== 'ai') {
      this.logger.warn(`摘要跳过: 渠道 ${providerId} 不可用`);
      return;
    }

    const creds = (provider.credentials as Record<string, any>) || {};
    let apiKey = '';
    if (creds.apiKey && typeof creds.apiKey === 'string') {
      try {
        apiKey = decrypt(creds.apiKey, this.encryptionKey);
      } catch {
        this.logger.warn(`摘要跳过: API Key 解密失败 providerId=${providerId}`);
        return;
      }
    }
    if (!apiKey) return;

    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = (cfg.baseUrl as string) || '';
    const selectedModel = (cfg.defaultModel as string) || '';

    if (!baseUrl || !selectedModel) return;

    const url = `${buildApiUrl(baseUrl, provider.provider)}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'user', content: summarizationPrompt },
        ],
        stream: false,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`摘要 API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const summary = json.choices?.[0]?.message?.content?.trim();
    if (!summary) {
      this.logger.warn(`摘要结果为空: sessionId=${sessionId}`);
      return;
    }

    // 保存摘要到 session
    await this.prisma.aiChatSession.update({
      where: { id: sessionId },
      data: { summary },
    });

    this.logger.log(`自动摘要完成: sessionId=${sessionId}, 摘要长度=${summary.length} 字符`);
  }

  /** 删除会话（级联删除消息） */
  @Delete('sessions/:id')
  async deleteSession(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    const session = await this.prisma.aiChatSession.findUnique({
      where: { id },
    });
    if (!session || session.userId !== user.id) {
      throw notFound('NOT_FOUND', 'session not found');
    }
    await this.prisma.aiChatSession.delete({ where: { id } });
    return { success: true };
  }
}
