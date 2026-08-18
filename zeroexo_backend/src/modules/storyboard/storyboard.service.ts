import { Injectable, Logger } from '@nestjs/common';
import { AiGenerateService } from '../ai-generate/ai-generate.service';
import { PromptsService } from '../prompts/prompts.service';
import { StoryboardEpisodeDto, StoryboardEpisodeResponse } from './dto/storyboard-episode.dto';
import { badRequest } from '../../common/errors/app-exception.js';

/**
 * 默认分镜生成提示词（零配置兜底）
 * 指导 AI 将剧本拆解为结构化镜头 JSON
 */
const DEFAULT_STORYBOARD_PROMPT = `你是一名专业导演和分镜师。请根据以下剧本内容，将其拆解为连续的镜头（分镜），并只输出一个 JSON 数组。

剧本内容：
{script}

要求：
1. 每个镜头对应一个对象，字段严格如下：
{
  "sceneId": "场景编号，如 1-1",
  "dayNight": "日" 或 "夜",
  "duration": 镜头时长秒数（数字，通常 3 至 8 之间）,
  "description": "画面描述，具体描述画面内容、人物动作、构图、镜头内发生的事",
  "shotType": "景别，从[特写, 近景, 中景, 中近景, 中远景, 远景, 大全景, 全景]中选一个",
  "cameraMovement": "运镜，从[固定, 推, 拉, 摇, 移, 跟, 升, 降, 推拉, 环绕, 航拍]中选一个",
  "dialogue": "本镜头出现的对白（无则为空字符串）",
  "voiceoverText": "本镜头的旁白（无则为空字符串）",
  "monologue": "本镜头的内心独白（无则为空字符串）",
  "sfx": ["音效数组，如: 雨声, 脚步声；无则为[]"],
  "lighting": { "mood": "光影氛围描述" },
  "environment": { "location": "场景地点" },
  "emotion": "本镜头的情绪基调"
}
2. 严格按剧本叙事顺序生成镜头，覆盖剧本全部关键情节，不要遗漏。
3. 只输出 JSON 数组本身，不要输出任何解释、注释或 Markdown 代码块标记。`;

/**
 * 分镜服务 - Phase 4
 * 处理按集分镜生成逻辑
 */
@Injectable()
export class StoryboardService {
  private readonly logger = new Logger(StoryboardService.name);

  constructor(
    private readonly aiGenerateService: AiGenerateService,
    private readonly promptsService: PromptsService,
  ) {}

  /**
   * 按集生成分镜镜头
   *
   * 流程:
   * 1. 若指定 templateId，从 zeroexo-prompt 加载模板并渲染变量
   * 2. 无模板时使用硬编码默认提示词
   * 3. 调用 AI 文本生成
   * 4. 解析 JSON 响应为 Shot 数组
   * 5. 返回结构化结果
   */
  async generateEpisode(
    userId: string,
    dto: StoryboardEpisodeDto,
  ): Promise<StoryboardEpisodeResponse> {
    const { episodeContent, episodeNumber, episodeTitle, templateId, providerId, model, params } = dto;

    // 1. 构建 prompt
    let promptTemplate: string;
    if (templateId) {
      try {
        const promptRecord = await this.promptsService.findOne(userId, templateId);
        promptTemplate = promptRecord.content;
      } catch {
        this.logger.warn(`模板 ${templateId} 加载失败，使用默认提示词`);
        promptTemplate = DEFAULT_STORYBOARD_PROMPT;
      }
    } else {
      promptTemplate = DEFAULT_STORYBOARD_PROMPT;
    }

    // 渲染模板：替换 {script} 为剧本内容，{episodeNumber} 为集号，{episodeTitle} 为标题
    const prompt = promptTemplate
      .replace(/\{script\}/g, episodeContent)
      .replace(/\{episodeNumber\}/g, String(episodeNumber))
      .replace(/\{episodeTitle\}/g, episodeTitle);

    // 2. 调用 AI 生成（同步 text 模式）
    const effectiveModel = model || 'gpt-4o';
    const generateDto = {
      kind: 'text' as const,
      prompt,
      model: effectiveModel,
      providerId: providerId,
      params: { maxTokens: 16384, ...(params ?? {}) },
      tags: ['storyboard', `episode-${episodeNumber}`],
      isTest: false,
    };

    const result = await this.aiGenerateService.generate(userId, generateDto as any);

    if (!result.text) {
      throw badRequest('BAD_REQUEST', 'AI did not return storyboard text');
    }

    // 3. 解析 JSON 响应
    const shots = this.parseShotsFromText(result.text);

    // 4. 返回结构化结果
    return {
      episodeNumber,
      episodeTitle,
      shots,
      usage: {
        costTokens: result.costTokens,
        costMs: result.costMs,
        model: effectiveModel,
      },
    };
  }

  /**
   * 从 AI 返回的文本中解析镜头数组
   * 兼容 ```json 代码块包装
   */
  private parseShotsFromText(text: string): StoryboardEpisodeResponse['shots'] {
    // 尝试提取 JSON 数组
    const jsonMatch = /\[\s*\{[\s\S]*\}\s*\]/.exec(text);
    const raw = jsonMatch ? jsonMatch[0] : text;

    if (!raw || !raw.trim()) {
      throw badRequest('BAD_REQUEST', 'AI did not return storyboard data');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw badRequest('BAD_REQUEST', 'Invalid storyboard data format from AI, please retry');
    }

    if (!Array.isArray(parsed)) {
      throw badRequest('BAD_REQUEST', 'Invalid storyboard data format from AI');
    }

    return parsed.map((s: any, i: number) => {
      const lighting = (s.lighting ?? {}) as Record<string, unknown>;
      const environment = (s.environment ?? {}) as Record<string, unknown>;
      const sfxRaw = s.sfx;
      return {
        id: `shot-${Date.now()}-${i + 1}`,
        number: i + 1,
        sceneId: String(s.sceneId ?? `1-${i + 1}`),
        dayNight: String(s.dayNight ?? '日'),
        duration: Number(s.duration) || 5,
        description: String(s.description ?? ''),
        shotType: String(s.shotType ?? '中景'),
        cameraMovement: String(s.cameraMovement ?? '固定'),
        dialogue: String(s.dialogue ?? ''),
        voiceoverText: String(s.voiceoverText ?? ''),
        monologue: String(s.monologue ?? ''),
        sfx: Array.isArray(sfxRaw) ? sfxRaw.map(String) : (sfxRaw ? [String(sfxRaw)] : []),
        entities: [],
        emotion: String(s.emotion ?? ''),
        lighting: { keyLight: '自然光', colorTemp: '5500K', mood: String(lighting.mood ?? '') },
        environment: { location: String(environment.location ?? ''), time: '午后', weather: '晴' },
        continuity: { transition: 'cut' },
        prompt: String(s.prompt ?? ''),
      };
    });
  }
}