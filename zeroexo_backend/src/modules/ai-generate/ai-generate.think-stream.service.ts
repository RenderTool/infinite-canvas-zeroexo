import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../common/errors/error-codes';
import { AiThinkExecutorService } from './ai-generate.think-executor.service';
import { AiThinkPromptService } from './ai-generate.think-prompt.service';
import {
  extractDisplayTextFromPartial,
  extractLlmDeltaContent,
  tryParseLenientStepJson,
} from './ai-generate.think-sse-parser';

/** 流式思考事件的类型 */
export type ThinkStreamEvent = {
  type: 'step_delta' | 'step_complete' | 'done' | 'error';
  stepIndex?: number;
  text?: string;
  suggestions?: Array<{ label: string; value: string }>;
  message?: string;
  code?: string;
};

/**
 * AI 思考流式服务
 *
 * 负责「灵感 / 类型分析 / 剧本导入」三类 AI 思考的流式 SSE 输出：
 * - streamThink：调用 LLM chat/completions（stream: true），逐 chunk 解析 SSE 响应，
 *   实时 yield 步骤增量和完成事件，供前端打字机效果展示。
 *
 * 渠道解析 / 剧本分批 / LLM 调用复用 AiThinkExecutorService，
 * prompt 组装复用 AiThinkPromptService，SSE 解析复用 think-sse-parser 纯函数。
 */
@Injectable()
export class AiThinkStreamService {
  constructor(
    private readonly config: ConfigService,
    private readonly executor: AiThinkExecutorService,
    private readonly promptService: AiThinkPromptService,
  ) {}

  /**
   * 流式 AI 深度思考 — 调用 LLM chat/completions（stream: true），
   * 逐 chunk 解析 SSE 响应，实时 yield 步骤增量和完成事件。
   *
   * 用于前端打字机效果展示，与异步任务（createThinkTask）共存：
   * - 前端用此流式端点实时展示
   * - 异步任务用于历史保存和页面刷新恢复
   */
  async *streamThink(
    providerId: string,
    model: string,
    kind: 'inspire' | 'genre' | 'script_import',
    projectData: Record<string, any>,
    locale: string = 'zh',
  ): AsyncGenerator<ThinkStreamEvent> {
    // 1. 获取渠道并解密（executor 共享；错误转为 error 事件并携带 code）
    let ctx: { apiKey: string; baseUrl: string; provider: any; url: string };
    try {
      ctx = await this.executor.resolveContext(providerId);
    } catch (err) {
      const code = this.extractCode(err);
      const msg = this.extractMessage(err);
      yield { type: 'error', code, message: msg };
      return;
    }
    const { apiKey, url } = ctx;
    // baseUrl、provider 在构建 ctx.url 时已使用，此处不再需要

    // 2. 构建 prompt 和请求
    const timeoutMs = this.config.get<number>('ai.requestTimeoutMs') ?? 120000;
    const langHint = this.promptService.langInstruct(locale);

    let skillAgentType: string;
    let systemPrompt: string;
    if (kind === 'script_import') {
      skillAgentType = 'script_import';
      systemPrompt = this.promptService.buildSystemPrompt(skillAgentType, {
        langHint,
      });
    } else {
      skillAgentType = kind === 'inspire' ? 'project_setup' : 'genre_analyzer';
      systemPrompt = this.promptService.buildSystemPrompt(skillAgentType, {
        baseInfo: this.promptService.buildBaseInfo(projectData),
        langHint,
      });
    }

    // 2.5 长剧本分批拆分(stream 路径):超过 chunk 阈值时按 chunk 分批调 LLM,
    // 逐 chunk 上报进度,最后一次性返回汇总后的完整剧集 JSON。
    if (kind === 'script_import') {
      const content = (projectData.content as string) || '';
      const chunkSize = this.config.get<number>('ai.scriptChunkSize') ?? 40000;
      if (content.length > chunkSize) {
        // 先反馈"开始分批拆分",再阻塞执行各 chunk,最后一次性返回汇总剧集
        yield {
          type: 'step_complete',
          stepIndex: 1,
          text: ErrorCode.THINK_CHUNKING_PROGRESS,
          suggestions: [],
        };
        const episodes = await this.executor.runScriptSplitChunked({
          url: ctx.url,
          apiKey,
          model,
          systemPrompt,
          content,
          episodeMode: (projectData.episodeMode as 'auto' | 'manual' | 'none') || 'auto',
          episodeCount: Number(projectData.episodeCount) || 0,
          chunkSize,
        });
        yield {
          type: 'step_complete',
          stepIndex: 2,
          text: JSON.stringify({ episodes }),
          suggestions: [],
        };
        yield { type: 'done' };
        return;
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: this.promptService.buildUserMessage(kind, projectData, locale) },
          ],
          stream: true,
          max_tokens: kind === 'script_import' ? 65536 : 4096,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'error', code: ErrorCode.AI_LLM_CONNECTION_FAILED, message: `LLM connection failed: ${msg.slice(0, 200)}` };
      return;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      yield { type: 'error', code: ErrorCode.AI_LLM_CALL_FAILED, message: `LLM call failed (${response.status}): ${errText.slice(0, 200)}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', code: ErrorCode.AI_LLM_STREAM_UNREADABLE, message: 'Unable to read stream response' };
      return;
    }

    // 3. 逐 chunk 解析 LLM 的 SSE 流
    const decoder = new TextDecoder();
    let outerBuffer = '';    // LLM SSE 外层缓冲区
    let innerBuffer = '';    // 累积的内容文本（用于检测完整行）
    let stepIndex = 0;
    // 用于跨行拼接的缓冲：当 JSON 因 content 含实际换行符被 \n 拆开时，
    // 将不完整的行暂存于此，待后续行到达后尝试拼接解析
    let pendingStepLine = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        outerBuffer += decoder.decode(value, { stream: true });

        // 解析外层 SSE（LLM 的 chunk 由 \n\n 分隔）
        const chunks = outerBuffer.split('\n\n');
        outerBuffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const content = extractLlmDeltaContent(chunk);
          if (!content) continue;

          innerBuffer += content;

          // 检测完整行（\n 分隔），每行可能是一个 step JSON
          while (true) {
            const nl = innerBuffer.indexOf('\n');
            if (nl === -1) break;

            const line = innerBuffer.slice(0, nl);
            innerBuffer = innerBuffer.slice(nl + 1);

            const trimmed = line.trim();
            if (!trimmed) continue;

            // 尝试解析为 step JSON
            const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
            // 先尝试正常解析
            let parsed: any = null;
            try {
              parsed = JSON.parse(jsonStr);
            } catch {
              // 容错：若整行因内嵌未转义引号 JSON 解析失败，
              // 尝试提取 text 字段的值（可能含 ```json 代码块）
              parsed = tryParseLenientStepJson(jsonStr);
            }
            if (parsed && parsed.type === 'step') {
              // 清空 pending 缓冲（正常解析到完整的 step）
              pendingStepLine = '';
              yield {
                type: 'step_complete',
                stepIndex,
                text: parsed.text || '',
                suggestions: parsed.suggestions || [],
              };
              stepIndex++;
            } else if (parsed) {
              // 解析成功但不是 step 类型：当作纯文本步骤
              pendingStepLine = '';
              yield {
                type: 'step_complete',
                stepIndex,
                text: trimmed,
                suggestions: [],
              };
              stepIndex++;
            } else {
              // 完全无法解析：检查是否可能是跨行 step JSON 的一部分
              if (jsonStr.includes('"type":"step"') || pendingStepLine) {
                // 累积到 pendingStepLine 中，尝试与后续行拼接解析
                pendingStepLine += (pendingStepLine ? '\n' : '') + jsonStr;
                // 尝试解析拼接后的完整 JSON
                let combinedParsed: any = null;
                try {
                  combinedParsed = JSON.parse(pendingStepLine);
                } catch {
                  combinedParsed = tryParseLenientStepJson(pendingStepLine);
                }
                if (combinedParsed && combinedParsed.type === 'step') {
                  yield {
                    type: 'step_complete',
                    stepIndex,
                    text: combinedParsed.text || '',
                    suggestions: combinedParsed.suggestions || [],
                  };
                  stepIndex++;
                  pendingStepLine = '';
                }
                // 否则继续累积，等待后续行
              } else {
                // 完全无法解析且不是 step 相关：当作纯文本步骤
                yield {
                  type: 'step_complete',
                  stepIndex,
                  text: trimmed,
                  suggestions: [],
                };
                stepIndex++;
              }
            }
          }

          // 发射进行中步骤的增量文本（打字机效果 — 只提取纯文本，去除 JSON 包装）
          if (innerBuffer.trim()) {
            const displayText = extractDisplayTextFromPartial(innerBuffer.trim());
            if (displayText) {
              yield {
                type: 'step_delta',
                stepIndex,
                text: displayText,
              };
            }
          }
        }
      }

      // 4. 刷新残留内容（含 pendingStepLine 跨行缓冲）
      const flushText = pendingStepLine || innerBuffer.trim();
      if (flushText) {
        const trimmed = flushText.trim();
        const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
        let parsed: any = null;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          parsed = tryParseLenientStepJson(jsonStr);
        }
        if (parsed && parsed.type === 'step') {
          yield {
            type: 'step_complete',
            stepIndex,
            text: parsed.text || '',
            suggestions: parsed.suggestions || [],
          };
        } else {
          yield {
            type: 'step_complete',
            stepIndex,
            text: trimmed,
            suggestions: [],
          };
        }
      }

      yield { type: 'done' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort') || msg.includes('AbortError')) {
        yield { type: 'done' };
      } else {
        const code = this.extractCode(err);
        yield { type: 'error', code, message: msg.slice(0, 200) };
      }
    }
  }

  // 从异常中提取稳定错误码(优先 AppException 的 code;否则回退通用 AI_THINK_FAILED)
  private extractCode(err: unknown): string {
    if (err && typeof err === 'object' && 'response' in err) {
      const response = (err as { response?: { code?: unknown } }).response;
      if (response && typeof response.code === 'string' && response.code) {
        return response.code;
      }
    }
    return ErrorCode.AI_THINK_FAILED;
  }

  // 提取异常消息(取 message 字段,兼容 string / Error / AppException)
  private extractMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === 'string' && msg) return msg;
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
