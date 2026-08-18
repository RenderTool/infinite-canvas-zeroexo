import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiProvidersService } from '../api-providers/api-providers.service';
import { buildApiUrl } from '../api-providers/adapters/build-api-url';
import { getDefaultBaseUrl } from './ai-generate.utils';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app-exception';
import {
  SplitEpisode,
  parseEpisodesFromJson,
  splitScriptIntoChunks,
} from './ai-generate.think-chunker';

/**
 * 已解析的思考渠道上下文
 */
export interface ThinkContext {
  provider: any;
  apiKey: string;
  baseUrl: string;
  /** 渠道 chat/completions 完整地址 */
  url: string;
}

/**
 * AI 思考执行器服务
 *
 * 封装 processThinkTask / streamThink / think 三处重复的共享编排逻辑：
 * - resolveContext：渠道获取 + API Key 解密 + baseUrl 回退（错误消息与原先一致）
 * - chatJsonCompletion：非流式 chat/completions 调用
 * - runScriptSplitChunked：长剧本分批拆分（跨 chunk 上下文记忆 + 全局重编号）
 *
 * 供 AiThinkTaskService / AiThinkStreamService 共享，消除重复实现。
 */
@Injectable()
export class AiThinkExecutorService {
  private readonly logger = new Logger(AiThinkExecutorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly providersService: ApiProvidersService,
  ) {}

  /**
   * 解析渠道上下文：获取渠道 → 校验 → 解密 API Key → baseUrl 回退。
   * 失败时抛出 Error，message 与原各方法内部逻辑保持一致。
   */
  async resolveContext(providerId: string): Promise<ThinkContext> {
    let provider: any;
    try {
      provider = await this.providersService.getRawById(providerId);
    } catch {
      throw new AppException(404, ErrorCode.CHANNEL_NOT_FOUND, 'AI channel not found');
    }
    if (!provider || provider.type !== 'ai' || !provider.enabled) {
      throw new AppException(400, ErrorCode.CHANNEL_UNAVAILABLE, 'AI channel is unavailable');
    }

    const creds = (provider.credentials as Record<string, any>) || {};
    let apiKey = '';
    if (creds.apiKey && typeof creds.apiKey === 'string') {
      try {
        const { decrypt } = await import('../../common/crypto/crypto-aes.util');
        const encryptionKey = this.config.get<string>('ai.encryptionKey')!;
        apiKey = decrypt(creds.apiKey, encryptionKey);
      } catch {
        throw new AppException(400, ErrorCode.CHANNEL_KEY_DECRYPT_FAILED, 'Failed to decrypt API Key');
      }
    }
    if (!apiKey) {
      throw new AppException(400, ErrorCode.CHANNEL_KEY_MISSING, 'AI channel has no API Key configured');
    }

    const cfg = (provider.config as Record<string, any>) || {};
    const baseUrl = (cfg.baseUrl as string) || getDefaultBaseUrl(this.config, provider.provider);
    if (!baseUrl) {
      throw new AppException(400, ErrorCode.CHANNEL_BASE_URL_MISSING, `Channel "${provider.name}" has no API base URL configured`);
    }

    return {
      provider,
      apiKey,
      baseUrl,
      url: `${buildApiUrl(baseUrl, provider.provider)}/chat/completions`,
    };
  }

  /**
   * 非流式 chat/completions 调用，返回 choices[0].message.content。
   * 失败抛出 Error（消息格式与原先一致）。
   */
  async chatJsonCompletion(opts: {
    url: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    userMessage: string;
    maxTokens: number;
    timeoutMs: number;
  }): Promise<string> {
    const response = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userMessage },
        ],
        stream: false,
        max_tokens: opts.maxTokens,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppException(502, ErrorCode.AI_LLM_CONNECTION_FAILED, `Failed to connect to LLM: ${msg.slice(0, 200)}`);
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new AppException(502, ErrorCode.AI_LLM_CALL_FAILED, `LLM call failed (${response.status}): ${errText.slice(0, 200)}`);
    }

    const respJson = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return respJson?.choices?.[0]?.message?.content || '';
  }

  /**
   * 剧本导入分批拆分:将长剧本按 chunk 分批调 LLM,跨 chunk 携带已拆集标题做上下文记忆,
   * 汇总所有 chunk 的集并全局重编号。单 chunk 失败自动重试 2 次。
   *
   * @deprecated 请使用 POST /api/scripts/format-chapters 端点替代。
   * 此方法将在下个主版本中移除。
   */
  async runScriptSplitChunked(opts: {
    url: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    content: string;
    episodeMode: 'auto' | 'manual' | 'none';
    episodeCount: number;
    chunkSize: number;
    onProgress?: (done: number, total: number) => void;
  }): Promise<SplitEpisode[]> {
    const chunks = splitScriptIntoChunks(opts.content, opts.chunkSize);
    const total = chunks.length;
    const allEpisodes: SplitEpisode[] = [];
    const timeoutMs = this.config.get<number>('ai.requestTimeoutMs') ?? 120000;

    const modeHint = opts.episodeMode === 'auto'
      ? '请根据内容量自动判断合适的集数'
      : opts.episodeMode === 'manual'
        ? `用户期望拆分 ${opts.episodeCount} 集（请以内容量合理判断，如果内容不足以拆分到 ${opts.episodeCount} 集，按实际内容量合理拆分）`
        : '请合并为单集';

    /** 单 chunk 调用 LLM(非流式),失败自动重试 2 次 */
    const callChunk = async (chunkIndex: number, chunk: string, priorTitles: string): Promise<string> => {
      const userMsg = [
        `## 原始剧本内容（第 ${chunkIndex + 1}/${total} 段）`,
        '',
        chunk,
        priorTitles ? `\n## 前序已拆集的标题（用于衔接，勿重复）\n\n${priorTitles}` : '',
        '',
        '## 分集要求',
        '',
        modeHint,
        '',
        `请只针对本段内容拆分集，集号从 ${allEpisodes.length + 1} 开始连续编号。`,
        '输出严格为一行 JSON：{"episodes":[{"number":N,"title":"第N集","content":"..."}]}',
        '重要:content 字段中的换行必须使用 \\n 转义序列，不得使用实际换行符，确保整行 JSON 合法。',
      ].join('\n');

      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(opts.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${opts.apiKey}`,
            },
            body: JSON.stringify({
              model: opts.model,
              messages: [
                { role: 'system', content: opts.systemPrompt },
                { role: 'user', content: userMsg },
              ],
              stream: false,
              max_tokens: 65536,
              temperature: 0.7,
            }),
            signal: AbortSignal.timeout(timeoutMs),
          }).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            throw new AppException(502, ErrorCode.AI_LLM_CONNECTION_FAILED, `Failed to connect to LLM: ${msg.slice(0, 200)}`);
          });
          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new AppException(502, ErrorCode.AI_LLM_CALL_FAILED, `LLM call failed (${response.status}): ${errText.slice(0, 200)}`);
          }
          const respJson = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          return respJson?.choices?.[0]?.message?.content || '';
        } catch (err) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          if (attempt < 2) {
            this.logger.warn(`剧本拆分 chunk ${chunkIndex + 1}/${total} 第 ${attempt + 1} 次失败，重试: ${lastErr.message}`);
          }
        }
      }
      throw lastErr ?? new Error('剧本拆分 chunk 调用失败');
    };

    for (let i = 0; i < total; i++) {
      const priorTitles = allEpisodes.map((ep) => ep.title).join('、');
      const raw = await callChunk(i, chunks[i]!, priorTitles);
      const parsed = parseEpisodesFromJson(raw);
      if (parsed.length === 0) {
        this.logger.warn(`剧本拆分 chunk ${i + 1}/${total} 未解析出剧集，跳过该段`);
      }
      // 全局重编号,确保集号连续
      for (const ep of parsed) {
        allEpisodes.push({
          ...ep,
          number: allEpisodes.length + 1,
        });
      }
      opts.onProgress?.(i + 1, total);
    }
    return allEpisodes;
  }
}