/**
 * memory-compactor.service - Agent 会话记忆压缩
 *
 * 会话消息超过 token 预算时，将历史折叠为一条 LLM 摘要：
 * - 预算: TOKEN_BUDGET（按字符数/CHAR_PER_TOKEN 估算，中文场景 ≈4 字符/token）
 * - 触发阈值: 达到预算 80%
 * - 压缩策略: 保留最近 KEEP_RECENT 条消息，其余折叠为 role=system 的摘要消息
 * - 摘要保留: 任务进度 / 画布上下文 / 用户偏好 / 已确认决策
 * - LLM 失败时回退到截断摘要（仅保留 user/system 关键行），保证压缩不中断
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AgentLlmService } from './agent-llm.service';

/** 会话 token 预算 */
const TOKEN_BUDGET = 4000;
/** 压缩时保留的最近消息条数 */
const KEEP_RECENT = 10;
/** 中文场景字符/token 估算 */
const CHAR_PER_TOKEN = 4;
/** 达到预算比例时触发压缩 */
const COMPACT_TRIGGER_RATIO = 0.8;

@Injectable()
export class MemoryCompactorService {
  private readonly logger = new Logger(MemoryCompactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: AgentLlmService,
  ) {}

  /** 估算 token 数 */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHAR_PER_TOKEN);
  }

  /**
   * 对会话执行记忆压缩（超过预算时）
   * @returns 是否执行了压缩
   */
  async compactConversation(conversationId: string): Promise<boolean> {
    const messages = await this.prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    if (messages.length === 0) return false;

    const totalTokens = messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
    if (totalTokens < TOKEN_BUDGET * COMPACT_TRIGGER_RATIO) return false;

    // 折叠对象：除最近 KEEP_RECENT 条外的历史（摘要消息本身不参与折叠）
    const foldTargets = messages.slice(0, Math.max(0, messages.length - KEEP_RECENT));
    if (foldTargets.length === 0) return false;

    const transcript = foldTargets
      .map((m) => `${m.role}${m.toolName ? `(${m.toolName})` : ''}: ${m.content.slice(0, 800)}`)
      .join('\n');

    let summary = '';
    try {
      summary = await this.summarize(transcript);
    } catch (err) {
      this.logger.warn(`LLM 摘要失败，改用截断摘要: ${(err as Error).message}`);
      summary = this.truncateSummary(transcript);
    }

    // 写入压缩摘要（toolName=memory_compact 标记，前端可识别）
    await this.prisma.agentMessage.create({
      data: {
        conversationId,
        role: 'system',
        content: `【历史记忆摘要】\n${summary}`,
        toolName: 'memory_compact',
      },
    });

    // 删除被折叠的旧消息
    await this.prisma.agentMessage.deleteMany({
      where: { conversationId, id: { in: foldTargets.map((m) => m.id) } },
    });

    this.logger.log(`会话记忆已压缩: ${conversationId}, 折叠 ${foldTargets.length} 条 → 1 条摘要`);
    return true;
  }

  /** 调用 LLM 生成对话摘要 */
  private async summarize(transcript: string): Promise<string> {
    const res = await this.llm.chat({
      messages: [
        {
          role: 'system',
          content:
            '你是会话记忆压缩器。请将以下 Agent 对话历史压缩为结构化摘要，必须保留：' +
            '1) 用户需求与已确认决策；2) 任务进度与产物状态；3) 画布/资源上下文；4) 用户偏好。' +
            '使用简洁要点格式，丢弃寒暄与重复内容，总长度不超过 500 字。',
        },
        { role: 'user', content: transcript },
      ],
    });
    return res.message.content ?? '';
  }

  /** 无 LLM 时的兜底摘要：仅保留 user 与 system 关键行 */
  private truncateSummary(transcript: string): string {
    const lines = transcript.split('\n').filter(Boolean);
    const kept = lines.filter((l) => /^(user|system)/.test(l)).slice(-15);
    return kept.join('\n') || transcript.slice(0, 500);
  }
}
